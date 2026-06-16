# conditional_escrow

A non-custodial Solana escrow program implementing the **`conditional`** payment
scheme. A payer locks SPL tokens that a designated **release authority** may
release to a fixed recipient before an expiry, or that are refunded to the
payer. Built with [Anchor](https://www.anchor-lang.com/).

**What `conditional` is:** a deliver-or-refund escrow. Funds settle to the seller
only if a delivery predicate is satisfied (the resource returned a valid `2xx`
response), otherwise they refund to the payer. It answers *"did the seller
actually deliver?"* and is **complementary** to value-oriented schemes like
`exact` and the `upto` proposal in
[x402-foundation/x402#873](https://github.com/x402-foundation/x402/issues/873),
which answer *"how much should be paid?"*. The two compose: `upto` decides the
amount, `conditional` decides whether delivery happened at all.

> ⚠️ **AUDIT-PENDING — reference design, not production-grade.** This program and
> harness are a tested reference implementation for discussion. They have **not**
> been audited. Do not custody material value with them.

> **Scope.** Standalone program; does not touch any SolSigs production service
> (only outbound HTTPS calls to `solsigs.com`). Verified on **devnet**; a gated
> mainnet demo (Stage 3) was evaluated but came back **NO-GO** (insufficient
> burner SOL for deploy rent), so all receipts below are devnet, `err=None`.

## Security model

Funds in an escrow vault can reach exactly two destinations and no others:

| Instruction | Who may sign | When | Destination |
|---|---|---|---|
| `release` | `release_authority` only | `now < expiry_unix` | `ATA(pay_to, mint)` |
| `refund` | `release_authority` | `now < expiry_unix` | `ATA(payer, mint)` |
| `refund` | **anyone** (permissionless) | `now >= expiry_unix` | `ATA(payer, mint)` |

There is **no instruction path** that routes funds to the release authority, the
fee payer, or any third party. The destination is pinned by Anchor
`associated_token` constraints, recipients/payer/mint are pinned by `has_one`,
and the signer is pinned by `address` / explicit checks.

### Accounts

- **`Escrow`** (PDA, immutable after init) — `payer`, `pay_to`, `mint`,
  `amount`, `expiry_unix`, `predicate_hash` (`[u8;32]`), `release_authority`,
  `payment_id` (`[u8;32]`, part of the seeds), `bump`.
  Seeds: `[b"conditional", payer, pay_to, mint, payment_id]`.
- **Vault** — an SPL token account owned by the `Escrow` PDA.
  Seeds: `[b"vault", escrow]`.

On settlement both the escrow and the vault are closed and their rent is
returned to the payer.

## Instructions

- `initialize_and_deposit(payment_id, amount, expiry_unix, pay_to, predicate_hash, release_authority)`
- `release(response_hash: [u8;32])`
- `refund(response_hash: Option<[u8;32]>)`

## Build / test (devnet)

Toolchain used: Anchor `0.31.1`, Solana (Agave) `4.0.2`, Rust `1.94.1`.

```bash
# from this directory
anchor build                      # builds the SBF program + IDL
solana config set --url devnet

# deploy (use --use-rpc when the TPU/QUIC path is blocked by a proxy)
solana program deploy target/deploy/conditional_escrow.so \
  --program-id target/deploy/conditional_escrow-keypair.json --use-rpc

# run the security suite against devnet (no local validator).
# Tests are compiled to CommonJS then run with mocha to avoid the
# mocha-ESM / ts-node loader mismatch on modern Node.
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
yarn test
```

The suite proves the 11 spec MUST-rules; see `tests/conditional_escrow.ts`.

## Devnet deployment (Stage 1, verified)

- **Program id:** `9TwHxtc4HxSEkfosCbcjfkgAWEkF9MdGZsXU6Kzorgys`
- **Deploy tx:** [`4kvs5gxu…XemGB`](https://explorer.solana.com/tx/4kvs5gxu8ezEebs4756jk6cGCi6fNyoUQmba3csPVEkHHuo9SKq4UTUPbMiCYDEzmJ2jFJbzFUSB4etDtGdXemGB?cluster=devnet)
- **Program:** [explorer.solana.com/address/9TwHxtc4…?cluster=devnet](https://explorer.solana.com/address/9TwHxtc4HxSEkfosCbcjfkgAWEkF9MdGZsXU6Kzorgys?cluster=devnet)

All 11 security rules pass against devnet:

| # | Rule | Result |
|---|------|--------|
| 1 | release before expiry → `pay_to`; accounts closed | PASS |
| 2 | refund after expiry is permissionless → `payer` | PASS |
| 3 | release after expiry rejected | PASS |
| 4 | release by non-`release_authority` rejected | PASS |
| 5 | refund before expiry by non-authority rejected | PASS |
| 6 | release to dest ≠ `ATA(pay_to, mint)` rejected | PASS |
| 7 | refund to dest ≠ `ATA(payer, mint)` rejected | PASS |
| 8 | double-settle rejected (account closed) | PASS |
| 9 | re-init with used `payment_id` rejected | PASS |
| 10 | wrong mint / amount mismatch on deposit rejected | PASS |
| 11 | no funds to authority / fee-payer / third party | PASS |

## Stage 2 — predicate evaluator + reference harness (devnet, verified)

The off-chain half of the scheme lives in `harness/`:

- **`evaluator.ts`** — the release authority's decision function. Given an HTTP
  response and a predicate descriptor `{type:"json-schema", schemaUrl, schemaHash}`,
  it fetches the schema, verifies its bytes hash to `schemaHash` (rejecting on
  mismatch), returns `DELIVERED` iff the status is 2xx **and** the JSON body
  validates against the schema (AJV), `FAILED` otherwise (non-2xx, empty/invalid
  body, schema mismatch, timeout), and always computes `sha256(body)` as the
  `response_hash` recorded on chain.
- **`reference_harness.ts`** — runs the full flow end-to-end against the deployed
  devnet program with the live SolSigs API as the worked example.

```bash
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
yarn harness
```

Both outcomes confirmed on devnet (each settlement tx fetched back with `err=null`):

| Path | Delivery | Endpoint | Evaluator | Settlement |
|------|----------|----------|-----------|------------|
| Release | good | `GET /openapi.json` → 200, schema-valid | `DELIVERED` | [`release`](https://explorer.solana.com/tx/4G5grzjYL36w53qHNUJndVwpvwp58DJ8n1uVfe3cPg5BPjHDukY6FLtt6nwLeJa23apm25d5vy9bJQW49SzqPxm1?cluster=devnet) → funds at `pay_to` |
| Refund | bad | `POST /dex` unpaid → typed 402 | `FAILED` | [`refund`](https://explorer.solana.com/tx/2fukNBNrubF2HiS9NanZvL4L5uK1H6vgqRTmv59mGYq7mYqHfK7G5n45ViTEcKMvSDffcwRn92m25XhcAMsXh4b8?cluster=devnet) → funds back to `payer` |

The escrowed asset is a **devnet test mint** (never mainnet USDC); SolSigs data
endpoints require x402 USDC payment on mainnet, so the live calls here use only
the payment-free `GET /openapi.json` (200) and an unpaid `POST /dex` (402).

### Trust boundary (important)

Predicate evaluation is **off chain**. The program does **not** fetch URLs,
validate schemas, or inspect `response_hash` — it only *records* `response_hash`
in the `Released`/`Refunded` events and *stores* `predicate_hash` at init for
auditability. The program trusts whoever holds `release_authority` to have run
the evaluator honestly before calling `release`/`refund`. The on-chain
`predicate_hash = sha256({type, schemaUrl, schemaHash})` commits an escrow to a
specific predicate so an auditor can check which predicate the authority was
supposed to evaluate, but it is not enforced in-program. Security against the
authority itself comes from the destination/expiry constraints proved in Stage 1
(authority can only ever move funds to `ATA(pay_to)` or `ATA(payer)`, and after
expiry anyone can refund the payer).

### `payment_id` re-use nuance

The escrow PDA seeds include `payment_id`, so `initialize_and_deposit` with an
already-used `payment_id` is rejected **while that escrow is open** (Stage 1
rule 9 — the PDA address is in use). Once an escrow settles, `release`/`refund`
**closes** the PDA, which frees the address: the same `(payer, pay_to, mint,
payment_id)` tuple can then be initialized again. `payment_id` is therefore a
uniqueness key for *live* escrows, not a permanent nonce — callers that need
global single-use semantics must pick fresh `payment_id`s.

## Package contents

| Piece | Location |
|-------|----------|
| Scheme spec (house format) | [`specs/schemes/conditional/scheme_conditional_svm.md`](specs/schemes/conditional/scheme_conditional_svm.md) |
| On-chain program (Anchor) + IDL | `programs/conditional_escrow/`, [`idl/conditional_escrow.json`](idl/conditional_escrow.json) |
| Off-chain predicate evaluator | [`harness/evaluator.ts`](harness/evaluator.ts) |
| Reference harness (end-to-end) | [`harness/reference_harness.ts`](harness/reference_harness.ts) |
| Predicate schema | [`harness/schemas/solsigs-openapi.schema.json`](harness/schemas/solsigs-openapi.schema.json) |
| 11-rule security suite | [`tests/conditional_escrow.ts`](tests/conditional_escrow.ts) |
| Draft x402 contribution (for maintainers) | [`contribution/x402-conditional-proposal.md`](contribution/x402-conditional-proposal.md) |

## Keys & secrets

Keypairs are local and gitignored (`*.keypair.json`, `target/deploy/*`,
`.devnet-keys/`, `.mainnet-keys/`). No secrets are committed.
