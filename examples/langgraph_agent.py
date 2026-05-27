"""
LangGraph Agent Example using SolSigs
=====================================
Full example: an autonomous agent that can query live Solana data
with x402 micropayment handling.
"""

from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import MemorySaver
from langchain_openai import ChatOpenAI
from solsigs.langgraph_tools import SOLSIGS_LANGGRAPH_TOOLS


def create_solsigs_agent(openai_api_key: str | None = None):
    """Create a LangGraph agent with SolSigs tools.

    The agent can:
    - Check real-time DEX prices for any Solana token
    - Score wallets for risk and on-chain activity
    - Scan for arbitrage opportunities
    - Detect early token launches

    Args:
        openai_api_key: OpenAI API key (defaults to OPENAI_API_KEY env var)

    Returns:
        A LangGraph agent ready for invocation
    """
    model = ChatOpenAI(
        model="gpt-4o",
        temperature=0,
        api_key=openai_api_key,
    )

    # Memory keeps conversation context across turns
    memory = MemorySaver()

    agent = create_react_agent(
        model=model,
        tools=SOLSIGS_LANGGRAPH_TOOLS,
        checkpointer=memory,
    )

    return agent


# --- Example Usage ---

async def main():
    agent = create_solsigs_agent()

    config = {"configurable": {"thread_id": "demo-session"}}

    # Example 1: Price check
    result = await agent.ainvoke(
        {
            "messages": [
                {
                    "role": "user",
                    "content": "What's the current price of BONK on Solana?",
                }
            ]
        },
        config=config,
    )
    print("Price query result:", result["messages"][-1].content)

    # Example 2: Wallet analysis
    result = await agent.ainvoke(
        {
            "messages": [
                {
                    "role": "user",
                    "content": "Analyze wallet 7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV for risk",
                }
            ]
        },
        config=config,
    )
    print("Wallet analysis:", result["messages"][-1].content)

    # Example 3: Arbitrage scan
    result = await agent.ainvoke(
        {
            "messages": [
                {
                    "role": "user",
                    "content": "Scan for arbitrage opportunities with at least 0.5% spread",
                }
            ]
        },
        config=config,
    )
    print("Arb scan:", result["messages"][-1].content)


async def advanced_example():
    """Multi-step: agent uses multiple tools in sequence."""
    agent = create_solsigs_agent()
    config = {"configurable": {"thread_id": "multi-step"}}

    result = await agent.ainvoke(
        {
            "messages": [
                {
                    "role": "user",
                    "content": (
                        "I'm looking for new token launches in the last hour. "
                        "For any tokens found, check their price and score the "
                        "deployer wallet for risk."
                    ),
                }
            ]
        },
        config=config,
    )
    print("Multi-step result:", result["messages"][-1].content)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())