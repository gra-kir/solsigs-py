# conditional_escrow

A non-custodial Solana escrow program implementing the **`conditional`** payment
scheme. A payer locks SPL tokens that a designated **release authority** may
release to a fixed recipient before an expiry, or that are refunded to the
payer. Built with [Anchor](https://www.anchor-lang.com/).

> **Stage 1 — DEVNET ONLY.** This is a standalone program. It does not touch any
> SolSigs production service. Do not deploy to mainnet from this stage.

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

## Keys & secrets

Keypairs are local and gitignored (`*.keypair.json`, `target/deploy/*`,
`.devnet-keys/`). No secrets are committed.
