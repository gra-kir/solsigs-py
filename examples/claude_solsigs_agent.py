"""
Claude + SolSigs: Autonomous Solana Research Agent
===================================================

Demonstrates Claude using SolSigs x402 APIs for autonomous Solana research.
Claude agents pay USDC natively per call — no API keys, no subscriptions.

Anthropic official x402 docs: docs.anthropic.com/en/docs/build-with-claude/x402-payments

Setup — 30 seconds:
  1. Add this to your Claude Desktop config (~/Library/Application Support/Claude/claude_desktop_config.json):

     {
       "mcpServers": {
         "solsigs": {
           "url": "https://solsigs.com/sse",
           "transport": "sse"
         }
       }
     }

  2. Restart Claude Desktop
  3. Claude now has 15 Solana research tools with native x402 payment

Example research sessions Claude can now run autonomously:

  "Research the top 5 meme coins on Solana right now — check prices, scan for
   arbitrage, and score the top holder wallets for risk. Total budget: $0.10 USDC."

  "Monitor new token launches for the next hour. For any launch with >$50k volume,
   check the deployer wallet and alert me."

  "Build me a Solana DeFi dashboard: current staking yields across protocols,
   whale wallet activity in the last 24 hours, and social sentiment for SOL."

SolSigs MCP tools available to Claude (all with native x402 payment):
  - get_dex_price          $0.002   DEX price feed (Jupiter + Birdeye)
  - batch_token_pricing    $0.003   Multi-token pricing + OHLCV
  - scan_arbitrage         $0.010   Cross-DEX arbitrage scanner
  - analyze_wallet         $0.005   Wallet risk scoring + activity
  - detect_token_launches  $0.003   New token launch detection + rug risk
  - nft_floor_scanner      $0.004   NFT floor/rarity/wash trading
  - staking_yields         $0.002   Cross-protocol staking APY comparison
  - whale_tracker          $0.006   Whale wallet tracking + smart money
  - alert_webhooks         $0.005   Webhook alert registration
  - protocol_dev_activity  $0.001   Protocol dev activity + audit status
  - onchain_social         $0.004   On-chain social sentiment analysis
  - prediction_markets     $0.003   Polymarket predictions
  - market_summary         $0.008   AI on-chain summary (Groq LLM)
  - rpc_relay              $0.001   Helius RPC load balancer
  - wallet_status          FREE     Check MCP wallet balance

Pricing: pay-per-call in USDC on Solana. No subscriptions, no rate limits.
"""

import asyncio
import subprocess
import json


def print_banner():
    print("""
╔══════════════════════════════════════════════════════════╗
║     Claude + SolSigs: Autonomous Solana Research        ║
║     Agent-powered, pay-per-call, no API keys            ║
╚══════════════════════════════════════════════════════════╝
    """)


def check_claude_mcp_config():
    """Verify Claude Desktop is configured for SolSigs MCP."""
    import os
    import platform

    config_paths = {
        "darwin": os.path.expanduser(
            "~/Library/Application Support/Claude/claude_desktop_config.json"
        ),
        "linux": os.path.expanduser(
            "~/.config/Claude/claude_desktop_config.json"
        ),
        "windows": os.path.expanduser(
            r"~\AppData\Roaming\Claude\claude_desktop_config.json"
        ),
    }

    system = platform.system().lower()
    config_path = config_paths.get(system)

    if config_path and os.path.exists(config_path):
        with open(config_path) as f:
            config = json.load(f)
        servers = config.get("mcpServers", {})
        if "solsigs" in servers:
            print("✅ Claude Desktop configured for SolSigs MCP")
            print(f"   URL: {servers['solsigs'].get('url', 'unknown')}")
            return True

    print("⚠️  Claude Desktop MCP config not found for SolSigs")
    print(f"   Expected config at: {config_path}")
    print("   Run: python examples/claude_solsigs_agent.py --setup")
    return False


def print_setup_instructions():
    """Print step-by-step setup instructions."""
    import os
    import platform

    system = platform.system().lower()
    config_paths = {
        "darwin": os.path.expanduser(
            "~/Library/Application Support/Claude/claude_desktop_config.json"
        ),
        "linux": os.path.expanduser("~/.config/Claude/claude_desktop_config.json"),
    }

    config_path = config_paths.get(system, "claude_desktop_config.json")
    config_dir = os.path.dirname(config_path)

    mcp_entry = {
        "solsigs": {
            "url": "https://solsigs.com/sse",
            "transport": "sse"
        }
    }

    print("""
📋 Claude + SolSigs Setup (30 seconds)
======================================

1. Create/open Claude Desktop config:
   mkdir -p {config_dir}
   nano "{config_path}"

2. Paste this configuration:
""".format(config_dir=config_dir, config_path=config_path))

    # Try to read existing config
    existing = {}
    if os.path.exists(config_path):
        try:
            with open(config_path) as f:
                existing = json.load(f)
        except json.JSONDecodeError:
            pass

    existing.setdefault("mcpServers", {})
    existing["mcpServers"]["solsigs"] = mcp_entry["solsigs"]

    print(json.dumps(existing, indent=2))
    print("""
3. Save and restart Claude Desktop

4. Verify: Claude's tool list now shows 15 SolSigs tools

💰 Your Claude agent can now:
   - Research any Solana token, wallet, or protocol
   - Scan for arbitrage across DEXs
   - Track whale wallets and new token launches
   - Monitor staking yields across protocols
   - Analyze NFT collections and social sentiment
   - All with native x402 USDC micropayments
   - No API keys. No subscriptions. Pay per call.

Example prompts to try in Claude:

   "What's the current price of BONK and WIF on Solana? Also check
    if there are any arbitrage opportunities between Jupiter and Raydium."

   "Analyze wallet 7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV —
    what's their on-chain activity look like?"

   "Find new token launches in the last hour with over $10k volume
    and check the deployer wallets for risk."

   "What are the top Solana staking protocols right now by APY?"

🔗 Links:
   - SolSigs: https://solsigs.com
   - Anthropic x402 docs: https://docs.anthropic.com/en/docs/build-with-claude/x402-payments
   - x402 Protocol: https://x402.org
   - GitHub: https://github.com/gra-kir/solsigs-py
    """)


def print_research_workflows():
    """Print example autonomous research workflows."""
    print("""
🔬 Autonomous Research Workflows
================================

Claude + SolSigs enables fully autonomous Solana research. Here are
real workflows Claude can execute with zero human intervention:

1. DEX ARBITRAGE MONITOR
   "Every 10 minutes, scan Solana DEXs for arb opportunities above 0.5%.
    When found, report the token, spread, and execution DEXs."

2. WHALE WALLET SURVEILLANCE
   "Track Solana transactions >$500k in the last 24 hours. For each whale,
    score the wallet, check recent token holdings, and flag wash trading."

3. EARLY LAUNCH DETECTION
   "Monitor new token launches on pump.fun and Raydium. For each launch:
    check deployer wallet risk, initial liquidity, and social sentiment."

4. YIELD FARMING OPTIMISER
   "Compare staking APY across Marinade, Jito, BlazeStake, and Sanctum.
    Factor in protocol dev activity and social sentiment. Recommend
    the best risk-adjusted yield."

5. NFT COLLECTION RESEARCH
   "Analyze the top 5 NFT collections by 24h volume. Check floor prices,
    wash trading %, whale concentration, and recent social mentions."

6. CROSS-CHAIN BRIDGE MONITOR
   "Watch for large bridge transfers between Solana and Ethereum L2s.
    When a wallet bridges >$100k, check their activity on both chains."

⚡ All research is autonomous, real-time, and pay-per-call.
    """)


def main():
    import sys

    print_banner()

    if "--setup" in sys.argv:
        print_setup_instructions()
        return

    if "--workflows" in sys.argv:
        print_research_workflows()
        return

    # Default: check config + show options
    configured = check_claude_mcp_config()
    print()

    print("Usage:")
    print("  python claude_solsigs_agent.py --setup     # Setup instructions")
    print("  python claude_solsigs_agent.py --workflows  # Research workflow ideas")
    print()
    print("Once configured, open Claude Desktop and try:")
    print('  "Research Solana meme coins — prices, arb, and wallet risk"')
    print()
    print("🌐 https://solsigs.com  |  🔗 https://x402.org")


if __name__ == "__main__":
    main()
