# SolSigs ProofGuard

**Signed receipt and refund-evidence layer for x402-paid agent endpoints on Solana.**

ProofGuard helps AI agents answer the question: *did this paid endpoint deliver what it promised?*

It creates a signed evidence bundle for a paid API call:

- **Endpoint trust score** — route-level risk/quality score with reason codes.
- **Payment expectation receipt** — what the endpoint promised before payment.
- **Payment fulfillment receipt** — what was actually observed after payment.
- **Refund evidence package** — hashed evidence for stale, malformed, missing, misleading, or contract-miss responses.

## Live endpoint

```text
POST https://solsigs.com/proofguard/evaluate
Price: 0.003 USDC via x402 on Solana mainnet
payTo: HZAkkKbhN9hfJBiNxCuwap7XtPXgniy9MVjJR2MvHSJi
```

Unpaid calls return `402 Payment Required` with x402 payment details. Paid calls retry with:

```text
PAYMENT-SIGNATURE: <solana_tx_signature>
```

## Verification modes

ProofGuard is explicit about where the evidence came from:

- `solsigs_instrumented` — SolSigs observed the response in-process. Strongest mode for SolSigs endpoints.
- `proofguard_probed` — reserved for independent ProofGuard probing.
- `self_attested` — caller supplied the observations/statistics. Useful as a signed evidence envelope, but not independent proof.

Self-attested third-party evaluations are capped at `ALLOW_WITH_FLAGS` and include:

```json
[
  "WARN_SELF_ATTESTED_INPUT",
  "WARN_NOT_INDEPENDENTLY_PROBED"
]
```

## Example response

```json
{
  "ok": true,
  "product": "SolSigs ProofGuard",
  "verification_mode": "solsigs_instrumented",
  "claim_boundary": "SolSigs instrumented the endpoint response in-process for this receipt.",
  "trust_score": {
    "score": 94,
    "decision": "ALLOW",
    "reason_codes": ["TRUST_ROUTE_LEVEL_SCORE"],
    "endpoint_key": "https://solsigs.com|POST|/dex"
  },
  "expectation_receipt": {
    "version": "payment-expectation-receipt.v1",
    "receipt_hash": "...",
    "price": {
      "amount": "0.002",
      "currency": "USDC",
      "network": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"
    },
    "promise": {
      "expected_status": 200,
      "max_freshness_ms": 60000,
      "max_latency_ms": 3000
    }
  },
  "fulfillment_receipt": {
    "version": "payment-fulfillment-receipt.v1",
    "receipt_hash": "...",
    "fulfillment": {
      "status": 200,
      "ok": true,
      "response_hash": "...",
      "evidence_codes": []
    }
  },
  "refund_evidence_package": {
    "version": "refund-evidence-package.v1",
    "package_hash": "...",
    "dispute": {
      "refund_requested": false,
      "evidence_codes": []
    }
  }
}
```

## What ProofGuard is for

Use it when an agent pays an endpoint and needs durable evidence for:

- what was promised before payment;
- what was returned after payment;
- whether the returned data was stale, empty, malformed, too slow, or contract-mismatched;
- whether a refund/dispute package can be generated without exposing secrets.

## Safe claim boundary

ProofGuard does **not** claim that all third-party endpoints are independently verified unless `verification_mode` says `proofguard_probed` or `solsigs_instrumented`.

For third-party, caller-supplied observations, ProofGuard is a signed evidence envelope, not an oracle.

## Test command

```bash
curl -i -X POST https://solsigs.com/proofguard/evaluate \
  -H 'content-type: application/json' \
  -d '{"endpoint":"https://solsigs.com","route":"/dex","method":"POST"}'
```

The first call returns `402 Payment Required`. Pay the required 0.003 USDC and retry with `PAYMENT-SIGNATURE`.
