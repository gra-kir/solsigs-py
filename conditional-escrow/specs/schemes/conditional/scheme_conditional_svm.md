# Scheme: `conditional` (SVM)

- **Scheme:** `conditional`
- **Chain family:** SVM (Solana and SVM-compatible)
- **Status:** Draft / reference implementation (audit findings applied)
- **Reference program (devnet):** `9TwHxtc4HxSEkfosCbcjfkgAWEkF9MdGZsXU6Kzorgys`

## Summary

`conditional` is a deliver-or-refund escrow scheme. A payer locks SPL tokens up
front; the funds settle to the seller **only if a delivery predicate is
satisfied**, otherwise they are refunded to the payer. It answers *"did the
seller actually deliver?"* and is complementary to value-oriented schemes such
as `exact` / the `upto` proposal in
[x402-foundation/x402#873](https://github.com/x402-foundation/x402/issues/873),
which answer *"how much should be paid?"*.

The on-chain program is a deterministic settlement primitive. The delivery
predicate is evaluated **off chain** by a `release_authority`; the program
records the authority's decision input (`response_hash`) and the committed
predicate (`predicate_hash`) for auditability but does not itself perform HTTP
calls or schema validation. See **Trust model** below.

## Roles

| Role | Description |
|------|-------------|
| `payer` | Locks funds; receives refunds. Signs `initialize_and_deposit`. |
| `pay_to` | Fixed recipient of a successful release. Never signs. |
| `release_authority` | Off-chain decision maker. Signs `release`; signs `refund` before expiry. |
| `mint` | SPL token mint of the escrowed asset. |

## Payload structure

The escrow is created by `initialize_and_deposit` with the following payload.
All fields are written once and never mutated.

| Field | Type | Notes |
|-------|------|-------|
| `payment_id` | `[u8;32]` | Caller-chosen uniqueness key (see *payment_id semantics*). |
| `amount` | `u64` | Token base units to escrow. Must be `> 0`. This is the **committed amount** that settles to the outcome party. |
| `expiry_unix` | `i64` | Unix seconds; must be `>= now + MIN_TTL_SECS` (60s) at init. |
| `pay_to` | `Pubkey` | Release recipient (ATA authority). |
| `predicate_hash` | `[u8;32]` | Commitment to the off-chain predicate descriptor. |
| `release_authority` | `Pubkey` | Who may release / early-refund. |

**Escrow PDA:** `seeds = [b"conditional", payer, pay_to, mint, payment_id]`.
**Vault:** `seeds = [b"vault", escrow]`, an SPL token account owned by the escrow PDA.

`predicate_hash` is computed off chain as
`sha256(canonical_json({type, schemaUrl, schemaHash}))` over a predicate
descriptor of the form:

```json
{ "type": "json-schema", "schemaUrl": "<url>", "schemaHash": "<sha256-hex of schema bytes>" }
```

`response_hash`, supplied at settlement, is `sha256(raw_response_body_bytes)`.

## Verification logic (off chain — the `release_authority` decision function)

The release authority evaluates delivery and returns `DELIVERED` or `FAILED`:

1. Fetch the schema from `predicate.schemaUrl`; verify `sha256(bytes) ==
   predicate.schemaHash`. On mismatch → `FAILED` (treat as bad delivery).
2. `DELIVERED` iff the resource HTTP response status is `2xx` **and** the body
   is non-empty, parses as JSON, and validates against the fetched schema.
3. `FAILED` on any non-`2xx` status (e.g. a typed `402`/`4xx`/`5xx`), timeout,
   empty body, invalid JSON, or schema-validation failure.
4. In all cases compute `response_hash = sha256(body)` for the on-chain record.

This logic is content-addressed (the schema is pinned by hash) and therefore
deterministic given the same response bytes and schema. It is **not** executed
on chain.

## Settlement logic (on chain)

Three instructions; `release` and `refund` are mutually exclusive and each
closes the escrow + vault (rent → `payer`), so an escrow settles exactly once.

### `initialize_and_deposit`
- Requires `amount > 0`.
- **Minimum TTL (F5):** requires `expiry_unix >= now + MIN_TTL_SECS` (60s).
  Rejects past *and* too-soon expiries. The on-chain clock is validator-
  influenced and only accurate to a few seconds, so second-level precision near
  expiry is **not** guaranteed; do not rely on tight expiries.
- **Legacy SPL only (F3):** the `mint` must be owned by the legacy SPL Token
  program; Token-2022 mints are rejected (`IllegalTokenProgram`), since their
  transfer-fee / transfer-hook extensions would break the exact-amount and
  "funds only reach pay_to/payer" invariants.
- Creates the escrow PDA and the vault; transfers `amount` of `mint` from
  `ATA(payer)` into the vault.

### `release(response_hash: [u8;32])`
- Signer **must** be `release_authority` (`address = escrow.release_authority`).
- Requires `now < expiry_unix`.
- **Exact-amount (F1):** transfers **exactly `escrow.amount`** to
  `ATA(pay_to, mint)` (constrained by `associated_token::authority = pay_to`,
  `mint = escrow.mint`). Any tokens donated into the vault beyond `amount` are
  returned to `ATA(payer, mint)` — never to `pay_to`. The vault is then drained
  to zero and closed, so a donation can never brick settlement.
- **Destinations must pre-exist (F4):** `ATA(pay_to)` and `ATA(payer)` are not
  created by the program, so the release authority is never charged unrecoverable
  rent; a missing `ATA(pay_to)` causes release to fail.
- Closes vault + escrow; emits `Released { amount, surplus_to_payer, response_hash, ... }`.

### `refund(response_hash: Option<[u8;32]>)`
- If `now >= expiry_unix`: **permissionless** (any signer).
- If `now < expiry_unix`: signer **must** be `release_authority`.
- The outcome party is the payer, so the committed amount **and** any donated
  surplus both settle to `ATA(payer, mint)`. `ATA(payer)` must already exist (F4).
- Closes vault + escrow; emits `Refunded { amount, surplus_to_payer, expired, response_hash, ... }`.

### Settlement invariants (proven in the reference test suite)
1. Tokens can only ever reach `ATA(pay_to, mint)` (exactly `amount`, on release)
   or `ATA(payer, mint)` (the committed amount on refund, plus any surplus on
   either path). No instruction can route them to `release_authority`, the fee
   payer, or any third party.
2. `release` after expiry is rejected; `release` by a non-authority is rejected.
3. `refund` before expiry by a non-authority is rejected; after expiry it is
   permissionless.
4. Double-settle is impossible (the escrow/vault are closed on first settle); a
   closed account cannot be revived.
5. A wrong `mint`, a Token-2022 `mint`, zero `amount`, or an `expiry_unix` that is
   past or under `MIN_TTL_SECS` is rejected.

## Trust model

- **Non-custodial:** funds sit in a PDA-owned vault; no human key can move them
  except along the two constrained paths above.
- **Off-chain predicate (F2 — unchanged by design):** the program trusts
  `release_authority` to evaluate the predicate honestly. `response_hash` is
  **authority-asserted and recorded, not verified on chain**; `predicate_hash` is
  stored so a third party can audit *what* was supposed to be evaluated. The
  program does **not** enforce the predicate in-program. A compromised or
  dishonest authority can therefore mis-settle *between the two honest parties* —
  release on a failed delivery (harming the buyer) or withhold / early-refund
  (harming the seller) — but can **never** redirect or steal funds. How much of
  this to anchor on chain (oracle attestation, dispute/challenge window,
  threshold/multisig authority) is an **open question for maintainers**; no
  hardening is built yet.
- **Freeze-authority liveness:** real USDC has a freeze authority. If the
  `pay_to` or `payer` ATA is frozen, `release`/`refund` will revert until the
  account is thawed. This is a property of the asset, not a program bug, but it
  is a liveness consideration for any USDC deployment.
- **Bounded authority power:** even a malicious `release_authority` can only send
  funds to `pay_to` (release) or `payer` (refund); it can never redirect or steal
  them. After `expiry_unix`, anyone can refund the payer, so a withholding
  authority cannot strand funds past expiry.

## `payment_id` semantics

`payment_id` is part of the escrow PDA seeds, so re-initializing with an
already-used `payment_id` is rejected **while that escrow is open** (the PDA
address is occupied). Settlement closes the PDA and frees the address, after
which the same `(payer, pay_to, mint, payment_id)` tuple can be initialized
again. `payment_id` is therefore a **liveness/uniqueness key for open escrows,
not a permanent nonce**; callers needing global single-use semantics **must**
choose fresh (random) `payment_id`s. The reference harness generates a random
32-byte `payment_id` per deposit to demonstrate the safe pattern (F6).

> Optional on-chain route: if a future consumer needs hard global single-use, a
> permanent "spent-marker" PDA (a small account that is *not* closed on settle)
> can be added. This is intentionally **not** implemented here because it burns
> rent per escrow.

## Open questions for maintainers

- Is there appetite for a delivery-conditional scheme distinct from the
  value-conditional `upto` direction in #873?
- Preferred scheme name (`conditional` vs. an alternative) to avoid collision.
- Whether the off-chain predicate / `release_authority` trust boundary fits the
  facilitator model x402 expects, or should be expressed differently.
