# SolSigs Python Client · [![PyPI](https://img.shields.io/badge/pypi-soon-blue)](https://solsigs.com)

**Pay-per-call Solana data APIs for AI agents via [x402](https://x402.org) micropayments.**

No API keys. No subscriptions. Agents pay in USDC per call.

## Claude + SolSigs (Native x402)

Claude agents can pay for SolSigs APIs natively — no setup beyond MCP config.

```json
// ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "solsigs": {
      "url": "https://solsigs.com/sse",
      "transport": "sse"
    }
  }
}
```

Restart Claude Desktop. Your agent now has **15 Solana research tools** with native x402 micropayments. Full example: [`examples/claude_solsigs_agent.py`](examples/claude_solsigs_agent.py)

🔗 [Anthropic official x402 docs](https://docs.anthropic.com/en/docs/build-with-claude/x402-payments)

## Install

```bash
pip install solsigs-py              # base client
pip install solsigs-py[langgraph]   # + LangGraph tools
```

## Quick Start

```python
from solsigs import SolSigsClient

client = SolSigsClient()

# DEX price for any Solana token
price = client.get_dex_price("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263")
print(price)  # → $0.002 USDC

# Multi-token batch pricing + OHLCV
prices = client.batch_token_pricing(["SOL", "BONK", "WIF"], period="1h")

# Wallet risk scoring
report = client.score_wallet("7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV")

# Arbitrage scan
arbs = client.scan_arbitrage(min_spread_pct=0.5)
```

### Payment flow

```
Agent calls endpoint → 402 Payment Required → Pays USDC → Retries → Gets data
```

The client handles the HTTP layer. Integrate your agent's Solana wallet for automated x402 payment.

## MCP Server

SolSigs ships as an **MCP server** (Model Context Protocol) — Claude, Hermes, Cursor, and any MCP-compatible agent can call SolSigs tools natively.

```json
{
  "mcpServers": {
    "solsigs": {
      "url": "https://solsigs.com/sse",
      "transport": "sse"
    }
  }
}
```

**15 MCP tools** — all 14 HTTP endpoints + Polymarket prediction markets:

### Data & Pricing (5)
| Tool | Description | Price |
|------|-------------|-------|
| `get_dex_price` | Single-token DEX price feed (Jupiter + Birdeye) | $0.002 |
| `batch_token_pricing` | Multi-token pricing + OHLCV candles + metadata | $0.003 |
| `get_market_summary` | AI-powered on-chain market summary (Groq LLM) | $0.008 |
| `get_staking_rates` | Cross-protocol APY comparison (Marinade, Jito, Blaze, Sanctum) | $0.002 |
| `get_dev_activity` | GitHub commit activity + audit status for Solana protocols | $0.001 |

### Trading & Arbitrage (2)
| Tool | Description | Price |
|------|-------------|-------|
| `scan_arbitrage` | Cross-DEX arbitrage scanner | $0.010 |
| `get_prediction_market` | Polymarket prediction markets (crypto, politics, sports) | $0.003 |

### Intelligence & Tracking (5)
| Tool | Description | Price |
|------|-------------|-------|
| `analyze_wallet` | Wallet risk scoring + wash trading detection | $0.005 |
| `detect_token_launches` | New token launch detection (pump.fun, Raydium) | $0.003 |
| `get_whale_activity` | Whale wallet tracking + smart money signals | $0.006 |
| `get_nft_intel` | NFT floor prices, rarity, wash trading per collection | $0.004 |
| `get_social_sentiment` | On-chain social sentiment + influencer tracking | $0.004 |

### Infrastructure (3)
| Tool | Description | Price |
|------|-------------|-------|
| `rpc_relay` | Pay-per-call Helius RPC relay | $0.001 |
| `create_alert` | Webhook alert registration (price, volume, whale, launches) | $0.005 |
| `wallet_status` | Check MCP wallet USDC/SOL balance | FREE |

## LangGraph Integration

```python
from solsigs.langgraph_tools import SOLSIGS_LANGGRAPH_TOOLS

# Add to your LangGraph agent
from langgraph.prebuilt import create_react_agent

agent = create_react_agent(model, SOLSIGS_LANGGRAPH_TOOLS)

# Your agent can now:
agent.invoke({"messages": ["What's the current price of BONK?"]})
agent.invoke({"messages": ["Compare staking APY across Solana protocols"]})
```

See [`examples/langgraph_agent.py`](examples/langgraph_agent.py) for a full multi-step agent demo.

## Available HTTP Endpoints (14)

### Data & Pricing (5)
| Endpoint | Description | Price |
|----------|-------------|-------|
| `/dex` | Single-token DEX price feed (Jupiter + Birdeye) | $0.002 |
| `/price` | Batch multi-token pricing + OHLCV candles + metadata | $0.003 |
| `/summary` | AI on-chain data summarization (Groq LLM) | $0.008 |
| `/staking` | Cross-protocol staking APY comparison | $0.002 |
| `/dev` | Protocol developer activity + audit status | $0.001 |

### Trading & Arbitrage (2)
| Endpoint | Description | Price |
|----------|-------------|-------|
| `/arb` | Arbitrage scanner | $0.010 |
| `/predict` | Polymarket prediction markets | $0.003 |

### Intelligence & Tracking (5)
| Endpoint | Description | Price |
|----------|-------------|-------|
| `/wallet` | Wallet risk scoring | $0.005 |
| `/launches` | Early token launch detection | $0.003 |
| `/whale` | Whale wallet tracking + smart money signals | $0.006 |
| `/nft` | NFT floor prices, rarity, wash trading | $0.004 |
| `/social` | On-chain social sentiment + influencer tracking | $0.004 |

### Infrastructure (2)
| Endpoint | Description | Price |
|----------|-------------|-------|
| `/rpc` | RPC load balancer | $0.001 |
| `/alerts` | Webhook alert registration | $0.005 |

## Why x402?

- **No API keys** — payment is the only gate
- **No subscriptions** — pay only for what you use
- **Agent-native** — designed for autonomous agent commerce
- **Solana speed** — transactions finalize in <1s, fees <$0.001
- **Claude native** — Anthropic official x402 support, zero setup for Claude users

## Links

- [SolSigs Homepage](https://solsigs.com)
- [Claude + SolSigs Example](examples/claude_solsigs_agent.py)
- [Anthropic x402 Docs](https://docs.anthropic.com/en/docs/build-with-claude/x402-payments)
- [x402 Protocol](https://x402.org)
- [x402scan Explorer](https://x402scan.com)

## License

MIT
