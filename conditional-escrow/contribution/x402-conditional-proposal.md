<!--
DRAFT for Grant to post PERSONALLY to x402-foundation/x402.
This file is NOT auto-posted. Before posting:
  - Post from your own GitHub account.
  - Per x402 CONTRIBUTING.md: disclose AI assistance, ensure commits are
    GPG-signed if/when you open a code PR, and follow the spec-first (Phase 1)
    flow — open this as a DISCUSSION/ISSUE to gauge appetite before any SDK code.
  - Coordinate the scheme name with maintainers.
  - Lead with the working artifact + receipts; keep it one focused question.
-->

# Proposal: a `conditional` (deliver-or-refund) payment scheme for SVM

## Summary

I've built and devnet-verified a non-custodial Solana escrow that implements a
**deliver-or-refund** payment scheme I'm calling `conditional`. Funds settle to
the seller **only if a delivery predicate is satisfied** (the resource returned a
valid `2xx` response), otherwise they refund to the payer. I'd like to gauge
maintainer appetite before doing any SDK work.

## Motivation

x402 today proves *payment*, but an agent paying per call has no protocol-level
recourse when a paid endpoint returns `5xx`, times out, or sends a malformed
body. `conditional` puts the payment in escrow and releases it only on verified
delivery — giving agents deliver-or-refund semantics over arbitrary HTTP
resources, with a permissionless refund path after an expiry so funds can never
be stranded.

## Relationship to #873

This is **complementary**, not competing, with the `upto` direction in #873:

- **#873 / `upto`** answers *"how much should be paid?"* (value-conditional).
- **`conditional`** answers *"did the seller actually deliver?"* (delivery-conditional).

They compose cleanly: `upto` can decide the amount; `conditional` decides whether
delivery happened at all. Happy to align naming/shape so the two don't collide.

## Design

**Custody (non-custodial PDA).** The payer locks SPL tokens in a vault owned by
an escrow PDA (`seeds = [b"conditional", payer, pay_to, mint, payment_id]`). Two
settlement paths, each closing the escrow (rent → payer) so it settles exactly
once:

- `release(response_hash)` — signer must be `release_authority`, requires
  `now < expiry`; moves the **entire** vault to `ATA(pay_to, mint)` and nowhere
  else.
- `refund(response_hash?)` — **permissionless** once `now >= expiry`; before
  expiry requires `release_authority`; moves the **entire** vault to
  `ATA(payer, mint)` and nowhere else.

A malicious or buggy `release_authority` can therefore only ever send funds to
`pay_to` or back to `payer` — never to itself, the fee payer, or a third party —
and cannot strand funds past expiry.

**Deterministic predicate (off chain).** The `release_authority`'s decision
function is content-addressed: a predicate descriptor
`{type:"json-schema", schemaUrl, schemaHash}` pins the schema by `sha256`. It
returns `DELIVERED` iff status is `2xx` **and** the JSON body validates against
the pinned schema; `FAILED` on non-`2xx`, timeout, empty/invalid body, or schema
mismatch. It computes `response_hash = sha256(body)` for the on-chain record.

**Trust model.** The program is a deterministic settlement primitive; it does
**not** make HTTP calls or validate schemas. It records `response_hash` and
stores `predicate_hash = sha256({type,schemaUrl,schemaHash})` for auditability,
and trusts `release_authority` to evaluate honestly. Security against the
authority comes from the constrained destinations + permissionless post-expiry
refund above. (This off-chain-evaluator/on-chain-settlement split is the main
thing I'd want maintainer feedback on vs. the facilitator model.)

## What I built (tested reference + verified receipts)

- **Program (Anchor):** devnet `9TwHxtc4HxSEkfosCbcjfkgAWEkF9MdGZsXU6Kzorgys`
- **Off-chain evaluator + reference harness** demonstrating both paths against a
  live x402-style API (SolSigs), with external RPC confirmation (`err=None`).
- **11-rule security suite** (all passing on devnet) covering: release/refund
  destinations locked to `ATA(pay_to)`/`ATA(payer)`, release-after-expiry
  rejected, non-authority release/early-refund rejected, permissionless
  post-expiry refund, double-settle rejected, `payment_id` reuse rejected while
  open, wrong-mint/amount rejected, and no path to authority/fee-payer/third
  party.

**Devnet receipts (all `err=None`):**

| Event | Explorer |
|-------|----------|
| Program deploy | https://explorer.solana.com/tx/4kvs5gxu8ezEebs4756jk6cGCi6fNyoUQmba3csPVEkHHuo9SKq4UTUPbMiCYDEzmJ2jFJbzFUSB4etDtGdXemGB?cluster=devnet |
| Release path — deposit | https://explorer.solana.com/tx/KMu5PhSkp79EH8iA5DzBqq5qhZgFwM9Mv9Sv1U1d77f9oPRHDzwZqhh1BAxZBtG4PwQWZAVs85r6W5e2ApzVRCZ?cluster=devnet |
| Release path — release | https://explorer.solana.com/tx/4G5grzjYL36w53qHNUJndVwpvwp58DJ8n1uVfe3cPg5BPjHDukY6FLtt6nwLeJa23apm25d5vy9bJQW49SzqPxm1?cluster=devnet |
| Refund path — deposit | https://explorer.solana.com/tx/4tQ2ibxKPYMDYVNSmcxVWgbJWMpP2ocaK8B1BUMwnUjD1xFssjXtZ5sGYJz3b6MKombtcno9frubU4azFbYCANAG?cluster=devnet |
| Refund path — refund | https://explorer.solana.com/tx/2fukNBNrubF2HiS9NanZvL4L5uK1H6vgqRTmv59mGYq7mYqHfK7G5n45ViTEcKMvSDffcwRn92m25XhcAMsXh4b8?cluster=devnet |

Full spec in house format (Payload / Verification / Settlement):
`specs/schemes/conditional/scheme_conditional_svm.md`.

## Audit-pending

This is a **reference design for discussion, not audited or production-grade**.
I'm not proposing it for custody of material value as-is.

> AI assistance was used to build this reference; I've reviewed the program and
> tests, especially the settlement/authorization logic. (Disclosing per
> CONTRIBUTING.md.)

## One question for maintainers

**Is there appetite for a delivery-conditional scheme distinct from the
value-conditional `upto` work in #873 — and if so, how would you like the scheme
name and the off-chain-predicate/`release_authority` trust boundary coordinated
so it fits the facilitator model and doesn't collide with #873?**
