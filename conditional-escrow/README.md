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
anchor build
solana-keygen new -o target/deploy/conditional_escrow-keypair.json   # if absent
anchor keys sync                  # write the program id into the source + Anchor.toml
anchor build                      # rebuild with the real program id

solana config set --url devnet
solana airdrop 2                  # fund the provider wallet
anchor deploy --provider.cluster devnet

# run the security suite against devnet (no local validator)
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts
```

The suite proves the 11 spec MUST-rules; see `tests/conditional_escrow.ts`.

## Keys & secrets

Keypairs are local and gitignored (`*.keypair.json`, `target/deploy/*`,
`.devnet-keys/`). No secrets are committed.
