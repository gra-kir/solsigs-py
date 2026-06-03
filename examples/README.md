# Claude Agent + x402 Micropayments

A Claude AI agent that **pays for real-time Solana blockchain data** using x402 micropayments on Solana mainnet. This is the first agent that autonomously pays for on-chain data per-query.

**Dry-run mode works immediately.** Live mode needs a funded Solana wallet.

## Quick Start

```bash
# Install
pip install openai httpx

# Get your API key from Hermes or OpenRouter
hermes config show  # find openrouter.api_key

# Run (dry-run — no money spent)
export OPENROUTER_API_KEY="sk-or-v1-..."
python examples/claude_agent.py

# Custom query
python examples/claude_agent.py "Track new token launches last hour"
```

## How It Works

1. **You ask Claude a question** about Solana (prices, arbitrage, wallet analysis, etc.)
2. **Claude reasons** about which data it needs and calls the appropriate SolSigs tool
3. **x402 kicks in** — SolSigs returns HTTP 402 Payment Required with USDC amount
4. **(Dry-run) Agent shows what would happen** — amount, recipient wallet, endpoint
5. **(Live mode) Agent pays USDC** via SPL token transfer and retries with payment proof
6. **Claude receives the data** and formats a human response

```
User: "What's SOL price and any arb >0.5%?"
  → Claude calls solana_dex_price("SOL") — $0.002
  → Claude calls solana_arb_scan(0.5) — $0.010
  → Total cost: $0.012 USDC
  → Claude: "SOL is $142.37 on Jupiter. Found 1 arb: JUP/SOL 0.62% spread on Orca..."
```

## Live Mode (Real Payments)

```bash
pip install solana solders spl-token

# Fund a wallet with ~$1 USDC + 0.005 SOL
python examples/claude_agent.py -p YOUR_BASE58_PRIVATE_KEY
```

## Available Tools (SolSigs Endpoints)

| Tool | Cost | Description |
|------|------|-------------|
| `solana_dex_price` | $0.002 | Real-time DEX price (Jupiter+Birdeye) |
| `solana_arb_scan` | $0.010 | Arbitrage scan across Solana DEXs |
| `solana_token_launches` | $0.003 | New tokens with rug risk assessment |
| `solana_wallet_score` | $0.005 | Wallet risk/activity analysis |
| `solana_market_summary` | $0.008 | AI market activity summary |
| `solana_predict` | $0.003 | Polymarket prediction data |

## Architecture

```
┌──────────┐     ┌──────────┐     ┌────────────┐     ┌─────────┐
│  You     │────▶│  Claude  │────▶│  SolSigs   │────▶│ Solana  │
│ (query)  │     │ (OpenRtr)│     │  (x402)    │     │ (DEXs)  │
└──────────┘     └──────────┘     └────────────┘     └─────────┘
                      │                  │
                      │   402 Payment    │
                      │◀──Required───────│
                      │                  │
                      │   Pay USDC       │
                      │─────────────────▶│
                      │                  │
                      │   Real Data      │
                      │◀─────────────────│
```

x402 is an HTTP status code (402 Payment Required) protocol. The server returns payment details in a base64-encoded header, the client pays the exact USDC amount via an SPL token transfer on Solana, then retries with the transaction signature as proof of payment.

## Why This Matters

- **First agent that autonomously pays for data** — Claude decides what's worth paying for
- **Provably fair** — payment verification is on-chain (Solana SPL USDC transfer)
- **No subscriptions** — pay per query, fractions of a cent each
- **Solana-native** — uses Solana's sub-second finality for instant payment confirmation