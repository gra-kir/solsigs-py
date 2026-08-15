//! Conditional-settlement escrow program.
//!
//! Non-custodial escrow implementing the `conditional` payment scheme: a payer
//! locks tokens that a designated `release_authority` may release to a fixed
//! recipient (`pay_to`) before an expiry, or that are refunded to the payer.
//!
//! Settlement is **exact-amount**: precisely `escrow.amount` reaches the outcome
//! party (release -> `ATA(pay_to, mint)`, refund -> `ATA(payer, mint)`), and any
//! tokens donated into the vault beyond `amount` are returned to the payer before
//! the vault is closed. Funds can therefore only ever reach `ATA(pay_to, mint)`
//! (the committed amount, on release) or `ATA(payer, mint)` (the committed amount
//! on refund, plus any surplus on either path); no instruction can route them to
//! the release authority, the fee payer, or any third party.
//!
//! Legacy SPL Token only (see `EscrowError::IllegalTokenProgram`): Token-2022 and
//! its transfer-fee / transfer-hook extensions are rejected so the full-balance
//! and exact-amount assumptions cannot be subverted.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer};

declare_id!("7sWTb3Czsz2vV1RpYpgFtKNkEXGqjcEGCsa31zQKisa5");

/// Minimum escrow lifetime at creation (F5). `expiry_unix` must be at least this
/// many seconds in the future. The on-chain clock (`Clock::unix_timestamp`) is
/// validator-influenced and only accurate to a handful of seconds, so escrows are
/// not allowed to be created with sub-minute or already-past expiries.
pub const MIN_TTL_SECS: i64 = 60;

#[program]
pub mod conditional_escrow {
    use super::*;

    /// Create the escrow PDA + vault and deposit `amount` of `mint`.
    /// All state fields are written once here and never mutated afterwards.
    pub fn initialize_and_deposit(
        ctx: Context<InitializeAndDeposit>,
        payment_id: [u8; 32],
        amount: u64,
        expiry_unix: i64,
        pay_to: Pubkey,
        predicate_hash: [u8; 32],
        release_authority: Pubkey,
    ) -> Result<()> {
        require!(amount > 0, EscrowError::ZeroAmount);

        // F5: enforce a minimum time-to-live. Rejects past *and* too-soon expiries.
        let now = Clock::get()?.unix_timestamp;
        let min_expiry = now
            .checked_add(MIN_TTL_SECS)
            .ok_or(EscrowError::ExpiryTooSoon)?;
        require!(expiry_unix >= min_expiry, EscrowError::ExpiryTooSoon);

        // F3: legacy SPL Token only. `anchor_spl::token::{Mint, TokenAccount, Token}`
        // already reject Token-2022 (the mint would be owned by the Token-2022
        // program and fail to deserialize), but assert it explicitly so a future
        // migration to `token_interface` cannot silently admit transfer-fee or
        // transfer-hook mints that would break the exact-amount invariant.
        require_keys_eq!(
            *ctx.accounts.mint.to_account_info().owner,
            token::ID,
            EscrowError::IllegalTokenProgram
        );

        // `pay_to` is part of the PDA seeds; bind the arg to the seed value.
        require_keys_eq!(pay_to, ctx.accounts.pay_to.key(), EscrowError::PayToMismatch);

        let escrow = &mut ctx.accounts.escrow;
        escrow.payer = ctx.accounts.payer.key();
        escrow.pay_to = pay_to;
        escrow.mint = ctx.accounts.mint.key();
        escrow.amount = amount;
        escrow.expiry_unix = expiry_unix;
        escrow.predicate_hash = predicate_hash;
        escrow.release_authority = release_authority;
        escrow.payment_id = payment_id;
        escrow.bump = ctx.bumps.escrow;

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.payer_ata.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                },
            ),
            amount,
        )?;

        emit!(Initialized {
            escrow: escrow.key(),
            payer: escrow.payer,
            pay_to: escrow.pay_to,
            mint: escrow.mint,
            amount,
            expiry_unix,
            predicate_hash,
            release_authority,
        });
        Ok(())
    }

    /// Release exactly `escrow.amount` to `ATA(pay_to, mint)`.
    /// Requires the `release_authority` signature and `now < expiry_unix`.
    /// Any surplus tokens donated into the vault are returned to the payer's ATA,
    /// then the vault and escrow are closed (rent -> payer).
    pub fn release(ctx: Context<Release>, response_hash: [u8; 32]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(now < ctx.accounts.escrow.expiry_unix, EscrowError::Expired);

        let escrow_key = ctx.accounts.escrow.key();
        let bump = ctx.accounts.escrow.bump;
        let (payer, pay_to, mint, payment_id, committed) = (
            ctx.accounts.escrow.payer,
            ctx.accounts.escrow.pay_to,
            ctx.accounts.escrow.mint,
            ctx.accounts.escrow.payment_id,
            ctx.accounts.escrow.amount,
        );
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"conditional",
            payer.as_ref(),
            pay_to.as_ref(),
            mint.as_ref(),
            payment_id.as_ref(),
            &[bump],
        ]];

        // F1: settle the *committed* amount, not the live vault balance. Exactly
        // `escrow.amount` reaches pay_to. `min` guards against the (impossible on
        // legacy SPL, but defensive) case of a vault holding less than `amount` so
        // settlement can never be bricked.
        let vault_bal = ctx.accounts.vault.amount;
        let to_pay_to = committed.min(vault_bal);
        let surplus = vault_bal - to_pay_to;

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.pay_to_ata.to_account_info(),
                    authority: ctx.accounts.escrow.to_account_info(),
                },
                signer_seeds,
            ),
            to_pay_to,
        )?;

        // F1: any donated surplus goes back to the PAYER, never to pay_to. This
        // also drains the vault to zero so `close_account` below cannot fail.
        if surplus > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.payer_ata.to_account_info(),
                        authority: ctx.accounts.escrow.to_account_info(),
                    },
                    signer_seeds,
                ),
                surplus,
            )?;
        }

        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.payer.to_account_info(),
                authority: ctx.accounts.escrow.to_account_info(),
            },
            signer_seeds,
        ))?;

        emit!(Released {
            escrow: escrow_key,
            pay_to,
            amount: to_pay_to,
            surplus_to_payer: surplus,
            response_hash,
        });
        Ok(())
    }

    /// Refund the vault to `ATA(payer, mint)`.
    /// Permissionless once `now >= expiry_unix`; before expiry the
    /// `release_authority` signature is required. The outcome party is the payer,
    /// so the committed amount *and* any donated surplus both go to the payer.
    /// Closes vault + escrow, returning rent to the payer.
    pub fn refund(ctx: Context<Refund>, response_hash: Option<[u8; 32]>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let expired = now >= ctx.accounts.escrow.expiry_unix;
        if !expired {
            require_keys_eq!(
                ctx.accounts.signer.key(),
                ctx.accounts.escrow.release_authority,
                EscrowError::Unauthorized
            );
        }

        let escrow_key = ctx.accounts.escrow.key();
        let bump = ctx.accounts.escrow.bump;
        let (payer, pay_to, mint, payment_id, committed) = (
            ctx.accounts.escrow.payer,
            ctx.accounts.escrow.pay_to,
            ctx.accounts.escrow.mint,
            ctx.accounts.escrow.payment_id,
            ctx.accounts.escrow.amount,
        );
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"conditional",
            payer.as_ref(),
            pay_to.as_ref(),
            mint.as_ref(),
            payment_id.as_ref(),
            &[bump],
        ]];

        // F1: the outcome party is the payer, so committed amount + any surplus all
        // settle to ATA(payer). Transferring the full vault balance to the single
        // payer destination is exactly that, and drains the vault for close.
        let vault_bal = ctx.accounts.vault.amount;
        let settled = committed.min(vault_bal);
        let surplus = vault_bal - settled;

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.payer_ata.to_account_info(),
                    authority: ctx.accounts.escrow.to_account_info(),
                },
                signer_seeds,
            ),
            vault_bal,
        )?;

        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.payer.to_account_info(),
                authority: ctx.accounts.escrow.to_account_info(),
            },
            signer_seeds,
        ))?;

        emit!(Refunded {
            escrow: escrow_key,
            payer,
            amount: settled,
            surplus_to_payer: surplus,
            expired,
            response_hash,
        });
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(payment_id: [u8; 32], amount: u64, expiry_unix: i64, pay_to: Pubkey)]
pub struct InitializeAndDeposit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub mint: Account<'info, Mint>,

    /// Source of funds. Must hold `mint` and be owned by `payer`.
    #[account(
        mut,
        token::mint = mint,
        token::authority = payer,
    )]
    pub payer_ata: Account<'info, TokenAccount>,

    /// CHECK: only its key is used, as a PDA seed; bound to the `pay_to` arg.
    pub pay_to: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + Escrow::INIT_SPACE,
        seeds = [
            b"conditional",
            payer.key().as_ref(),
            pay_to.key().as_ref(),
            mint.key().as_ref(),
            payment_id.as_ref(),
        ],
        bump,
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        init,
        payer = payer,
        seeds = [b"vault", escrow.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = escrow,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Release<'info> {
    /// Must be the recorded release authority.
    #[account(
        mut,
        address = escrow.release_authority @ EscrowError::Unauthorized,
    )]
    pub release_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [
            b"conditional",
            escrow.payer.as_ref(),
            escrow.pay_to.as_ref(),
            escrow.mint.as_ref(),
            escrow.payment_id.as_ref(),
        ],
        bump = escrow.bump,
        has_one = payer @ EscrowError::PayerMismatch,
        has_one = pay_to @ EscrowError::PayToMismatch,
        has_one = mint @ EscrowError::MintMismatch,
        close = payer,
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        mut,
        seeds = [b"vault", escrow.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = escrow,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// CHECK: bound to escrow.pay_to via has_one; only used as ATA authority.
    pub pay_to: UncheckedAccount<'info>,

    pub mint: Account<'info, Mint>,

    /// The only legal release destination: the canonical ATA of (pay_to, mint).
    /// F4: must already exist (no `init_if_needed`) so the release authority is
    /// never silently charged unrecoverable rent. If pay_to has no ATA, release
    /// fails with `AccountNotInitialized`.
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = pay_to,
    )]
    pub pay_to_ata: Account<'info, TokenAccount>,

    /// F1: destination for any donated surplus — the canonical ATA of (payer, mint).
    /// Must already exist (it funded the deposit). Surplus is never routed to pay_to.
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = payer,
    )]
    pub payer_ata: Account<'info, TokenAccount>,

    /// CHECK: bound to escrow.payer via has_one; rent recipient on close.
    #[account(mut)]
    pub payer: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    /// Anyone after expiry; before expiry must equal escrow.release_authority.
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [
            b"conditional",
            escrow.payer.as_ref(),
            escrow.pay_to.as_ref(),
            escrow.mint.as_ref(),
            escrow.payment_id.as_ref(),
        ],
        bump = escrow.bump,
        has_one = payer @ EscrowError::PayerMismatch,
        has_one = mint @ EscrowError::MintMismatch,
        close = payer,
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        mut,
        seeds = [b"vault", escrow.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = escrow,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    /// The only legal destination: the canonical ATA of (payer, mint).
    /// F4: must already exist (no `init_if_needed`) so a permissionless refunder is
    /// never charged unrecoverable rent. The payer's ATA necessarily exists — it
    /// funded the deposit.
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = payer,
    )]
    pub payer_ata: Account<'info, TokenAccount>,

    /// CHECK: bound to escrow.payer via has_one; ATA authority + rent recipient.
    #[account(mut)]
    pub payer: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct Escrow {
    pub payer: Pubkey,
    pub pay_to: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub expiry_unix: i64,
    pub predicate_hash: [u8; 32],
    pub release_authority: Pubkey,
    pub payment_id: [u8; 32],
    pub bump: u8,
}

#[event]
pub struct Initialized {
    pub escrow: Pubkey,
    pub payer: Pubkey,
    pub pay_to: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub expiry_unix: i64,
    pub predicate_hash: [u8; 32],
    pub release_authority: Pubkey,
}

#[event]
pub struct Released {
    pub escrow: Pubkey,
    pub pay_to: Pubkey,
    pub amount: u64,
    pub surplus_to_payer: u64,
    pub response_hash: [u8; 32],
}

#[event]
pub struct Refunded {
    pub escrow: Pubkey,
    pub payer: Pubkey,
    pub amount: u64,
    pub surplus_to_payer: u64,
    pub expired: bool,
    pub response_hash: Option<[u8; 32]>,
}

#[error_code]
pub enum EscrowError {
    #[msg("Deposit amount must be greater than zero")]
    ZeroAmount,
    #[msg("Expiry must be in the future")]
    ExpiryInPast,
    #[msg("Expiry must be at least MIN_TTL_SECS in the future")]
    ExpiryTooSoon,
    #[msg("Signer is not the release authority")]
    Unauthorized,
    #[msg("Escrow has expired")]
    Expired,
    #[msg("Payer account does not match escrow")]
    PayerMismatch,
    #[msg("Pay-to account does not match escrow")]
    PayToMismatch,
    #[msg("Mint does not match escrow")]
    MintMismatch,
    #[msg("Mint is not owned by the legacy SPL Token program")]
    IllegalTokenProgram,
}
