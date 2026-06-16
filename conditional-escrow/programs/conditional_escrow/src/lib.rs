//! Conditional-settlement escrow program.
//!
//! Non-custodial escrow implementing the `conditional` payment scheme: a payer
//! locks tokens that a designated `release_authority` may release to a fixed
//! recipient (`pay_to`) before an expiry, or that are refunded to the payer.
//! Funds can only ever reach `ATA(pay_to, mint)` (release) or
//! `ATA(payer, mint)` (refund); no instruction can route them to the release
//! authority, the fee payer, or any third party.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer};

declare_id!("9TwHxtc4HxSEkfosCbcjfkgAWEkF9MdGZsXU6Kzorgys");

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

        let now = Clock::get()?.unix_timestamp;
        require!(expiry_unix > now, EscrowError::ExpiryInPast);

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

    /// Release the full vault balance to `ATA(pay_to, mint)`.
    /// Requires the `release_authority` signature and `now < expiry_unix`.
    /// Closes the vault and escrow, returning rent to the payer.
    pub fn release(ctx: Context<Release>, response_hash: [u8; 32]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(now < ctx.accounts.escrow.expiry_unix, EscrowError::Expired);

        let amount = ctx.accounts.vault.amount;
        let escrow_key = ctx.accounts.escrow.key();
        let bump = ctx.accounts.escrow.bump;
        let (payer, pay_to, mint, payment_id) = (
            ctx.accounts.escrow.payer,
            ctx.accounts.escrow.pay_to,
            ctx.accounts.escrow.mint,
            ctx.accounts.escrow.payment_id,
        );
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"conditional",
            payer.as_ref(),
            pay_to.as_ref(),
            mint.as_ref(),
            payment_id.as_ref(),
            &[bump],
        ]];

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
            amount,
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

        emit!(Released {
            escrow: escrow_key,
            pay_to,
            amount,
            response_hash,
        });
        Ok(())
    }

    /// Refund the full vault balance to `ATA(payer, mint)`.
    /// Permissionless once `now >= expiry_unix`; before expiry the
    /// `release_authority` signature is required. Closes vault + escrow,
    /// returning rent to the payer.
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

        let amount = ctx.accounts.vault.amount;
        let escrow_key = ctx.accounts.escrow.key();
        let bump = ctx.accounts.escrow.bump;
        let (payer, pay_to, mint, payment_id) = (
            ctx.accounts.escrow.payer,
            ctx.accounts.escrow.pay_to,
            ctx.accounts.escrow.mint,
            ctx.accounts.escrow.payment_id,
        );
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"conditional",
            payer.as_ref(),
            pay_to.as_ref(),
            mint.as_ref(),
            payment_id.as_ref(),
            &[bump],
        ]];

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
            amount,
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
            amount,
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

    /// The only legal destination: the canonical ATA of (pay_to, mint).
    #[account(
        init_if_needed,
        payer = release_authority,
        associated_token::mint = mint,
        associated_token::authority = pay_to,
    )]
    pub pay_to_ata: Account<'info, TokenAccount>,

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
    #[account(
        init_if_needed,
        payer = signer,
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
    pub response_hash: [u8; 32],
}

#[event]
pub struct Refunded {
    pub escrow: Pubkey,
    pub payer: Pubkey,
    pub amount: u64,
    pub expired: bool,
    pub response_hash: Option<[u8; 32]>,
}

#[error_code]
pub enum EscrowError {
    #[msg("Deposit amount must be greater than zero")]
    ZeroAmount,
    #[msg("Expiry must be in the future")]
    ExpiryInPast,
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
}
