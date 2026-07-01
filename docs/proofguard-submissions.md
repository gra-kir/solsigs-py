# SolSigs ProofGuard submission copy

## One-liner

SolSigs ProofGuard creates signed trust scores, payment expectation receipts, fulfillment receipts, and refund-evidence packages for x402-paid AI agent endpoints on Solana mainnet USDC.

## Short description

SolSigs ProofGuard helps AI agents decide whether a paid endpoint delivered what it promised. Each paid call can return a route-level trust score, a pre-payment expectation receipt, a post-payment fulfillment receipt, and a refund-evidence package with hashes for stale, malformed, missing, misleading, or contract-mismatched responses.

ProofGuard is explicit about evidence quality: `solsigs_instrumented`, `proofguard_probed`, or `self_attested`, so agents can distinguish observed proof from caller-supplied claims.

## Directory description

SolSigs ProofGuard is a Solana/x402 trust and receipts API for autonomous agents. Agents pay 0.003 USDC via x402 on Solana mainnet and receive a signed evidence bundle containing endpoint trust score, payment expectation receipt, fulfillment receipt, and refund evidence. It is designed for agent commerce, API marketplaces, and refund/dispute workflows where a buyer needs durable proof of what was promised and what was delivered.

## Safe claim boundaries

Use:

- signed payment expectation receipts;
- signed fulfillment receipts;
- refund evidence packages;
- Solana mainnet USDC x402 payments;
- explicit evidence modes for SolSigs-instrumented, ProofGuard-probed, and self-attested evidence.

Avoid unless/until independent probing is enabled for arbitrary third parties:

- "independently verifies every endpoint";
- "guaranteed refund";
- "fraud-proof";
- "oracle".

## Priority targets

1. x402scan — submitted/registered for solsigs.com.
2. x402-list — submitted with ProofGuard endpoint.
3. GitHub repo — README + ProofGuard docs PR opened.
4. Solana ecosystem — submit as Developer Tool / Payments / Infrastructure.
5. Solana Foundation grants — apply as AI agent payments trust/receipts infrastructure.
6. awesome-x402 — PR under production implementations or tools.
7. awesome-agentic-payments — PR under protocols/tools for receipt/refund evidence.
8. awesome-agentic-commerce — PR near trust/audit/payment infrastructure.
9. Product Hunt — launch after docs landing page is live and screenshots are ready.
10. Show HN — launch as technical post: "Show HN: Proof receipts for AI agents that pay HTTP 402 APIs".

## Show HN draft

Title: Show HN: ProofGuard — signed receipts for AI agents paying x402 APIs

Text:

I built SolSigs ProofGuard, a small x402-paid API for AI agents that need evidence after paying another endpoint.

The problem: agent payments are easy to trigger, but after payment the buyer often has no durable proof of what was promised, what was returned, whether the data was stale/malformed, or whether a refund claim has evidence.

ProofGuard returns four objects:

- endpoint trust score;
- payment expectation receipt;
- payment fulfillment receipt;
- refund evidence package.

It runs on Solana mainnet USDC via x402. The API is intentionally explicit about evidence quality: `solsigs_instrumented`, `proofguard_probed`, or `self_attested`, so it does not pretend caller-supplied data is independent verification.

Live endpoint: https://solsigs.com/proofguard/evaluate
Docs: https://github.com/gra-kir/solsigs-py/blob/main/docs/proofguard.md

## X thread draft

Agents can now pay APIs with x402.

But after payment, what proof does the buyer have that the endpoint delivered what it promised?

We built SolSigs ProofGuard:

- trust score
- payment expectation receipt
- fulfillment receipt
- refund evidence package
- Solana mainnet USDC via x402

The important bit: every result is labelled by evidence mode:

- `solsigs_instrumented`
- `proofguard_probed`
- `self_attested`

So agents can distinguish observed proof from caller-supplied claims.

Live: https://solsigs.com/proofguard/evaluate
Docs: https://github.com/gra-kir/solsigs-py/blob/main/docs/proofguard.md

## Solana ecosystem description

SolSigs ProofGuard is infrastructure for Solana-based AI agent payments. It uses Solana mainnet USDC and x402 to let agents pay per evaluation and receive signed receipts proving what an endpoint promised, what was delivered, and whether refund evidence exists. It is useful for agent marketplaces, paid APIs, MCP tools, and autonomous buyers that need payment/fulfillment records without API keys or subscriptions.
