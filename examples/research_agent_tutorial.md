"""
"I Built an AI Agent That Researches Solana Autonomously" — Tutorial
===================================================================

This tutorial shows you how to build an AI research agent that uses
SolSigs for real-time Solana data instead of web scraping.
"""

# Tutorial outline for https://solsigs.com/blog/building-solana-research-agent

ARTICLE = {
    "title": "I Built an AI Agent That Researches Solana Autonomously — Here's How",
    "subtitle": "15 tools, zero web scraping, pay-per-call in USDC. Your agent gets structured data instead of parsing HTML.",
    "sections": [
        {
            "heading": "The Problem: AI Agents Can't Read the Blockchain",
            "body": (
                "LLMs are terrible at Solana research. They hallucinate prices, can't verify "
                "wallet activity, and have no idea what's happening on-chain right now.\n\n"
                "The workaround everyone uses? Web scraping. Agents navigate to CoinGecko, "
                "Solscan, DexScreener — parsing HTML, fighting rate limits, burning 50K+ tokens "
                "per research session. The results are slow, expensive, and unreliable.\n\n"
                "SolSigs solves this with a single API call."
            ),
        },
        {
            "heading": "What SolSigs Gives Your Agent",
            "body": (
                "15 tools covering the entire Solana data surface:\n\n"
                "• **DEX Pricing** — Real-time Jupiter + Birdeye aggregation\n"
                "• **Wallet Analysis** — Risk scoring, wash trading detection, rug signals\n"
                "• **Arbitrage Scanning** — Cross-DEX opportunities with MEV scoring\n"
                "• **Launch Detection** — New tokens on pump.fun and Raydium with rug assessment\n"
                "• **Whale Tracking** — Smart money flows and accumulation signals\n"
                "• **NFT Data** — Floor prices, rarity, wash trading from Tensor/Magic Eden/Solanart\n"
                "• **Staking Yields** — Compare APY across Marinade, Jito, BlazeStake, Sanctum\n"
                "• **Prediction Markets** — Polymarket odds, volume, liquidity\n"
                "• **On-chain AI Summaries** — Plain-English wallet/contract summaries\n"
                "• **Developer Activity** — GitHub commits, contributors, audit status\n"
                "• **Social Sentiment** — On-chain social signals and influencer tracking\n"
                "• **Webhook Alerts** — Price thresholds, whale movements, launch notifications\n"
                "• **RPC Relay** — Optimized Solana RPC through load-balanced Helius endpoint\n\n"
                "Your agent calls one function. Gets structured JSON back. No HTML. No tokens wasted."
            ),
        },
        {
            "heading": "30-Second Setup",
            "body": (
                "```bash\n"
                "pip install solsigs-py\n"
                "```\n\n"
                "**Claude Desktop:**\n"
                "```json\n"
                "{\n"
                '  "mcpServers": {\n'
                '    "solsigs": {\n'
                '      "command": "solsigs-mcp"\n'
                "    }\n"
                "  }\n"
                "}\n"
                "```\n"
                "Restart Claude Desktop. Your agent has 15 Solana tools.\n\n"
                "**LangChain:**\n"
                "```python\n"
                "from solsigs.langchain_tools import create_solsigs_tools\n\n"
                'tools = create_solsigs_tools(free_tier_key="fts_...")  # 50 free calls\n'
                "```\n\n"
                "**CrewAI:**\n"
                "```python\n"
                "from solsigs.crewai_tools import create_solsigs_crewai_tools\n\n"
                'tools = create_solsigs_crewai_tools(free_tier_key="fts_...")  # 50 free calls\n'
                "```\n\n"
                "**Direct Python:**\n"
                "```python\n"
                "from solsigs import SolSigsClient\n\n"
                'client = SolSigsClient(free_tier_key="fts_...")  # 50 free calls\n'
                'price = client.get_dex_price("BONK")\n'
                "```\n\n"
                "Get your free tier key: https://solsigs.com/freetier"
            ),
        },
        {
            "heading": "What Your Agent Can Now Do",
            "body": (
                "Here's what a research prompt looks like after connecting SolSigs:\n\n"
                "> \"Research BONK token: current price, 24h volume, top holder wallet analysis, "
                "recent whale activity, and whether there are any arbitrage opportunities.\"\n\n"
                "Your agent executes 5 tool calls:\n"
                "1. `get_dex_price(\"BONK\")` → $0.000021, $2.1M volume\n"
                "2. `batch_token_pricing([\"BONK\"], \"24h\")` → OHLCV candles\n"
                "3. `score_wallet(\"7E...\")` → top holder risk profile\n"
                "4. `whale_tracker(token=\"BONK\", hours=6)` → 3 large accumulations\n"
                "5. `scan_arbitrage(min_spread_pct=0.5)` → 1 profitable route\n\n"
                "**Total cost: $0.025 USDC. Tokens burned: ~2,000 for the summary.**\n\n"
                "Compare that to web scraping: 50K+ tokens, 30+ seconds of browser navigation, "
                "and results that might be 5 minutes stale or completely hallucinated."
            ),
        },
        {
            "heading": "The Economics: Why This Changes AI Agents",
            "body": (
                "Traditional AI agent research:\n"
                "• Web browsing → 50K tokens × $15/M tok = $0.75\n"
                "• Multiple sites needed (CoinGecko + Solscan + DexScreener) = $2-5\n"
                "• Results: scraped HTML, stale data, hallucination risk\n\n"
                "SolSigs agent research:\n"
                "• 5 API calls → $0.025 USDC\n"
                "• Structured JSON → 2K tokens for the summary → $0.03\n"
                "• Total: **$0.055 vs $2-5**. Same quality, 40-90x cheaper.\n\n"
                "This flips the economics of autonomous agents. You don't need a $200/mo "
                "browser agent subscription. You need direct data pipes that cost pennies.\n\n"
                "And because payments are per-call in USDC via x402, there's no API key "
                "management, no subscription plans, no rate limit tickets. Your agent pays "
                "for what it uses, just like a human would."
            ),
        },
        {
            "heading": "Free Tier: 50 Calls, No Wallet Required",
            "body": (
                "We just launched a free tier. Go to https://solsigs.com/freetier, "
                "get a key in 2 seconds, and make 50 free calls before you pay anything.\n\n"
                "No wallet setup. No USDC deposit. Just a key that lets you test all 15 endpoints.\n\n"
                "After 50 calls, switch to x402 micropayments. Most research sessions use 3-8 calls, "
                "so 50 is enough for 6-15 full research sessions."
            ),
        },
        {
            "heading": "Start Building",
            "body": (
                "```bash\n"
                "pip install solsigs-py\n"
                "```\n\n"
                "Get your free tier key: https://solsigs.com/freetier\n\n"
                "GitHub: https://github.com/gra-kir/solsigs-py\n\n"
                "Docs: https://solsigs.com/docs\n\n"
                "Your agent should work with data, not fight HTML."
            ),
        },
    ],
    "cta": "Get 50 free calls → https://solsigs.com/freetier",
}