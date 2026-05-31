"""
LangGraph Tools for SolSigs
===========================
Drop-in tools for LangGraph agents to query live Solana data
with x402 micropayment handling. 15 tools covering all 14 endpoints + Polymarket.

Usage:
    from solsigs.langgraph_tools import SOLSIGS_LANGGRAPH_TOOLS
    from langgraph.prebuilt import create_react_agent

    agent = create_react_agent(model, SOLSIGS_LANGGRAPH_TOOLS)
"""

from langchain_core.tools import tool
from solsigs import SolSigsClient, PaymentRequired

client = SolSigsClient()


def _handle(result):
    """Handle x402 payment or return data."""
    if isinstance(result, PaymentRequired):
        return f"Payment required: {result.price_usdc} USDC to {result.wallet} on {result.network}"
    return str(result)


# --- Original 7 Tools ---

@tool
def solana_dex_price(token: str) -> str:
    """Get real-time DEX price for a Solana token. Costs $0.002 USDC."""
    return _handle(client.get_dex_price(token))


@tool
def solana_wallet_score(address: str) -> str:
    """Score a Solana wallet for risk and activity. Costs $0.005 USDC."""
    return _handle(client.score_wallet(address))


@tool
def solana_arbitrage_scan(min_spread_pct: float = 0.1) -> str:
    """Scan for arbitrage across Solana DEXs. Costs $0.010 USDC."""
    return _handle(client.scan_arbitrage(min_spread_pct))


@tool
def solana_token_launches(max_age_minutes: int = 60) -> str:
    """Detect early Solana token launches with rug risk. Costs $0.003 USDC."""
    return _handle(client.detect_launches(max_age_minutes))


@tool
def solana_prediction_markets(query: str = "", category: str = "", limit: int = 5) -> str:
    """Query Polymarket prediction markets. Costs $0.003 USDC."""
    return _handle(client.prediction_markets(query=query or None, category=category or None, limit=limit))


@tool
def solana_market_summary(address: str) -> str:
    """AI-powered on-chain summary for a wallet/token. Costs $0.008 USDC."""
    return _handle(client.summarize_onchain(address))


@tool
def solana_rpc_relay(method: str, params: str = "[]") -> str:
    """Pay-per-call Helius RPC relay. Costs $0.001 USDC.
    
    Args:
        method: RPC method (e.g., 'getBalance', 'getAccountInfo')
        params: JSON array of params (e.g., '[\"address\"]')
    """
    import json
    return _handle(client.rpc(method, json.loads(params) if params else []))


# --- New 7 Tools (2026-05-30) ---

@tool
def solana_batch_pricing(tokens: str, period: str = "1h") -> str:
    """Batch multi-token pricing + OHLCV candles. Costs $0.003 USDC.
    
    Args:
        tokens: Comma-separated token symbols or mints (e.g., 'SOL,BONK,WIF')
        period: Candle period (1h, 4h, 1d)
    """
    return _handle(client.batch_token_pricing(tokens.split(","), period))


@tool
def solana_nft_collection(collection_slug: str, sort_by: str = "volume") -> str:
    """NFT floor price, rarity, and wash trading data. Costs $0.004 USDC.
    
    Args:
        collection_slug: Collection name (e.g., 'mad-lads', 'degen-ape')
        sort_by: Sort order (volume, floor, sales)
    """
    return _handle(client.nft_collection(collection_slug, sort_by))


@tool
def solana_staking_yields(protocol: str = "") -> str:
    """Compare staking APY across Solana protocols. Costs $0.002 USDC.
    
    Args:
        protocol: Specific protocol or empty for all (Marinade, Jito, BlazeStake, Sanctum)
    """
    return _handle(client.staking_yields(protocol or None))


@tool
def solana_whale_tracker(min_amount: float = 100000, token: str = "", hours: int = 24) -> str:
    """Track whale wallet transactions and smart money. Costs $0.006 USDC.
    
    Args:
        min_amount: Minimum USD transaction amount to track
        token: Optional token filter
        hours: Lookback window
    """
    return _handle(client.whale_tracker(min_amount, token or None, hours))


@tool
def solana_webhook_alert(alert_type: str, condition: str, webhook_url: str) -> str:
    """Register a webhook alert for on-chain events. Costs $0.005 USDC.
    
    Args:
        alert_type: Alert type (price, whale, launch, arb)
        condition: Trigger (e.g., 'SOL < 150', 'whale > 100k')
        webhook_url: URL to receive alerts
    """
    return _handle(client.create_alert(alert_type, condition, webhook_url))


@tool
def solana_protocol_dev(protocol: str, days: int = 30) -> str:
    """Protocol dev activity and audit status. Costs $0.001 USDC.
    
    Args:
        protocol: Protocol name or contract address
        days: Lookback window
    """
    return _handle(client.protocol_dev_activity(protocol, days))


@tool
def solana_onchain_social(query: str, source: str = "", hours: int = 24) -> str:
    """On-chain social sentiment for tokens/protocols. Costs $0.004 USDC.
    
    Args:
        query: Token, protocol, or topic to analyze
        source: Optional source filter
        hours: Lookback window
    """
    return _handle(client.onchain_social(query, source or None, hours))


# All 15 tools
SOLSIGS_LANGGRAPH_TOOLS = [
    solana_dex_price,
    solana_batch_pricing,
    solana_wallet_score,
    solana_arbitrage_scan,
    solana_token_launches,
    solana_nft_collection,
    solana_staking_yields,
    solana_whale_tracker,
    solana_webhook_alert,
    solana_protocol_dev,
    solana_onchain_social,
    solana_prediction_markets,
    solana_market_summary,
    solana_rpc_relay,
]
