#!/usr/bin/env python3
"""
Claude Agent + x402 Micropayments — SolSigs Demo
==================================================

A Claude AI agent that pays for real-time Solana blockchain data
using x402 micropayments on Solana. First autonomous agent that
pays for on-chain data per-query.

Powered by OpenRouter (routing to Claude), so it works immediately
with your existing Hermes setup.

MODES:
  Dry-run (default):    Shows full flow — no payment key needed
  Live (-p KEY):        Makes REAL x402 USDC payments on Solana

QUICK START:
  pip install openai httpx
  # Uses OpenRouter — just set OPENROUTER_API_KEY in .env
  source ~/.hermes/.env 2>/dev/null
  python examples/claude_agent.py
  python examples/claude_agent.py "Track new token launches last hour"

LIVE PAYMENTS (needs funded Solana wallet):
  python examples/claude_agent.py -p YOUR_BASE58_PRIVATE_KEY

Author: SolSigs (solsigs.com) | License: MIT
"""

import os
import sys
import json
import base64
import time
import argparse
from dataclasses import dataclass

import httpx
from openai import OpenAI

# ══════════════════════════════════════
# Optional Solana deps — only live mode
# ══════════════════════════════════════
try:
    from solana.rpc.api import Client as SolanaClient
    from solana.rpc.types import TxOpts
    from solders.keypair import Keypair
    from solders.pubkey import Pubkey
    from solders.transaction import Transaction
    from spl.token.constants import TOKEN_PROGRAM_ID
    from spl.token.instructions import (
        get_associated_token_address,
        transfer_checked,
        TransferCheckedParams,
    )
    SOLANA_DEPS = True
except ImportError:
    SOLANA_DEPS = False

SOLSIGS_BASE = "https://solsigs.com"
USDC_MINT_STR = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"

# ══════════════════════════════════════
# Dry-run x402 simulator
# ══════════════════════════════════════

class DryRunPayer:
    """Shows what WOULD happen — no money spent."""

    def pay(self, endpoint: str, payload: dict) -> tuple[str | None, dict | None]:
        url = f"{SOLSIGS_BASE}{endpoint}"
        try:
            with httpx.Client(timeout=10) as c:
                resp = c.post(url, json=payload)
        except Exception as e:
            return (None, {"error": str(e), "status": "connection_failed"})

        if resp.status_code == 402:
            info = self._parse_402(resp)
            cost = info.get("cost_usdc", 0)
            to = info.get("pay_to", "?")
            print(f"     💡 x402 Payment Required: ${cost:.4f} USDC → {to}")
            return ("dry-run", {"_dry_run": True, "would_pay": f"${cost:.4f} USDC", "endpoint": endpoint})

        if resp.status_code == 200:
            return (None, resp.json())

        return (None, {"error": f"HTTP {resp.status_code}"})

    def _parse_402(self, resp):
        encoded = resp.headers.get("payment-required", "")
        if not encoded:
            return {}
        try:
            decoded = json.loads(base64.b64decode(encoded))
            opt = decoded.get("accepts", [{}])[0]
            return {
                "cost_usdc": int(opt.get("amount", "0")) / 1_000_000,
                "pay_to": opt.get("payTo", "")[:8] + "...",
            }
        except Exception:
            return {}


# ══════════════════════════════════════
# LIVE x402 payer
# ══════════════════════════════════════

@dataclass
class PaymentRequired:
    x402_version: int; network: str; amount: str; asset: str
    pay_to: str; max_timeout: int; error: str


class LivePayer:
    """Makes REAL x402 USDC payments on Solana mainnet."""

    def __init__(self, keypair):
        self.kp = keypair
        rpc = os.environ.get("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com")
        self.solana = SolanaClient(rpc)
        self.usdc_mint = Pubkey.from_string(USDC_MINT_STR)

    @property
    def usdc_ata(self):
        if not hasattr(self, "_ata"):
            self._ata = get_associated_token_address(self.kp.pubkey(), self.usdc_mint)
        return self._ata

    def pay(self, endpoint: str, payload: dict) -> tuple[str | None, dict | None]:
        url = f"{SOLSIGS_BASE}{endpoint}"
        with httpx.Client(timeout=30) as c:
            resp = c.post(url, json=payload)

        if resp.status_code == 200:
            return None, resp.json()
        if resp.status_code != 402:
            return None, {"error": f"HTTP {resp.status_code}"}

        pr = self._parse_402(resp)
        cost = int(pr.amount) / 1_000_000
        try:
            tx_sig = self._send_usdc(pr)
        except Exception as e:
            return None, {"error": f"Payment failed: {e}"}

        with httpx.Client(timeout=30) as c:
            resp = c.post(url, json=payload, headers={"PAYMENT-SIGNATURE": tx_sig})
        if resp.status_code != 200:
            return None, {"error": f"Retry failed ({resp.status_code})"}

        print(f"     💰 Paid ${cost:.4f} USDC — {tx_sig[:16]}...")
        return tx_sig, resp.json()

    def _parse_402(self, resp):
        encoded = resp.headers.get("payment-required", "")
        decoded = json.loads(base64.b64decode(encoded))
        opt = decoded["accepts"][0]
        return PaymentRequired(
            x402_version=decoded.get("x402Version", 0),
            network=opt.get("network", ""), amount=opt["amount"],
            asset=opt["asset"], pay_to=opt["payTo"],
            max_timeout=opt.get("maxTimeoutSeconds", 60),
            error=decoded.get("error", ""),
        )

    def _send_usdc(self, pr):
        recipient = Pubkey.from_string(pr.pay_to)
        mint = Pubkey.from_string(pr.asset)
        dest_ata = get_associated_token_address(recipient, mint)
        ix = transfer_checked(TransferCheckedParams(
            program_id=TOKEN_PROGRAM_ID, source=self.usdc_ata, mint=mint,
            dest=dest_ata, owner=self.kp.pubkey(), amount=int(pr.amount),
            decimals=6, signers=[],
        ))
        bh = self.solana.get_latest_blockhash().value.blockhash
        tx = Transaction.new_with_payer(instructions=[ix], payer=self.kp.pubkey())
        tx.sign([self.kp], bh)
        sig = str(self.solana.send_raw_transaction(bytes(tx), opts=TxOpts(skip_preflight=False)).value)
        from solders.signature import Signature
        deadline = time.time() + pr.max_timeout
        while time.time() < deadline:
            r = self.solana.get_signature_statuses([Signature.from_string(sig)])
            if r.value and r.value[0] is not None:
                if r.value[0].err:
                    raise RuntimeError(str(r.value[0].err))
                return sig
            time.sleep(1)
        raise RuntimeError("Tx not confirmed")


# ══════════════════════════════════════
# SolSigs Tools (OpenAI function-calling format)
# ══════════════════════════════════════

SOLSIGS_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "solana_dex_price",
            "description": "Real-time DEX price for any Solana token (Jupiter+Birdeye). Costs $0.002 USDC via x402 micropayment.",
            "parameters": {
                "type": "object",
                "properties": {"token": {"type": "string", "description": "Token symbol (SOL, BONK, JUP) or mint address"}},
                "required": ["token"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "solana_arb_scan",
            "description": "Scan for arbitrage opportunities across Solana DEXs. Costs $0.010 USDC.",
            "parameters": {
                "type": "object",
                "properties": {"min_spread_pct": {"type": "number", "description": "Minimum spread % (default 0.1)"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "solana_token_launches",
            "description": "New token launches on pump.fun/Raydium with rug risk assessment. Costs $0.003 USDC.",
            "parameters": {
                "type": "object",
                "properties": {"max_age_minutes": {"type": "integer", "description": "Max token age in minutes (default 60)"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "solana_wallet_score",
            "description": "Score a Solana wallet for risk, wash trading, and on-chain activity. Costs $0.005 USDC.",
            "parameters": {
                "type": "object",
                "properties": {"address": {"type": "string", "description": "Solana wallet address"}},
                "required": ["address"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "solana_market_summary",
            "description": "AI-powered summary of Solana market activity. Costs $0.008 USDC.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "What to summarize (e.g. 'memecoin activity')"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "solana_predict",
            "description": "Query Polymarket prediction markets for event insights. Costs $0.003 USDC.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search term"},
                    "category": {"type": "string", "description": "Category: crypto, politics, sports, economics"},
                },
            },
        },
    },
]

TOOL_MAP = {
    "solana_dex_price": ("/dex", lambda a: {"token": a["token"]}),
    "solana_arb_scan": ("/arb", lambda a: {"min_spread_pct": a.get("min_spread_pct", 0.1)}),
    "solana_token_launches": ("/launches", lambda a: {"max_age_minutes": a.get("max_age_minutes", 60)}),
    "solana_wallet_score": ("/wallet", lambda a: {"address": a["address"]}),
    "solana_market_summary": ("/summary", lambda a: {"query": a.get("query", "market activity")}),
    "solana_predict": ("/predict", lambda a: {"query": a.get("query", ""), "category": a.get("category", "")}),
}


# ══════════════════════════════════════
# Claude Agent (via OpenRouter)
# ══════════════════════════════════════

class ClaudeSolSigsAgent:
    """Claude agent that pays for Solana data via x402.

    Uses OpenRouter to access Claude, so it works with your
    existing OPENROUTER_API_KEY from Hermes config.
    Also supports native Anthropic via ANTHROPIC_API_KEY env.
    """

    def __init__(self, payer):
        self.payer = payer

        # Try OpenRouter first (what Hermes uses), fall back to Anthropic
        if os.environ.get("OPENROUTER_API_KEY"):
            self.client = OpenAI(
                base_url="https://openrouter.ai/api/v1",
                api_key=os.environ["OPENROUTER_API_KEY"],
            )
            self.model = "anthropic/claude-sonnet-4"
            print(f"  🔗 OpenRouter → {self.model}")
        elif os.environ.get("ANTHROPIC_API_KEY"):
            from anthropic import Anthropic
            self.client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
            self.model = "claude-sonnet-4-20250514"
            self._use_anthropic_native = True
            print(f"  🔗 Anthropic native → {self.model}")
        else:
            print("❌ Set OPENROUTER_API_KEY or ANTHROPIC_API_KEY")
            sys.exit(1)

    def run(self, query: str, model: str | None = None) -> tuple[str, list]:
        """Run the agent with a natural language query."""
        model = model or self.model
        payments = []

        if getattr(self, "_use_anthropic_native", False):
            return self._run_anthropic(query, model, payments)
        else:
            return self._run_openrouter(query, model, payments)

    def _run_openrouter(self, query: str, model: str, payments: list) -> tuple[str, list]:
        messages = [
            {"role": "system", "content": "You are a Solana blockchain analyst. Each tool call costs USDC. Use tools wisely — only call what you need. Be concise and actionable."},
            {"role": "user", "content": query},
        ]

        while True:
            response = self.client.chat.completions.create(
                model=model, messages=messages, tools=SOLSIGS_TOOLS,
                tool_choice="auto", temperature=0,
            )
            msg = response.choices[0].message

            if not msg.tool_calls:
                return (msg.content or "Done.", payments)

            # Preserve assistant message
            messages.append({
                "role": "assistant",
                "content": msg.content,
                "tool_calls": [
                    {"id": tc.id, "type": "function", "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                    for tc in msg.tool_calls
                ],
            })

            for tc in msg.tool_calls:
                args = json.loads(tc.function.arguments)
                endpoint, build_payload = TOOL_MAP[tc.function.name]
                payload = build_payload(args)

                print(f"\n  🔧 {tc.function.name}({json.dumps(args)})")
                print(f"     → {SOLSIGS_BASE}{endpoint}")

                tx_sig, result = self.payer.pay(endpoint, payload)
                if tx_sig and tx_sig != "dry-run":
                    payments.append({"tool": tc.function.name, "tx": tx_sig})

                result_text = json.dumps(result, indent=2) if isinstance(result, dict) else str(result)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result_text[:4000],
                })

    def _run_anthropic(self, query: str, model: str, payments: list) -> tuple[str, list]:
        messages = [{"role": "user", "content": query}]
        system = "You are a Solana blockchain analyst. Each tool call costs USDC. Use tools wisely. Be concise and actionable."

        # Convert to Anthropic tool format
        atools = []
        for t in SOLSIGS_TOOLS:
            f = t["function"]
            atools.append({"name": f["name"], "description": f["description"], "input_schema": f["parameters"]})

        while True:
            response = self.client.messages.create(
                model=model, max_tokens=1024, system=system,
                messages=messages, tools=atools,
            )
            tool_blocks = [b for b in response.content if b.type == "tool_use"]
            if not tool_blocks:
                text = next((b.text for b in response.content if b.type == "text"), "Done.")
                return (text, payments)

            messages.append({"role": "assistant", "content": response.content})

            for block in tool_blocks:
                endpoint, build_payload = TOOL_MAP[block.name]
                payload = build_payload(block.input)
                print(f"\n  🔧 {block.name}({json.dumps(block.input)})")
                print(f"     → {SOLSIGS_BASE}{endpoint}")

                tx_sig, result = self.payer.pay(endpoint, payload)
                if tx_sig and tx_sig != "dry-run":
                    payments.append({"tool": block.name, "tx": tx_sig})

                result_text = json.dumps(result, indent=2) if isinstance(result, dict) else str(result)
                messages.append({"role": "user", "content": [{
                    "type": "tool_result", "tool_use_id": block.id, "content": result_text[:4000],
                }]})


# ══════════════════════════════════════
# CLI
# ══════════════════════════════════════

def main():
    p = argparse.ArgumentParser(description="Claude + x402 Micropayments Demo")
    p.add_argument("query", nargs="?", default="What's SOL price on DEXs and any arb opportunities above 0.5% spread?")
    p.add_argument("-p", "--private-key", help="Base58 private key for LIVE mode (real USDC payments)")
    p.add_argument("-m", "--model", help="Override model (e.g. anthropic/claude-opus-4)")
    args = p.parse_args()

    if args.private_key:
        if not SOLANA_DEPS:
            print("❌ Live mode needs: pip install solana solders spl-token")
            sys.exit(1)
        payer = LivePayer(Keypair.from_base58_string(args.private_key))
        mode = "🟢 LIVE — real USDC payments on Solana"
    else:
        payer = DryRunPayer()
        mode = "🔵 DRY-RUN — no money spent"

    print(f"═" * 60)
    print(f"🤖 Claude Agent + x402 Micropayments")
    print(f"   {mode}")
    print(f"═" * 60)
    print(f"  Query: {args.query}\n")

    agent = ClaudeSolSigsAgent(payer)
    answer, payments = agent.run(args.query, model=args.model)

    print(f"\n{'═' * 60}")
    print("📊 CLAUDE SAYS:")
    print(f"{'═' * 60}")
    print(answer)

    if payments:
        print(f"\n💳 Payments: {len(payments)} tx(s) on Solana")
        for x in payments:
            print(f"  {x['tool']}: {x['tx'][:40]}...")
    print()


if __name__ == "__main__":
    main()