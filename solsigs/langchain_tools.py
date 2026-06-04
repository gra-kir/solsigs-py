"""
LangChain Tools for SolSigs
===========================
LangChain-compatible tool wrappers for all 15 SolSigs Solana data endpoints.

Install:  pip install solsigs-py langchain-core
Usage:    from solsigs.langchain_tools import SOLSIGS_TOOLS
"""
from typing import Optional, Type, Any
from pydantic import BaseModel, Field
from langchain_core.tools import BaseTool

from solsigs import SolSigsClient

# --- Tool Input Schemas ---

class TokenInput(BaseModel):
    token: str = Field(..., description="Token mint address or symbol (e.g. SOL, USDC, or mint address)")

class WalletInput(BaseModel):
    address: str = Field(..., description="Solana wallet address to analyze")

class ArbitrageInput(BaseModel):
    min_spread_pct: float = Field(0.1, description="Minimum spread percentage to report")

class LaunchInput(BaseModel):
    max_age_minutes: int = Field(60, description="Max token age in minutes to consider")

class SummaryInput(BaseModel):
    address: str = Field(..., description="Wallet, token, or contract address to summarize")

class RPCInput(BaseModel):
    method: str = Field(..., description="RPC method name (e.g. getBalance, getAccountInfo)")
    params: Optional[list] = Field(default=[], description="RPC method parameters")

class PredictionInput(BaseModel):
    query: Optional[str] = Field(None, description="Search query for markets")
    category: Optional[str] = Field(None, description="Market category filter")
    limit: int = Field(5, description="Max results to return")

class BatchPriceInput(BaseModel):
    tokens: list = Field(..., description="List of token mint addresses or symbols")
    period: str = Field("1h", description="Candle period: 1h, 4h, 1d")

class NFTInput(BaseModel):
    collection_slug: str = Field(..., description="Collection slug (e.g. mad-lads, degen-ape)")
    sort_by: str = Field("volume", description="Sort order: volume, floor, sales")

class StakingInput(BaseModel):
    protocol: Optional[str] = Field(None, description="Protocol: Marinade, Jito, BlazeStake, Sanctum (or all)")

class WhaleInput(BaseModel):
    min_amount: float = Field(100000, description="Minimum transaction amount in USD")
    token: Optional[str] = Field(None, description="Optional token filter")
    hours: int = Field(24, description="Lookback window in hours")

class AlertInput(BaseModel):
    alert_type: str = Field(..., description="Alert type: price, whale, launch, arb")
    condition: str = Field(..., description="Trigger condition (e.g. SOL < 150)")
    webhook_url: str = Field(..., description="Webhook URL to POST alerts to")

class DevInput(BaseModel):
    protocol: str = Field(..., description="Protocol name or contract address")
    days: int = Field(30, description="Lookback window in days")

class SocialInput(BaseModel):
    query: str = Field(..., description="Search query (token, protocol, or topic)")
    source: Optional[str] = Field(None, description="Optional source filter")
    hours: int = Field(24, description="Lookback window in hours")


# --- Tool Classes ---

class SolSigsDEXTool(BaseTool):
    """Get real-time DEX price data for a Solana token from Jupiter + Birdeye aggregation."""
    name: str = "solsigs_dex_price"
    description: str = "Get DEX price, liquidity, and volume data for a Solana token. Input: token symbol or mint address."
    args_schema: Type[BaseModel] = TokenInput
    return_direct: bool = False

    client: SolSigsClient | None = None
    free_tier_key: Optional[str] = None

    def __init__(self, free_tier_key: Optional[str] = None, **kwargs):
        super().__init__(**kwargs)
        self.client = SolSigsClient(free_tier_key=free_tier_key)

    def _run(self, token: str) -> Any:
        return self.client.get_dex_price(token)

    async def _arun(self, token: str) -> Any:
        return self._run(token)


class SolSigsWalletTool(BaseTool):
    """Analyze a Solana wallet for risk scoring, transaction history, and suspicious patterns."""
    name: str = "solsigs_wallet_score"
    description: str = "Get risk score and activity analysis for a Solana wallet address. Detects suspicious patterns."
    args_schema: Type[BaseModel] = WalletInput

    client: SolSigsClient | None = None

    def __init__(self, free_tier_key: Optional[str] = None, **kwargs):
        super().__init__(**kwargs)
        self.client = SolSigsClient(free_tier_key=free_tier_key)

    def _run(self, address: str) -> Any:
        return self.client.score_wallet(address)

    async def _arun(self, address: str) -> Any:
        return self._run(address)


class SolSigsArbTool(BaseTool):
    """Scan for cross-DEX arbitrage opportunities on Solana with MEV scoring."""
    name: str = "solsigs_arb_scan"
    description: str = "Scan for arbitrage opportunities across Solana DEXs with MEV risk scoring."
    args_schema: Type[BaseModel] = ArbitrageInput

    client: SolSigsClient | None = None

    def __init__(self, free_tier_key: Optional[str] = None, **kwargs):
        super().__init__(**kwargs)
        self.client = SolSigsClient(free_tier_key=free_tier_key)

    def _run(self, min_spread_pct: float = 0.1) -> Any:
        return self.client.scan_arbitrage(min_spread_pct)

    async def _arun(self, min_spread_pct: float = 0.1) -> Any:
        return self._run(min_spread_pct)


class SolSigsLaunchTool(BaseTool):
    """Detect newly launched Solana tokens with rug-pull risk assessment."""
    name: str = "solsigs_launches"
    description: str = "Detect recently launched Solana tokens with rug risk scoring. Includes pump.fun and Raydium launches."
    args_schema: Type[BaseModel] = LaunchInput

    client: SolSigsClient | None = None

    def __init__(self, free_tier_key: Optional[str] = None, **kwargs):
        super().__init__(**kwargs)
        self.client = SolSigsClient(free_tier_key=free_tier_key)

    def _run(self, max_age_minutes: int = 60) -> Any:
        return self.client.detect_launches(max_age_minutes)

    async def _arun(self, max_age_minutes: int = 60) -> Any:
        return self._run(max_age_minutes)


class SolSigsSummaryTool(BaseTool):
    """Generate AI-powered plain-English summary of on-chain data."""
    name: str = "solsigs_summary"
    description: str = "Get an AI-powered plain-English summary of on-chain activity for any Solana address."
    args_schema: Type[BaseModel] = SummaryInput

    client: SolSigsClient | None = None

    def __init__(self, free_tier_key: Optional[str] = None, **kwargs):
        super().__init__(**kwargs)
        self.client = SolSigsClient(free_tier_key=free_tier_key)

    def _run(self, address: str) -> Any:
        return self.client.summarize_onchain(address)

    async def _arun(self, address: str) -> Any:
        return self._run(address)


class SolSigsRPCTool(BaseTool):
    """Make optimized Solana RPC calls through a load-balanced, rate-limited endpoint."""
    name: str = "solsigs_rpc"
    description: str = "Make an optimized Solana RPC call through a shared Helius endpoint. Methods: getBalance, getAccountInfo, etc."
    args_schema: Type[BaseModel] = RPCInput

    client: SolSigsClient | None = None

    def __init__(self, free_tier_key: Optional[str] = None, **kwargs):
        super().__init__(**kwargs)
        self.client = SolSigsClient(free_tier_key=free_tier_key)

    def _run(self, method: str, params: list = None) -> Any:
        return self.client.rpc(method, params)

    async def _arun(self, method: str, params: list = None) -> Any:
        return self._run(method, params)


class SolSigsPredictTool(BaseTool):
    """Query Polymarket prediction market data."""
    name: str = "solsigs_prediction_markets"
    description: str = "Query Polymarket prediction markets — odds, volume, liquidity for politics, crypto, sports."
    args_schema: Type[BaseModel] = PredictionInput

    client: SolSigsClient | None = None

    def __init__(self, free_tier_key: Optional[str] = None, **kwargs):
        super().__init__(**kwargs)
        self.client = SolSigsClient(free_tier_key=free_tier_key)

    def _run(self, query: str = None, category: str = None, limit: int = 5) -> Any:
        return self.client.prediction_markets(query, category, limit)

    async def _arun(self, query: str = None, category: str = None, limit: int = 5) -> Any:
        return self._run(query, category, limit)


class SolSigsBatchPriceTool(BaseTool):
    """Get batch multi-token pricing with OHLCV candlestick history."""
    name: str = "solsigs_batch_pricing"
    description: str = "Get real-time prices and OHLCV candles for multiple Solana tokens at once."
    args_schema: Type[BaseModel] = BatchPriceInput

    client: SolSigsClient | None = None

    def __init__(self, free_tier_key: Optional[str] = None, **kwargs):
        super().__init__(**kwargs)
        self.client = SolSigsClient(free_tier_key=free_tier_key)

    def _run(self, tokens: list, period: str = "1h") -> Any:
        return self.client.batch_token_pricing(tokens, period)

    async def _arun(self, tokens: list, period: str = "1h") -> Any:
        return self._run(tokens, period)


class SolSigsNFTTool(BaseTool):
    """Get NFT collection floor price, rarity, and wash trading detection."""
    name: str = "solsigs_nft"
    description: str = "Get NFT collection floor prices, rarity data, and wash trading detection from Tensor, Magic Eden, Solanart."
    args_schema: Type[BaseModel] = NFTInput

    client: SolSigsClient | None = None

    def __init__(self, free_tier_key: Optional[str] = None, **kwargs):
        super().__init__(**kwargs)
        self.client = SolSigsClient(free_tier_key=free_tier_key)

    def _run(self, collection_slug: str, sort_by: str = "volume") -> Any:
        return self.client.nft_collection(collection_slug, sort_by)

    async def _arun(self, collection_slug: str, sort_by: str = "volume") -> Any:
        return self._run(collection_slug, sort_by)


class SolSigsStakingTool(BaseTool):
    """Compare staking APY across Solana protocols."""
    name: str = "solsigs_staking"
    description: str = "Compare staking APY for Solana across Marinade, Jito, BlazeStake, and Sanctum."
    args_schema: Type[BaseModel] = StakingInput

    client: SolSigsClient | None = None

    def __init__(self, free_tier_key: Optional[str] = None, **kwargs):
        super().__init__(**kwargs)
        self.client = SolSigsClient(free_tier_key=free_tier_key)

    def _run(self, protocol: str = None) -> Any:
        return self.client.staking_yields(protocol)

    async def _arun(self, protocol: str = None) -> Any:
        return self._run(protocol)


class SolSigsWhaleTool(BaseTool):
    """Track whale wallet transactions and smart money flows."""
    name: str = "solsigs_whale_tracker"
    description: str = "Track large Solana wallet transactions — whale movements, accumulation signals, copy-trade discovery."
    args_schema: Type[BaseModel] = WhaleInput

    client: SolSigsClient | None = None

    def __init__(self, free_tier_key: Optional[str] = None, **kwargs):
        super().__init__(**kwargs)
        self.client = SolSigsClient(free_tier_key=free_tier_key)

    def _run(self, min_amount: float = 100000, token: str = None, hours: int = 24) -> Any:
        return self.client.whale_tracker(min_amount, token, hours)

    async def _arun(self, min_amount: float = 100000, token: str = None, hours: int = 24) -> Any:
        return self._run(min_amount, token, hours)


class SolSigsAlertTool(BaseTool):
    """Register webhook alerts for on-chain events."""
    name: str = "solsigs_create_alert"
    description: str = "Register a webhook alert for Solana events: price thresholds, whale movements, new launches, arb opportunities."
    args_schema: Type[BaseModel] = AlertInput

    client: SolSigsClient | None = None

    def __init__(self, free_tier_key: Optional[str] = None, **kwargs):
        super().__init__(**kwargs)
        self.client = SolSigsClient(free_tier_key=free_tier_key)

    def _run(self, alert_type: str, condition: str, webhook_url: str) -> Any:
        return self.client.create_alert(alert_type, condition, webhook_url)

    async def _arun(self, alert_type: str, condition: str, webhook_url: str) -> Any:
        return self._run(alert_type, condition, webhook_url)


class SolSigsDevTool(BaseTool):
    """Check protocol developer activity and audit status."""
    name: str = "solsigs_dev_activity"
    description: str = "Check GitHub commit frequency, contributor counts, and audit status for Solana projects."
    args_schema: Type[BaseModel] = DevInput

    client: SolSigsClient | None = None

    def __init__(self, free_tier_key: Optional[str] = None, **kwargs):
        super().__init__(**kwargs)
        self.client = SolSigsClient(free_tier_key=free_tier_key)

    def _run(self, protocol: str, days: int = 30) -> Any:
        return self.client.protocol_dev_activity(protocol, days)

    async def _arun(self, protocol: str, days: int = 30) -> Any:
        return self._run(protocol, days)


class SolSigsSocialTool(BaseTool):
    """Analyze on-chain social sentiment for tokens and protocols."""
    name: str = "solsigs_social_sentiment"
    description: str = "Analyze on-chain social sentiment — .sol namespace activity, influencer wallet tracking, engagement scoring."
    args_schema: Type[BaseModel] = SocialInput

    client: SolSigsClient | None = None

    def __init__(self, free_tier_key: Optional[str] = None, **kwargs):
        super().__init__(**kwargs)
        self.client = SolSigsClient(free_tier_key=free_tier_key)

    def _run(self, query: str, source: str = None, hours: int = 24) -> Any:
        return self.client.onchain_social(query, source, hours)

    async def _arun(self, query: str, source: str = None, hours: int = 24) -> Any:
        return self._run(query, source, hours)


# --- Tool Collections ---

def create_solsigs_tools(free_tier_key: Optional[str] = None) -> list[BaseTool]:
    """Create all 14 SolSigs LangChain tools.

    Args:
        free_tier_key: Optional free tier key for first 50 free API calls.
                       Get one at https://solsigs.com/freetier

    Returns:
        List of LangChain BaseTool instances ready for agent use.
    """
    tools = [
        SolSigsDEXTool(free_tier_key=free_tier_key),
        SolSigsArbTool(free_tier_key=free_tier_key),
        SolSigsWalletTool(free_tier_key=free_tier_key),
        SolSigsLaunchTool(free_tier_key=free_tier_key),
        SolSigsSummaryTool(free_tier_key=free_tier_key),
        SolSigsPredictTool(free_tier_key=free_tier_key),
        SolSigsBatchPriceTool(free_tier_key=free_tier_key),
        SolSigsNFTTool(free_tier_key=free_tier_key),
        SolSigsStakingTool(free_tier_key=free_tier_key),
        SolSigsWhaleTool(free_tier_key=free_tier_key),
        SolSigsAlertTool(free_tier_key=free_tier_key),
        SolSigsDevTool(free_tier_key=free_tier_key),
        SolSigsSocialTool(free_tier_key=free_tier_key),
        SolSigsRPCTool(free_tier_key=free_tier_key),
    ]
    return tools


# Convenience: create tools with default no-auth client
SOLSIGS_TOOLS = create_solsigs_tools()