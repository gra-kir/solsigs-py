"""
CrewAI Tools for SolSigs
========================
CrewAI-compatible tool wrappers for all 15 SolSigs Solana data endpoints.

Install:  pip install solsigs-py crewai
Usage:    from solsigs.crewai_tools import create_solsigs_crewai_tools
"""
from typing import Optional, Type, Any
from pydantic import BaseModel, Field
from crewai.tools import BaseTool as CrewAIBaseTool

from solsigs import SolSigsClient


class SolSigsDEXCrewAITool(CrewAIBaseTool):
    """Get real-time DEX price feed for a Solana token. Aggregated from Jupiter + Birdeye."""
    name: str = "solsigs_dex_price"
    description: str = (
        "Get real-time DEX price, liquidity, and volume data for any Solana token. "
        "Input: token symbol (e.g. 'SOL') or mint address. Returns USD price, liquidity, 24h volume."
    )

    free_tier_key: Optional[str] = None

    def _run(self, token: str) -> str:
        client = SolSigsClient(free_tier_key=self.free_tier_key)
        result = client.get_dex_price(token)
        return str(result)


class SolSigsArbCrewAITool(CrewAIBaseTool):
    """Scan for cross-DEX arbitrage opportunities with MEV risk scoring."""
    name: str = "solsigs_arb_scan"
    description: str = (
        "Scan Solana DEXs for arbitrage opportunities. Includes MEV scoring and sandwich attack detection. "
        "Input: min_spread_pct (optional, float). Returns profitable arb opportunities with risk analysis."
    )

    free_tier_key: Optional[str] = None

    def _run(self, min_spread_pct: float = 0.1) -> str:
        client = SolSigsClient(free_tier_key=self.free_tier_key)
        result = client.scan_arbitrage(min_spread_pct)
        return str(result)


class SolSigsWalletCrewAITool(CrewAIBaseTool):
    """Analyze wallet risk scoring and transaction history."""
    name: str = "solsigs_wallet_score"
    description: str = (
        "Get risk score, transaction history, and suspicious pattern detection for a Solana wallet. "
        "Input: wallet address. Returns risk score, wash trading detection, rug signals."
    )

    free_tier_key: Optional[str] = None

    def _run(self, address: str) -> str:
        client = SolSigsClient(free_tier_key=self.free_tier_key)
        result = client.score_wallet(address)
        return str(result)


class SolSigsLaunchCrewAITool(CrewAIBaseTool):
    """Detect new token launches on Solana with rug risk assessment."""
    name: str = "solsigs_launches"
    description: str = (
        "Detect recently launched Solana tokens on pump.fun and Raydium. "
        "Input: max_age_minutes (optional, int). Returns launch data with rug risk scoring."
    )

    free_tier_key: Optional[str] = None

    def _run(self, max_age_minutes: int = 60) -> str:
        client = SolSigsClient(free_tier_key=self.free_tier_key)
        result = client.detect_launches(max_age_minutes)
        return str(result)


class SolSigsSummaryCrewAITool(CrewAIBaseTool):
    """AI-powered on-chain summary for any address."""
    name: str = "solsigs_summary"
    description: str = (
        "Generate an AI-powered plain-English summary of on-chain activity for any Solana address. "
        "Input: address. Returns readable summary of wallet/contract/token activity."
    )

    free_tier_key: Optional[str] = None

    def _run(self, address: str) -> str:
        client = SolSigsClient(free_tier_key=self.free_tier_key)
        result = client.summarize_onchain(address)
        return str(result)


class SolSigsPredictCrewAITool(CrewAIBaseTool):
    """Query Polymarket prediction markets."""
    name: str = "solsigs_prediction_markets"
    description: str = (
        "Query Polymarket prediction markets for odds, volume, and liquidity across politics, crypto, sports. "
        "Input: query (optional), category (optional), limit (optional)."
    )

    free_tier_key: Optional[str] = None

    def _run(self, query: str = "", category: str = "", limit: int = 5) -> str:
        client = SolSigsClient(free_tier_key=self.free_tier_key)
        q = query if query else None
        cat = category if category else None
        result = client.prediction_markets(q, cat, limit)
        return str(result)


class SolSigsBatchPriceCrewAITool(CrewAIBaseTool):
    """Batch multi-token pricing with OHLCV candles."""
    name: str = "solsigs_batch_pricing"
    description: str = (
        "Get real-time prices and OHLCV candlestick data for multiple Solana tokens. "
        "Input: comma-separated token list, period (1h/4h/1d)."
    )

    free_tier_key: Optional[str] = None

    def _run(self, tokens: str, period: str = "1h") -> str:
        client = SolSigsClient(free_tier_key=self.free_tier_key)
        token_list = [t.strip() for t in tokens.split(",")]
        result = client.batch_token_pricing(token_list, period)
        return str(result)


class SolSigsNFTCrewAITool(CrewAIBaseTool):
    """NFT collection data including floor price and rarity."""
    name: str = "solsigs_nft"
    description: str = (
        "Get NFT collection floor price, rarity data, and wash trading detection from Tensor, Magic Eden, Solanart. "
        "Input: collection_slug (e.g. 'mad-lads')."
    )

    free_tier_key: Optional[str] = None

    def _run(self, collection_slug: str) -> str:
        client = SolSigsClient(free_tier_key=self.free_tier_key)
        result = client.nft_collection(collection_slug)
        return str(result)


class SolSigsStakingCrewAITool(CrewAIBaseTool):
    """Compare staking APY across Solana protocols."""
    name: str = "solsigs_staking"
    description: str = (
        "Compare staking APY for Solana across Marinade, Jito, BlazeStake, and Sanctum. "
        "Input: protocol (optional, or 'all')."
    )

    free_tier_key: Optional[str] = None

    def _run(self, protocol: str = "all") -> str:
        client = SolSigsClient(free_tier_key=self.free_tier_key)
        p = protocol if protocol and protocol != "all" else None
        result = client.staking_yields(p)
        return str(result)


class SolSigsWhaleCrewAITool(CrewAIBaseTool):
    """Track whale wallet transactions and smart money."""
    name: str = "solsigs_whale_tracker"
    description: str = (
        "Track large Solana wallet transactions — whale movements, accumulation signals. "
        "Input: min_amount_usd (optional, default 100000), token (optional), hours (optional, default 24)."
    )

    free_tier_key: Optional[str] = None

    def _run(self, min_amount_usd: float = 100000, token: str = "", hours: int = 24) -> str:
        client = SolSigsClient(free_tier_key=self.free_tier_key)
        t = token if token else None
        result = client.whale_tracker(min_amount_usd, t, hours)
        return str(result)


class SolSigsDevCrewAITool(CrewAIBaseTool):
    """Protocol developer activity and audit status."""
    name: str = "solsigs_dev_activity"
    description: str = (
        "Check development activity and audit status for Solana projects. "
        "Input: protocol name. Returns GitHub commits, contributors, audit data."
    )

    free_tier_key: Optional[str] = None

    def _run(self, protocol: str) -> str:
        client = SolSigsClient(free_tier_key=self.free_tier_key)
        result = client.protocol_dev_activity(protocol)
        return str(result)


class SolSigsSocialCrewAITool(CrewAIBaseTool):
    """On-chain social sentiment analysis."""
    name: str = "solsigs_social_sentiment"
    description: str = (
        "Analyze on-chain social sentiment — .sol namespace activity, influencer wallets, engagement scoring. "
        "Input: query (token/protocol/topic)."
    )

    free_tier_key: Optional[str] = None

    def _run(self, query: str) -> str:
        client = SolSigsClient(free_tier_key=self.free_tier_key)
        result = client.onchain_social(query)
        return str(result)


class SolSigsRPCCrewAITool(CrewAIBaseTool):
    """Optimized Solana RPC relay."""
    name: str = "solsigs_rpc"
    description: str = (
        "Make optimized Solana RPC calls through a load-balanced, rate-limited Helius endpoint. "
        "Input: method (getBalance, getAccountInfo, etc.), params (optional JSON)."
    )

    free_tier_key: Optional[str] = None

    def _run(self, method: str, params: str = "[]") -> str:
        import json
        client = SolSigsClient(free_tier_key=self.free_tier_key)
        p = json.loads(params) if params and params != "[]" else []
        result = client.rpc(method, p)
        return str(result)


# --- Tool Factory ---

def create_solsigs_crewai_tools(free_tier_key: Optional[str] = None) -> list[CrewAIBaseTool]:
    """Create all 13 SolSigs CrewAI tools.

    Args:
        free_tier_key: Optional free tier key for first 50 free calls.
                       Get one at https://solsigs.com/freetier

    Returns:
        List of CrewAI BaseTool instances ready for agent use.
    """
    return [
        SolSigsDEXCrewAITool(free_tier_key=free_tier_key),
        SolSigsArbCrewAITool(free_tier_key=free_tier_key),
        SolSigsWalletCrewAITool(free_tier_key=free_tier_key),
        SolSigsLaunchCrewAITool(free_tier_key=free_tier_key),
        SolSigsSummaryCrewAITool(free_tier_key=free_tier_key),
        SolSigsPredictCrewAITool(free_tier_key=free_tier_key),
        SolSigsBatchPriceCrewAITool(free_tier_key=free_tier_key),
        SolSigsNFTCrewAITool(free_tier_key=free_tier_key),
        SolSigsStakingCrewAITool(free_tier_key=free_tier_key),
        SolSigsWhaleCrewAITool(free_tier_key=free_tier_key),
        SolSigsDevCrewAITool(free_tier_key=free_tier_key),
        SolSigsSocialCrewAITool(free_tier_key=free_tier_key),
        SolSigsRPCCrewAITool(free_tier_key=free_tier_key),
    ]