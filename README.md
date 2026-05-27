# SolSigs Python Client · [![PyPI](https://img.shields.io/badge/pypi-soon-blue)](https://solsigs.com)

**Pay-per-call Solana data APIs for AI agents via [x402](https://x402.org) micropayments.**

No API keys. No subscriptions. Agents pay in USDC per call.

## Install

```bash
pip install solsigs-py          # base client
pip install solsigs-py[langgraph]  # + LangGraph tools
```

## Quick Start

```python
from solsigs import SolSigsClient

client = SolSigsClient()

# Get DEX price for any Solana token
price = client.get_dex_price("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263")
print(price)  # → $0.002 USDC

# Score a wallet for risk
report = client.score_wallet("7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV")

# Scan for arbitrage
arbs = client.scan_arbitrage(min_spread_pct=0.5)
```

### Payment flow

```
Agent calls endpoint → 402 Payment Required → Pays USDC → Retries → Gets data
```

The client handles the HTTP layer. Integrate your agent's Solana wallet for automated x402 payment.

## LangGraph Integration

```python
from solsigs.langgraph_tools import SOLSIGS_LANGGRAPH_TOOLS

# Add to your LangGraph agent
from langgraph.prebuilt import create_react_agent

agent = create_react_agent(model, SOLSIGS_LANGGRAPH_TOOLS)

# Your agent can now:
agent.invoke({"messages": ["What's the current price of BONK?"]})
```

## Available Endpoints

| Endpoint | Description | Price |
|----------|-------------|-------|
| `/dex` | DEX price feed (Jupiter + Birdeye) | $0.002 |
| `/arb` | Arbitrage scanner | $0.010 |
| `/wallet` | Wallet risk scoring | $0.005 |
| `/launches` | Early token launch detection | $0.003 |
| `/summary` | AI on-chain data summarization (Groq) | $0.008 |
| `/rpc` | RPC load balancer | $0.001 |

## Why x402?

- **No API keys** — payment is the only gate
- **No subscriptions** — pay only for what you use
- **Agent-native** — designed for autonomous agent commerce
- **Solana speed** — transactions finalize in <1s, fees <$0.001

## Links

- [SolSigs Homepage](https://solsigs.com)
- [x402 Protocol](https://x402.org)
- [x402scan Explorer](https://x402scan.com)

## License

MIT