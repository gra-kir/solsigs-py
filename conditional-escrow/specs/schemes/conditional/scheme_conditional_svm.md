# Scheme: `conditional` (SVM)

- **Scheme:** `conditional`
- **Chain family:** SVM (Solana and SVM-compatible)
- **Status:** Draft / reference implementation (AUDIT-PENDING)
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
| `amount` | `u64` | Token base units to escrow. Must be `> 0`. |
| `expiry_unix` | `i64` | Unix seconds; must be `> now` at init. |
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
- Requires `amount > 0` and `expiry_unix > now`.
- Creates the escrow PDA and the vault; transfers `amount` of `mint` from
  `ATA(payer)` into the vault.

### `release(response_hash: [u8;32])`
- Signer **must** be `release_authority` (`address = escrow.release_authority`).
- Requires `now < expiry_unix`.
- Transfers the **entire** vault balance to `ATA(pay_to, mint)` and nowhere else
  (destination is the Associated Token Account constrained by
  `associated_token::authority = pay_to`, `mint = escrow.mint`).
- Closes vault + escrow; emits `Released { response_hash, ... }`.

### `refund(response_hash: Option<[u8;32]>)`
- If `now >= expiry_unix`: **permissionless** (any signer).
- If `now < expiry_unix`: signer **must** be `release_authority`.
- Transfers the **entire** vault balance to `ATA(payer, mint)` and nowhere else.
- Closes vault + escrow; emits `Refunded { response_hash, expired, ... }`.

### Settlement invariants (proven in the reference test suite)
1. Funds can only ever reach `ATA(pay_to, mint)` (release) or `ATA(payer, mint)`
   (refund). No instruction can route them to `release_authority`, the fee
   payer, or any third party.
2. `release` after expiry is rejected; `release` by a non-authority is rejected.
3. `refund` before expiry by a non-authority is rejected; after expiry it is
   permissionless.
4. Double-settle is impossible (the escrow/vault are closed on first settle).
5. A wrong `mint`, zero/oversized `amount`, or past `expiry_unix` is rejected.

## Trust model

- **Non-custodial:** funds sit in a PDA-owned vault; no human key can move them
  except along the two constrained paths above.
- **Off-chain predicate:** the program trusts `release_authority` to evaluate the
  predicate honestly. It records `response_hash` and stores `predicate_hash` so a
  third party can audit *what* was supposed to be evaluated, but it does not
  enforce the predicate in-program.
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
not a permanent nonce**; callers needing global single-use semantics must choose
fresh `payment_id`s.

## Open questions for maintainers

- Is there appetite for a delivery-conditional scheme distinct from the
  value-conditional `upto` direction in #873?
- Preferred scheme name (`conditional` vs. an alternative) to avoid collision.
- Whether the off-chain predicate / `release_authority` trust boundary fits the
  facilitator model x402 expects, or should be expressed differently.
