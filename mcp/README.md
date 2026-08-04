# SolSigs MCP Server

<!-- mcp-name: io.github.gra-kir/solsigs-mcp -->

AI Agent Gateway to Solana blockchain data via x402 micropayments.

## What is this?

SolSigs MCP is a [Model Context Protocol](https://modelcontextprotocol.io/) server that gives AI agents access to 22 Solana on-chain data tools — DEX prices, arbitrage scanning, wallet intel, token launches, AI market summaries, prediction markets, perps data, memecoin trenches, and more.

Each tool costs fractions of a cent USDC via the [x402 protocol](https://x402.org). No key required — start with 50 free calls automatically.

## Quick Start

**Free tier (no key needed):**
```bash
pip install solsigs-mcp
solsigs-mcp
# → SolSigs MCP Server starting (stdio) [FREE-TIER MODE]...
#   50 free calls per session. Set SOLSIGS_MCP_KEY for paid mode.
```

**Paid mode (unlimited calls):**
```bash
pip install solsigs-mcp
export SOLSIGS_MCP_KEY="<your-base58-solana-private-key>"
solsigs-mcp
```

## Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "solsigs": {
      "command": "solsigs-mcp"
    }
  }
}
```

With a funded wallet:
```json
{
  "mcpServers": {
    "solsigs": {
      "command": "solsigs-mcp",
      "env": {
        "SOLSIGS_MCP_KEY": "<your-base58-solana-private-key>"
      }
    }
  }
}
```

## Cursor / VS Code

Add to `.cursor/mcp.json` (or `.vscode/mcp.json`):

```json
{
  "mcpServers": {
    "solsigs": {
      "command": "solsigs-mcp"
    }
  }
}
```

## SSE Mode (remote/multi-client)

```bash
export MCP_TRANSPORT=sse
export MCP_HOST=0.0.0.0
export SOLSIGS_MCP_KEY="<your-key>"   # optional
solsigs-mcp
# → SSE endpoint at http://0.0.0.0:3001/sse
```

Client config:
```json
{
  "mcpServers": {
    "solsigs": {
      "url": "http://localhost:3001/sse"
    }
  }
}
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
| `get_trenches` | Pump.fun memecoin trenches scanner | $0.003 |
| `ask_defi_question` | AI verdict on any Solana/DeFi question | $0.008 |
| `wallet_status` | Check wallet balance / free-tier count | Free |

## Configuration

| Env Var | Required | Default | Description |
|---------|----------|---------|-------------|
| `SOLSIGS_MCP_KEY` | No | — | Base58 Solana private key with USDC (omit for free tier) |
| `SOLANA_RPC_URL` | No | Mainnet public | Solana RPC endpoint |
| `SOLSIGS_BASE_URL` | No | `https://solsigs.com` | SolSigs API base |
| `MCP_TRANSPORT` | No | `stdio` | `stdio` or `sse` |
| `MCP_HOST` | No | `127.0.0.1` | SSE bind address |
| `MCP_PORT` | No | `3001` | SSE port |

### Wallet security

`SOLSIGS_MCP_KEY` is a live Solana private key held in process memory and used to sign transactions directly — treat the wallet it belongs to as a **dedicated, low-balance spending wallet**, not a savings wallet:

- Fund it with only what you expect to spend on API calls in the near term (each call costs fractions of a cent to a few cents of USDC).
- Never reuse a wallet that also holds other tokens, NFTs, or long-term balances.
- Rotate the key (generate a new wallet, transfer the balance, update `SOLSIGS_MCP_KEY`) if it may have been exposed — e.g. committed to git, pasted into a shared chat, or logged by a misconfigured client.
- Keep the key in `.env` (already gitignored) or your MCP client's env config, never in code or shell history.

## License

MIT
