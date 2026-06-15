# SolSigs MCP Server

<!-- mcp-name: io.github.gra-kir/solsigs-mcp -->

AI Agent Gateway to Solana blockchain data via x402 micropayments.

## What is this?

SolSigs MCP is a [Model Context Protocol](https://modelcontextprotocol.io/) server that gives AI agents access to 21 Solana data tools — DEX prices, arbitrage scanning, wallet intel, token launches, AI market summaries, prediction markets, perps data, and more.

Each tool costs fractions of a cent USDC via the [x402 protocol](https://x402.org) — start with 50 free calls.

## Quick Start

```bash
pip install solsigs-mcp
export SOLSIGS_MCP_KEY="your-base58-private-key"
solsigs-mcp
```

## Tools

| Tool | Description | Price |
|------|-------------|-------|
| `get_dex_price` | Real-time DEX prices + liquidity | $0.002 |
| `scan_arbitrage` | Cross-DEX arbitrage scanner | $0.010 |
| `analyze_wallet` | Wallet risk analysis | $0.005 |
| `detect_token_launches` | New token launch detection | $0.003 |
| `get_market_summary` | AI-powered market summary | $0.008 |
| `get_prediction_market` | Polymarket prediction data | $0.003 |
| `get_batch_prices` | Multi-token pricing + OHLCV | $0.003 |
| `get_nft_intel` | NFT collection analytics | $0.004 |
| `get_staking_rates` | Staking APY comparison | $0.002 |
| `get_whale_activity` | Whale wallet tracking | $0.006 |
| `create_alert` | Webhook price/volume alerts | $0.005 |
| `get_dev_activity` | Protocol dev activity | $0.001 |
| `get_social_sentiment` | On-chain social sentiment | $0.004 |
| `rpc_relay` | Pay-per-call Solana RPC | $0.001 |
| `track_smart_money` | Smart money copy-trading | $0.008 |
| `get_trending_tokens` | Trending token feed | $0.004 |
| `check_token_safety` | Token safety audit | $0.005 |
| `get_alpha_feed` | Alpha feed + signals | $0.006 |
| `get_wallet_trust` | Wallet trust score | $0.003 |
| `get_perps_data` | Perps + derivatives | $0.005 |
| `wallet_status` | Check wallet balance | Free |

## Configuration

| Env Var | Required | Default | Description |
|---------|----------|---------|-------------|
| `SOLSIGS_MCP_KEY` | Yes | — | Base58 Solana private key with USDC |
| `SOLANA_RPC_URL` | No | Mainnet public | Solana RPC endpoint |
| `SOLSIGS_BASE_URL` | No | `https://solsigs.com` | SolSigs API base |
| `MCP_TRANSPORT` | No | `stdio` | `stdio` or `sse` |
| `MCP_HOST` | No | `127.0.0.1` | SSE bind address |
| `MCP_PORT` | No | `3001` | SSE port |

## SSE Mode

```bash
pip install solsigs-mcp
export SOLSIGS_MCP_KEY="your-key"
export MCP_TRANSPORT=sse
export MCP_HOST=0.0.0.0
solsigs-mcp
# → SSE endpoint at http://0.0.0.0:3001/sse
```

Configure your MCP client with:
```json
{
  "solsigs": {
    "url": "http://localhost:3001/sse"
  }
}
```

## License

MIT
