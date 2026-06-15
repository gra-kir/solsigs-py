#!/usr/bin/env python3
"""
SolSigs MCP Server — AI Agent Gateway to Solana Data.

Exposes 21 tools (20 SolSigs API endpoints + wallet status). Each tool handles
the x402 v2 payment flow automatically: 402 → pay USDC → retry → result.

Supports both stdio (local subprocess) and SSE (remote HTTP) transports.
Set MCP_TRANSPORT=sse to expose via HTTP on MCP_HOST:MCP_PORT.

Requires:
  SOLSIGS_MCP_KEY=<base58 private key>     # wallet with USDC for payments
  SOLANA_RPC_URL=<rpc url>                # (optional) Solana RPC endpoint
  SOLSIGS_BASE_URL=<url>                  # (optional) SolSigs base URL
  MCP_TRANSPORT=stdio|sse                 # (optional, default: stdio)
  MCP_HOST=0.0.0.0                        # (optional, SSE only)
  MCP_PORT=3001                            # (optional, SSE only)
"""

import os
import sys

from mcp.server.fastmcp import FastMCP
from solders.keypair import Keypair
from solana.rpc.api import Client as SolanaClient
from spl.token.instructions import get_associated_token_address

from x402_client import X402Client, USDC_MINT, SOLANA_RPC


# ── Init ────────────────────────────────────────────────────────
_transport = os.environ.get("MCP_TRANSPORT", "stdio")
_mcp_host = os.environ.get("MCP_HOST", "127.0.0.1")
_mcp_port = int(os.environ.get("MCP_PORT", "3001"))

mcp = FastMCP(
    "SolSigs",
    instructions="Solana blockchain data via micropayments — DEX prices, arbitrage, wallet intel, token launches, AI summaries, RPC relay. Each tool costs fractions of a cent USDC.",
    host=_mcp_host,
    port=_mcp_port,
)

# ── Wallet Setup ────────────────────────────────────────────────
_key_env = os.environ.get("SOLSIGS_MCP_KEY", "")
if not _key_env:
    print("ERROR: SOLSIGS_MCP_KEY environment variable required (base58 private key)", file=sys.stderr)
    sys.exit(1)

_keypair = Keypair.from_base58_string(_key_env)
_client = X402Client(_keypair)
_solana = SolanaClient(SOLANA_RPC)
_usdc_ata = get_associated_token_address(_keypair.pubkey(), USDC_MINT)


def _wallet_info() -> dict:
    """Get wallet info for diagnostics."""
    try:
        bal = _solana.get_token_account_balance(_usdc_ata)
        usdc = float(bal.value.ui_amount or 0) if bal.value else 0
    except Exception:
        usdc = 0
    try:
        sol_bal = _solana.get_balance(_keypair.pubkey())
        sol = float(sol_bal.value) / 1e9 if sol_bal.value else 0
    except Exception:
        sol = 0
    return {
        "address": str(_keypair.pubkey()),
        "usdc_balance": usdc,
        "sol_balance": sol,
    }


# ── Tools ───────────────────────────────────────────────────────

@mcp.tool()
def get_dex_price(token: str = "SOL") -> dict:
    """Get real-time DEX price data for a Solana token. Returns price, liquidity, and volume across Jupiter and Birdeye aggregators.

    Args:
        token: Token symbol or mint address (e.g. 'SOL', 'BONK', or full mint address). Default 'SOL'.
    """
    return _client.call("/dex", {"token": token})


@mcp.tool()
def scan_arbitrage(token: str = "SOL", min_profit_bps: int = 10) -> dict:
    """Scan for cross-DEX arbitrage opportunities on Solana. Finds profitable trades between exchanges.

    Args:
        token: Token symbol or mint address. Default 'SOL'.
        min_profit_bps: Minimum profit in basis points (1 bps = 0.01%). Default 10.
    """
    return _client.call("/arb", {"token": token, "minProfitBps": min_profit_bps})


@mcp.tool()
def analyze_wallet(address: str) -> dict:
    """Analyze a Solana wallet for risk factors. Returns risk score, transaction patterns, wash trading detection, and rug pull indicators.

    Args:
        address: Solana wallet address to analyze (base58).
    """
    return _client.call("/wallet", {"address": address})


@mcp.tool()
def detect_token_launches(hours: int = 1) -> dict:
    """Detect new token launches on Solana. Spots fresh deployments on pump.fun and Raydium.

    Args:
        hours: Look back window in hours. Default 1.
    """
    return _client.call("/launches", {"hours": hours})


@mcp.tool()
def get_market_summary(query: str = "solana market overview") -> dict:
    """Get an AI-powered plain-English summary of Solana market conditions. Turns raw blockchain data into readable insights.

    Args:
        query: What you want to know about (e.g. 'memecoin activity', 'NFT volume', 'DeFi TVL'). Default 'solana market overview'.
    """
    return _client.call("/summary", {"query": query})


@mcp.tool()
def rpc_relay(method: str, params: list | None = None) -> dict:
    """Pay-per-call Solana RPC relay. Access the Helius RPC endpoint with built-in rate limiting via micropayments.

    Args:
        method: JSON-RPC method name (e.g. 'getBalance', 'getTokenAccountsByOwner', 'getTransaction').
        params: JSON-RPC params array. Default [].
    """
    return _client.call("/rpc", {
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params or [],
    })

@mcp.tool()
def get_prediction_market(query: str = "", category: str = "", limit: int = 10) -> dict:
    """Query Polymarket prediction markets via SolSigs. YES/NO contracts on real-world
    events — elections, sports, crypto, economics, pop culture.

    Each market shows: question, YES/NO prices, volume, liquidity, end date, category.
    Data sourced from Polymarket Gamma API (free, no auth).

    Args:
        query: Search term (e.g. "Bitcoin", "election", "FOMC"). Empty = trending.
        category: Filter by category. Options: crypto, politics, sports, science,
                 economics, world, pop-culture, gaming, space.
        limit: Max markets to return. Default 10, max 20.
    """
    return _client.call("/predict", {
        "query": query,
        "category": category,
        "limit": limit,
    })


@mcp.tool()
def get_batch_prices(tokens: list[str] | None = None, period: str | None = None) -> dict:
    """Batch multi-token pricing with OHLCV candlestick history and token metadata. Get prices, volume, market cap, and candlestick data for multiple tokens at once.

    Args:
        tokens: List of token symbols or mint addresses (e.g. ['SOL', 'BONK']). Default ['SOL'].
        period: Candlestick period: '1h', '4h', '1d', or '7d'. Optional.
    """
    payload = {}
    if tokens is not None:
        payload["tokens"] = tokens
    if period is not None:
        payload["period"] = period
    return _client.call("/price", payload)


@mcp.tool()
def get_nft_intel(collection_slug: str, sort_by: str | None = None) -> dict:
    """Get NFT collection floor prices, rarity rankings, and wash trading detection. Analyze any Solana NFT collection for market health and authenticity.

    Args:
        collection_slug: Collection slug (e.g. 'mad-lads', 'degen-ape', 'claynosaurz').
        sort_by: Sort results by 'floor', 'volume', or 'rarity'. Optional.
    """
    payload = {"collection": collection_slug}
    if sort_by is not None:
        payload["sortBy"] = sort_by
    return _client.call("/nft", payload)


@mcp.tool()
def get_staking_rates(protocol: str | None = None) -> dict:
    """Compare staking APY rates across Solana protocols. View current yields, TVL, and unstaking conditions for major liquid staking providers.

    Args:
        protocol: Filter by protocol: 'marinade', 'jito', 'blaze', 'sanctum', or 'all' (default).
    """
    payload = {}
    if protocol is not None:
        payload["protocol"] = protocol
    return _client.call("/staking", payload)


@mcp.tool()
def get_whale_activity(min_amount: float = 100000, token: str | None = None, hours: int = 24) -> dict:
    """Track whale wallet movements and smart money signals on Solana. Detect large transfers, accumulation patterns, and distribution events.

    Args:
        min_amount: Minimum transfer amount in USD to track. Default 100000.
        token: Filter by specific token symbol or mint. Optional.
        hours: Look-back window in hours. Default 24.
    """
    payload = {"minAmount": min_amount, "hours": hours}
    if token is not None:
        payload["token"] = token
    return _client.call("/whale", payload)


@mcp.tool()
def create_alert(alert_type: str, condition: str, webhook_url: str, expiry_hours: int = 72) -> dict:
    """Register a webhook alert for price, volume, whale, or launch events. Get notified via webhook when your conditions are met on-chain.

    Args:
        alert_type: Type of alert: 'price', 'volume', 'whale', or 'launch'.
        condition: Trigger condition (e.g. 'SOL > 200', 'volume > 1M', 'whale BUY > 50000').
        webhook_url: Your webhook URL to receive POST notifications.
        expiry_hours: Alert expires after this many hours. Default 72, max 168.
    """
    return _client.call("/alerts", {
        "type": alert_type,
        "condition": condition,
        "webhookUrl": webhook_url,
        "expiryHours": expiry_hours,
    })


@mcp.tool()
def get_dev_activity(protocol: str, days: int = 30) -> dict:
    """Check GitHub development activity for Solana protocols. Track commits, contributors, and audit status to gauge protocol health.

    Args:
        protocol: Protocol name (e.g. 'jupiter', 'marinade', 'drift', 'magiceden').
        days: Look-back window in days. Default 30.
    """
    return _client.call("/dev", {"protocol": protocol, "days": days})


@mcp.tool()
def get_social_sentiment(query: str, source: str | None = None, hours: int = 24) -> dict:
    """Analyze on-chain social sentiment for tokens and NFTs. Track mentions, influencer activity, and trending scores across social platforms.

    Args:
        query: Search term — token symbol, NFT collection, or keyword (e.g. 'SOL', 'BONK', 'Mad Lads').
        source: Data source: 'twitter', 'dune', or 'combined' (default).
        hours: Look-back window in hours. Default 24.
    """
    payload = {"query": query, "hours": hours}
    if source is not None:
        payload["source"] = source
    return _client.call("/social", payload)
@mcp.tool()
def track_smart_money(min_score: float = 30, top_n: int = 5, wallets: list[str] | None = None) -> dict:
    """Track top Solana smart-money wallets with copy-trade signals. Monitors whale portfolios, detects accumulation patterns, and scores wallets 0-100.

    Args:
        min_score: Minimum smart score threshold (default 30). Higher = more selective.
        top_n: Maximum number of wallets to return (default 5).
        wallets: Specific wallet addresses to track (optional — overrides smart-score filtering).
    """
    payload = {"minScore": min_score, "topN": top_n}
    if wallets is not None:
        payload["wallets"] = wallets
    return _client.call("/smartmoney", payload)



@mcp.tool()
def get_trending_tokens(limit: int = 20, sort_by: str = "volume") -> dict:
    """Get real-time trending tokens on Solana. Sorted by volume, price action, and social traction. Discover what's hot right now.

    Args:
        limit: Max tokens to return. Default 20.
        sort_by: Sort by 'volume', 'price_change', or 'social'. Default 'volume'.
    """
    return _client.call("/trending", {"limit": limit, "sortBy": sort_by})


@mcp.tool()
def check_token_safety(mint: str) -> dict:
    """Run a complete safety check on a Solana token. Holder distribution analysis, LP lock/mint detection, freeze/mint authority status, wash trading signals. Returns 0-100 safety score.

    Args:
        mint: Token mint address (base58).
    """
    return _client.call("/token-safety", {"mint": mint})


@mcp.tool()
def get_alpha_feed(limit: int = 10, min_confidence: int = 0) -> dict:
    """Get the alpha feed — new token launches plus insider and smart-money activity signals. High-signal early intelligence for traders and agents.

    Args:
        limit: Max signals to return. Default 10.
        min_confidence: Minimum confidence score 0-100. Default 0 (all).
    """
    return _client.call("/alpha", {"limit": limit, "minConfidence": min_confidence})


@mcp.tool()
def get_wallet_trust(address: str) -> dict:
    """Get a comprehensive trust/reputation score for any Solana wallet. Extends wallet analysis with age, behavior patterns, protocol interactions, and wash trading flags.

    Args:
        address: Solana wallet address to check (base58).
    """
    return _client.call("/trust", {"address": address})


@mcp.tool()
def get_perps_data(action: str = "markets", token: str | None = None, address: str | None = None) -> dict:
    """Perpetuals and derivatives intelligence for Solana. Jupiter Perps + Drift protocol data: market listings, open interest, funding rates, and position tracking.

    Args:
        action: What to query: 'markets' (list all perp markets), 'funding' (funding rates), or 'positions' (wallet positions — requires address param).
        token: Optional token symbol to filter (e.g. 'SOL', 'BTC'). Only for 'markets' and 'funding'.
        address: Wallet address for position tracking. Only required when action='positions'.
    """
    payload = {"action": action}
    if token is not None:
        payload["token"] = token
    if address is not None:
        payload["address"] = address
    return _client.call("/perps", payload)

@mcp.tool()
def wallet_status() -> dict:
    """Get the MCP wallet status — USDC balance and Solana address. Use this to check if the wallet has funds for payments before calling other tools."""
    return _wallet_info()


# ── Main ────────────────────────────────────────────────────────
if __name__ == "__main__":
    info = _wallet_info()

    print(f"SolSigs MCP Server starting ({_transport})...", file=sys.stderr)
    print(f"  Wallet: {info['address']}", file=sys.stderr)
    print(f"  USDC:   {info['usdc_balance']:.6f}", file=sys.stderr)
    print(f"  SOL:    {info['sol_balance']:.6f}", file=sys.stderr)

    if _transport == "sse":
        print(f"  SSE:    http://{_mcp_host}:{_mcp_port}/sse", file=sys.stderr)
        mcp.run(transport="sse")
    else:
        mcp.run()