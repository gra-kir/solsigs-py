#!/usr/bin/env python3
"""
SolSigs MCP Proxy — Claude Desktop stdio bridge
================================================

Claude Desktop only supports stdio transport for MCP servers.
SolSigs MCP runs as SSE at https://solsigs.com/sse.

This proxy bridges: stdio (Claude Desktop) ↔ SSE (remote server).

CONFIGURE:
  ~/Library/Application Support/Claude/claude_desktop_config.json:
  {
    "mcpServers": {
      "solsigs": {
        "command": "solsigs-mcp"
      }
    }
  }

Restart Claude Desktop. Your agent now has 15 Solana research tools.

Architecture:
  stdin → JSON-RPC → POST to SSE message endpoint → SSE response → stdout
"""

import sys
import json
import asyncio
import os
import logging
from typing import Optional

import httpx

SOLSIGS_SSE_URL = os.environ.get("SOLSIGS_SSE_URL", "https://solsigs.com/sse")

# Log to stderr so stdout stays clean for JSON-RPC
logging.basicConfig(
    stream=sys.stderr,
    level=logging.WARNING,
    format="[solsigs-mcp] %(levelname)s %(message)s",
)
log = logging.getLogger("solsigs-mcp")


class StdioMCPProxy:
    """Bridges stdio JSON-RPC ↔ remote SSE MCP server.

    Protocol:
      1. Connects to SSE endpoint, extracts the session-specific POST URL
      2. Reads JSON-RPC requests from stdin
      3. POSTs them to the session URL
      4. Listens for responses on the SSE stream
      5. Writes JSON-RPC responses to stdout
    """

    def __init__(self, sse_url: str = SOLSIGS_SSE_URL):
        self.sse_url = sse_url
        self.message_endpoint: Optional[str] = None
        self.client = httpx.AsyncClient(timeout=httpx.Timeout(60.0))
        self._response_queue: asyncio.Queue = asyncio.Queue()
        self._connected = asyncio.Event()

    async def _extract_endpoint(self) -> str:
        """Connect to SSE, extract the message endpoint URL from the first event."""
        async with self.client.stream("GET", self.sse_url) as response:
            response.raise_for_status()
            log.info("SSE connected, waiting for endpoint event...")

            async for line in response.aiter_lines():
                log.debug("SSE line: %s", line[:120])

                if line.startswith("event: endpoint"):
                    # Next line should be "data: <url>"
                    continue

                if line.startswith("data: "):
                    data_str = line[6:]
                    try:
                        data = json.loads(data_str)
                    except json.JSONDecodeError:
                        # Might be a plain string URL
                        if data_str.startswith("http"):
                            log.info("Endpoint URL: %s", data_str)
                            return data_str
                        continue

                    if isinstance(data, dict) and "uri" in data:
                        log.info("Endpoint URL from data: %s", data["uri"])
                        return data["uri"]
                    if isinstance(data, str) and data.startswith("http"):
                        log.info("Endpoint URL: %s", data)
                        return data

            raise RuntimeError("No endpoint event received from SSE server")

    async def _sse_listener(self):
        """Continuously listen on SSE stream, routing responses to the queue."""
        while True:
            try:
                async with self.client.stream("GET", self.sse_url) as response:
                    response.raise_for_status()
                    log.info("SSE listener connected")

                    endpoint_seen = False
                    async for line in response.aiter_lines():
                        if line.startswith("event: endpoint"):
                            endpoint_seen = True
                            continue

                        if endpoint_seen and line.startswith("data: "):
                            # Extract message endpoint from first data after endpoint
                            data_str = line[6:]
                            try:
                                data = json.loads(data_str)
                            except json.JSONDecodeError:
                                if data_str.startswith("http"):
                                    self.message_endpoint = data_str
                                continue
                            if isinstance(data, dict) and "uri" in data:
                                self.message_endpoint = data["uri"]
                            elif isinstance(data, str) and data.startswith("http"):
                                self.message_endpoint = data
                            endpoint_seen = False
                            self._connected.set()
                            continue

                        if line.startswith("data: "):
                            data_str = line[6:]
                            if not data_str.strip():
                                continue
                            try:
                                data = json.loads(data_str)
                            except json.JSONDecodeError:
                                log.warning("Bad JSON in SSE: %.100s", data_str)
                                continue

                            # Heartbeat/skip non-JSONRPC
                            if "jsonrpc" not in data:
                                continue

                            await self._response_queue.put(data)

            except (httpx.HTTPError, OSError) as e:
                log.warning("SSE listener error: %s, reconnecting...", e)
                await asyncio.sleep(2)
            except Exception as e:
                log.error("SSE listener fatal: %s, reconnecting...", e)
                await asyncio.sleep(2)

    async def _post_request(self, request: dict) -> Optional[dict]:
        """POST a JSON-RPC request to the remote SSE server's message endpoint.
        
        Returns the direct response, None if response comes via SSE, or raises on error.
        """
        await self._connected.wait()

        resp = await self.client.post(
            self.message_endpoint,
            json=request,
            timeout=httpx.Timeout(30.0),
        )

        if resp.status_code == 202:
            # Accepted — response will come through SSE
            return None

        resp.raise_for_status()

        # Some servers return the JSON-RPC response directly
        ct = resp.headers.get("content-type", "")
        if "json" in ct:
            return resp.json()

        return None

    async def _read_stdio(self) -> Optional[dict]:
        """Read a single JSON-RPC message from stdin."""
        loop = asyncio.get_event_loop()

        try:
            line = await loop.run_in_executor(None, sys.stdin.readline)
        except (EOFError, OSError):
            return None

        if not line:
            return None

        line = line.strip()
        if not line:
            return None

        try:
            return json.loads(line)
        except json.JSONDecodeError:
            log.warning("Bad JSON on stdin: %.100s", line)
            return None

    def _write_stdio(self, message: dict):
        """Write a JSON-RPC message to stdout."""
        try:
            sys.stdout.write(json.dumps(message, default=str) + "\n")
            sys.stdout.flush()
        except (BrokenPipeError, OSError):
            sys.exit(0)

    async def run(self):
        """Main proxy loop: stdin → remote → stdout."""

        # Start background SSE listener
        listener_task = asyncio.create_task(self._sse_listener())

        # Start background response writer
        async def _writer():
            while True:
                response = await self._response_queue.get()
                self._write_stdio(response)

        writer_task = asyncio.create_task(_writer())

        # Get initial message endpoint
        try:
            self.message_endpoint = await asyncio.wait_for(
                self._extract_endpoint(), timeout=15.0
            )
            self._connected.set()
            log.info("Proxy ready — endpoint: %s", self.message_endpoint[:60])
        except Exception as e:
            log.error("Failed to get SSE endpoint: %s", e)
            self._write_stdio({
                "jsonrpc": "2.0",
                "id": None,
                "error": {
                    "code": -32603,
                    "message": f"Failed to connect to SolSigs MCP: {e}",
                },
            })
            return

        # Notify stderr (but not on stdout — that's the JSON-RPC channel)
        log.info("SolSigs MCP proxy ready — 15 tools available")

        try:
            while True:
                request = await self._read_stdio()
                if request is None:
                    break

                # Ignore notifications (no id)
                if "id" not in request:
                    log.debug("Ignoring notification: %s", request.get("method"))
                    continue

                try:
                    # POST to remote, response comes via SSE
                    direct = await self._post_request(request)
                    if direct is not None:
                        # Some servers return response directly
                        self._write_stdio(direct)
                    # Else response will come through _writer from SSE queue

                except httpx.HTTPStatusError as e:
                    self._write_stdio({
                        "jsonrpc": "2.0",
                        "id": request["id"],
                        "error": {
                            "code": -32603,
                            "message": f"Server error: {e.response.status_code}",
                        },
                    })
                except httpx.TimeoutException:
                    self._write_stdio({
                        "jsonrpc": "2.0",
                        "id": request["id"],
                        "error": {
                            "code": -32603,
                            "message": "Request timed out",
                        },
                    })
                except Exception as e:
                    self._write_stdio({
                        "jsonrpc": "2.0",
                        "id": request["id"],
                        "error": {
                            "code": -32603,
                            "message": str(e),
                        },
                    })

        except KeyboardInterrupt:
            pass
        finally:
            listener_task.cancel()
            writer_task.cancel()
            await self.client.aclose()


def main():
    """Entry point: solsigs-mcp"""
    proxy = StdioMCPProxy()
    try:
        asyncio.run(proxy.run())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
