"""
x402 Payment Client for SolSigs MCP Server.

Handles the full x402 v2 payment flow:
1. POST to endpoint → receive 402 with PAYMENT-REQUIRED header
2. Parse payment details, build USDC transfer, sign & send
3. Retry with PAYMENT-SIGNATURE header → receive result
"""

import base64
import json
import os
import time
from dataclasses import dataclass

import httpx
from solana.rpc.api import Client as SolanaClient
from solana.rpc.types import TxOpts
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.transaction import Transaction
from spl.token.constants import TOKEN_PROGRAM_ID
from spl.token.instructions import get_associated_token_address, transfer_checked, TransferCheckedParams


# ── Constants ──────────────────────────────────────────────────
USDC_MINT = Pubkey.from_string("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")
SOLANA_RPC = os.environ.get("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com")
SOLSIGS_BASE = os.environ.get("SOLSIGS_BASE_URL", "https://solsigs.com")


def _is_solana_network(network: str) -> bool:
    """Match Solana networks in CAIP-2 ("solana:<genesis>") or label form
    ("solana", "solana-devnet", "solana-mainnet")."""
    n = (network or "").strip().lower()
    return n == "solana" or n.startswith("solana:") or n.startswith("solana-")


@dataclass
class PaymentRequired:
    """Parsed x402 v2 PAYMENT-REQUIRED response."""
    x402_version: int
    network: str
    amount: str          # atomic units (6 decimals for USDC)
    asset: str           # mint address
    pay_to: str          # recipient wallet
    max_timeout: int
    error: str
    raw_encoded: str     # original base64 header value


class X402Client:
    """Handles x402 payment flow for SolSigs API calls."""

    def __init__(self, keypair: Keypair):
        self.keypair = keypair
        self.solana = SolanaClient(SOLANA_RPC)
        self._usdc_ata: Pubkey | None = None

    @property
    def usdc_ata(self) -> Pubkey:
        """Lazy-load the wallet's USDC Associated Token Account."""
        if self._usdc_ata is None:
            self._usdc_ata = get_associated_token_address(self.keypair.pubkey(), USDC_MINT)
        return self._usdc_ata

    def call(self, endpoint: str, payload: dict | None = None, timeout: int = 30) -> dict:
        """
        Call a SolSigs endpoint, handling x402 payment automatically.

        Flow:
        1. POST to endpoint
        2. If 200 → return JSON result
        3. If 402 → parse PAYMENT-REQUIRED, pay USDC, retry with signature
        """
        url = f"{SOLSIGS_BASE}{endpoint}"
        payload = payload or {}

        # ── Attempt 1: direct call ──
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(url, json=payload)

        if resp.status_code == 200:
            return resp.json()

        if resp.status_code != 402:
            raise RuntimeError(f"Unexpected status {resp.status_code}: {resp.text[:500]}")

        # ── Parse 402 Payment Required ──
        pr = self._parse_402(resp)

        # ── Pay ──
        tx_sig = self._pay_usdc(pr)

        # ── Attempt 2: with payment signature ──
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(
                url,
                json=payload,
                headers={"PAYMENT-SIGNATURE": str(tx_sig)},
            )

        if resp.status_code != 200:
            raise RuntimeError(f"Payment retry failed ({resp.status_code}): {resp.text[:500]}")

        return resp.json()

    def _parse_402(self, resp: httpx.Response) -> PaymentRequired:
        """Parse the PAYMENT-REQUIRED header from a 402 response."""
        encoded = resp.headers.get("payment-required") or resp.headers.get("PAYMENT-REQUIRED")
        if not encoded:
            raise RuntimeError("402 response missing PAYMENT-REQUIRED header")

        try:
            decoded = json.loads(base64.b64decode(encoded))
        except Exception as e:
            raise RuntimeError(f"Failed to decode PAYMENT-REQUIRED header: {e}") from e

        accepts = decoded.get("accepts", [])
        if not accepts:
            raise RuntimeError("No payment options in 402 response")

        # Scan ALL payment options and pick Solana — multi-chain sellers may
        # list Base (or others) first, so accepts[0] is not safe to assume.
        option = next(
            (o for o in accepts if _is_solana_network(o.get("network", ""))),
            None,
        )
        if option is None:
            networks = ", ".join(str(o.get("network", "unknown")) for o in accepts)
            raise RuntimeError(
                f"No Solana payment option in 402 response (networks offered: {networks})"
            )

        # maxAmountRequired is the spec-compliant field name (was "amount" in v2 early draft)
        amount = option.get("maxAmountRequired") or option.get("amount", "0")
        return PaymentRequired(
            x402_version=decoded.get("x402Version", 0),
            network=option.get("network", ""),
            amount=amount,
            asset=option.get("asset", ""),
            pay_to=option.get("payTo", ""),
            max_timeout=option.get("maxTimeoutSeconds", 60),
            error=decoded.get("error", ""),
            raw_encoded=encoded,
        )

    def _pay_usdc(self, pr: PaymentRequired) -> str:
        """
        Build, sign, and send a USDC SPL token transfer matching the payment requirement.
        Returns the transaction signature (used as PAYMENT-SIGNATURE header value).
        """
        amount = int(pr.amount)
        recipient = Pubkey.from_string(pr.pay_to)
        mint = Pubkey.from_string(pr.asset)

        # Get recipient's USDC ATA (create if needed via associated token program)
        recipient_ata = get_associated_token_address(recipient, mint)

        # Build transfer instruction
        transfer_ix = transfer_checked(
            TransferCheckedParams(
                program_id=TOKEN_PROGRAM_ID,
                source=self.usdc_ata,
                mint=mint,
                dest=recipient_ata,
                owner=self.keypair.pubkey(),
                amount=amount,
                decimals=6,
                signers=[],
            )
        )

        # Build transaction
        recent_blockhash = self.solana.get_latest_blockhash().value.blockhash
        tx = Transaction.new_with_payer(instructions=[transfer_ix], payer=self.keypair.pubkey())

        # Sign and send
        tx.sign([self.keypair], recent_blockhash)
        tx_sig = self.solana.send_raw_transaction(bytes(tx), opts=TxOpts(skip_preflight=False))

        sig_str = str(tx_sig.value)

        # Wait for confirmation
        self._confirm(sig_str, timeout=pr.max_timeout)

        return sig_str

    def _confirm(self, signature: str, timeout: int = 60) -> None:
        """Wait for a transaction to confirm."""
        from solders.signature import Signature
        sig = Signature.from_string(signature)
        deadline = time.time() + timeout
        while time.time() < deadline:
            resp = self.solana.get_signature_statuses([sig])
            if resp.value and resp.value[0] is not None:
                if resp.value[0].err is not None:
                    raise RuntimeError(f"Transaction failed: {resp.value[0].err}")
                return
            time.sleep(1)
        raise RuntimeError(f"Transaction {signature} not confirmed within {timeout}s")