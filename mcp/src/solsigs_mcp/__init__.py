"""SolSigs MCP Server — AI Agent Gateway to Solana Data.

Exposes 21 tools (20 SolSigs API endpoints + wallet status) for AI agents.
Each tool handles the x402 v2 payment flow automatically: 402 → pay USDC → retry → result.

Supports stdio (local subprocess) and SSE (remote HTTP) transports.

Usage:
    solsigs-mcp                    # Start with stdio transport
    MCP_TRANSPORT=sse solsigs-mcp  # Start with SSE on 127.0.0.1:3001
"""

__version__ = "0.1.0"
