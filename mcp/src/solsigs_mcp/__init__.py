"""SolSigs MCP Server — AI Agent Gateway to Solana Data.

Exposes 23 tools (22 SolSigs API endpoints + wallet_status) for AI agents.
Each tool handles the x402 v2 payment flow automatically: 402 → pay USDC → retry → result.

Supports stdio (local subprocess) and SSE (remote HTTP) transports.
No key required — starts in free-tier mode (50 calls) when SOLSIGS_MCP_KEY is unset.

Usage:
    solsigs-mcp                    # Start with stdio transport (free-tier or paid)
    MCP_TRANSPORT=sse solsigs-mcp  # Start with SSE on 127.0.0.1:3001
"""

__version__ = "0.2.0"
