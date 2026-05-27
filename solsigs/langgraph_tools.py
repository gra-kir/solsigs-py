"""
LangGraph Tool for SolSigs
==========================
Drop-in tool for LangGraph agents to query live Solana data
with x402 micropayment handling.
"""

from langchain_core.tools import tool
from solsigs import SolSigsClient, PaymentRequired

client = SolSigsClient()


@tool
def solana_dex_price(token: str) -> str:
    """Get real-time DEX price for a Solana token using SolSigs.

    Uses Jupiter + Birdeye aggregation. Costs $0.002 USDC via x402.

    Args:
        token: Token mint address or symbol (e.g., 'SOL', 'BONK', or a mint address)
    """
    result = client.get_dex_price(token)
    if isinstance(result, PaymentRequired):
        return f"Payment required: {result.price_usdc} USDC to {result.wallet}"
    return str(result)


@tool
def solana_wallet_score(address: str) -> str:
    """Score a Solana wallet for risk and activity using SolSigs.

    Costs $0.005 USDC via x402.

    Args:
        address: Solana wallet address to analyze
    """
    result = client.score_wallet(address)
    if isinstance(result, PaymentRequired):
        return f"Payment required: {result.price_usdc} USDC to {result.wallet}"
    return str(result)


@tool
def solana_arbitrage_scan(min_spread_pct: float = 0.1) -> str:
    """Scan for arbitrage opportunities across Solana DEXs using SolSigs.

    Costs $0.010 USDC via x402.

    Args:
        min_spread_pct: Minimum spread percentage (default 0.1)
    """
    result = client.scan_arbitrage(min_spread_pct)
    if isinstance(result, PaymentRequired):
        return f"Payment required: {result.price_usdc} USDC to {result.wallet}"
    return str(result)


@tool
def solana_token_launches(max_age_minutes: int = 60) -> str:
    """Detect early Solana token launches with rug risk assessment.

    Costs $0.003 USDC via x402.

    Args:
        max_age_minutes: Maximum token age in minutes (default 60)
    """
    result = client.detect_launches(max_age_minutes)
    if isinstance(result, PaymentRequired):
        return f"Payment required: {result.price_usdc} USDC to {result.wallet}"
    return str(result)


# List of all tools for easy import
SOLSIGS_LANGGRAPH_TOOLS = [
    solana_dex_price,
    solana_wallet_score,
    solana_arbitrage_scan,
    solana_token_launches,
]