"""
SolSigs Python Client
=====================
Pay-per-call Solana data APIs for AI agents via x402 micropayments.

Usage:
    from solsigs import SolSigsClient

    client = SolSigsClient()
    price = client.get_dex_price("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263")
    print(price)
"""

import requests
import base64
import json
from typing import Optional, Any
from dataclasses import dataclass

SOLSIGS_BASE = "https://solsigs.com"
PAYMENT_WALLET = "HZAkkKbhN9hfJBiNxCuwap7XtPXgniy9MVjJR2MvHSJi"


@dataclass
class PaymentRequired:
    """Returned when the endpoint requires x402 payment."""
    endpoint: str
    price_usdc: str
    wallet: str
    network: str


class SolSigsClient:
    """Client for SolSigs x402 Solana data APIs.

    Handles the x402 payment flow:
    1. Call endpoint → get 402 Payment Required
    2. Pay USDC to the wallet address
    3. Retry with payment proof → get data
    """

    def __init__(self, base_url: str = SOLSIGS_BASE, payer_keypair=None):
        self.base_url = base_url.rstrip("/")
        self.payer = payer_keypair

    def _handle_response(self, response: requests.Response) -> Any:
        if response.status_code == 200:
            return response.json()
        elif response.status_code == 402:
            payment_info = response.json()
            return PaymentRequired(
                endpoint=response.url,
                price_usdc=payment_info.get("price", "unknown"),
                wallet=payment_info.get("payTo", PAYMENT_WALLET),
                network=payment_info.get("network", "solana"),
            )
        else:
            response.raise_for_status()

    def _post(self, path: str, payload: dict, payment_tx: Optional[str] = None) -> Any:
        url = f"{self.base_url}{path}"
        headers = {"Content-Type": "application/json"}
        if payment_tx:
            headers["X-PAYMENT"] = payment_tx

        resp = requests.post(url, json=payload, headers=headers, timeout=30)
        return self._handle_response(resp)

    def get_dex_price(self, token: str) -> Any:
        """Get DEX price feed for a token (Jupiter + Birdeye aggregation).

        Args:
            token: Token mint address or symbol (e.g., 'SOL', 'USDC', or a mint address)

        Returns:
            Price data dict or PaymentRequired if payment is needed.
            Price: $0.002 USDC per call.
        """
        return self._post("/dex", {"token": token})

    def scan_arbitrage(self, min_spread_pct: float = 0.1) -> Any:
        """Scan for arbitrage opportunities across Solana DEXs.

        Args:
            min_spread_pct: Minimum spread percentage to report

        Returns:
            List of arb opportunities or PaymentRequired.
            Price: $0.010 USDC per call.
        """
        return self._post("/arb", {"min_spread_pct": min_spread_pct})

    def score_wallet(self, address: str) -> Any:
        """Get wallet risk score and activity stats.

        Args:
            address: Solana wallet address to analyze

        Returns:
            Wallet intelligence report or PaymentRequired.
            Price: $0.005 USDC per call.
        """
        return self._post("/wallet", {"address": address})

    def detect_launches(self, max_age_minutes: int = 60) -> Any:
        """Detect early token launches with rug risk assessment.

        Args:
            max_age_minutes: Max token age in minutes to consider

        Returns:
            Launch detection results or PaymentRequired.
            Price: $0.003 USDC per call.
        """
        return self._post("/launches", {"max_age_minutes": max_age_minutes})

    def summarize_onchain(self, address: str) -> Any:
        """Get AI-powered summary of on-chain data for an address.

        Args:
            address: Wallet, token, or contract address to summarize

        Returns:
            AI-generated summary or PaymentRequired.
            Price: $0.008 USDC per call.
        """
        return self._post("/summary", {"address": address})

    def rpc(self, method: str, params: list = None) -> Any:
        """Make an optimized RPC call with load balancing.

        Args:
            method: RPC method name (e.g., 'getBalance', 'getAccountInfo')
            params: RPC method parameters

        Returns:
            RPC response or PaymentRequired.
            Price: $0.001 USDC per call.
        """
        return self._post("/rpc", {"method": method, "params": params or []})


# --- x402 Payment Helper ---
# Agents using solsigs-py can integrate their own wallet for automated payment.
# Example below shows the flow with a provided Solana keypair.

def pay_with_keypair(client: SolSigsClient, keypair, result: PaymentRequired):
    """Handle x402 payment using a Solana keypair.

    This is an example — integrate your agent's wallet instead.
    """
    from solana.rpc.api import Client as SolanaClient
    from solana.transaction import Transaction
    from solders.pubkey import Pubkey
    from solders.system_program import TransferParams, transfer

    if not isinstance(result, PaymentRequired):
        return result  # Already got data, no payment needed

    solana = SolanaClient("https://api.mainnet-beta.solana.com")

    # Convert USDC amount to lamports equivalent (simplified — use actual USDC SPL transfer)
    amount_lamports = int(float(result.price_usdc) * 1e6)  # USDC has 6 decimals

    # Build transfer
    tx = Transaction().add(
        transfer(
            TransferParams(
                from_pubkey=keypair.pubkey(),
                to_pubkey=Pubkey.from_string(result.wallet),
                lamports=amount_lamports,
            )
        )
    )

    # Sign and send
    tx.sign(keypair)
    tx_sig = solana.send_transaction(tx).value

    # Retry with payment
    sig_b64 = base64.b64encode(bytes(tx_sig)).decode()
    # Re-call would happen at the agent level
    return tx_sig