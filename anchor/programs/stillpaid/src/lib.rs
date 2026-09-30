//! Stillpaid: milestone escrow where the client's silence after the review
//! window counts as approval. Disputes end in an agreed split, an arbiter's
//! decision or the split both sides fixed up front, so no path leaves money locked.
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked,
};

declare_id!("2gbyeNrQm2869HMK2mnSJyHc4cQfDrAGh6dk5ccoVyg4");

#[cfg(not(feature = "no-entrypoint"))]
solana_security_txt::security_txt! {
    name: "Stillpaid",
    project_url: "https://stillpaid.sorevo.de",
    contacts: "link:https://github.com/NWichter/stillpaid/security/advisories/new",
    policy: "https://github.com/NWichter/stillpaid/blob/main/SECURITY.md",
    source_code: "https://github.com/NWichter/stillpaid"
}

pub const MAX_TITLE_LEN: usize = 64;
pub const MAX_MILESTONES: u16 = 20;
pub const MAX_REVISIONS: u8 = 10;
pub const MAX_WINDOW_SECS: i64 = 90 * 24 * 60 * 60;
pub const MAX_DELIVERY_SECS: i64 = 365 * 24 * 60 * 60;
pub const BPS: u16 = 10_000;

/// Test builds allow one-minute windows for demos; mainnet builds
/// (`--no-default-features`) require at least an hour.
#[cfg(feature = "short-windows")]
pub const MIN_WINDOW_SECS: i64 = 60;
#[cfg(not(feature = "short-windows"))]
pub const MIN_WINDOW_SECS: i64 = 60 * 60;

/// A settled milestone stays readable this long before its rent can be reclaimed.
#[cfg(feature = "short-windows")]
pub const KEEP_SETTLED_SECS: i64 = 60;
#[cfg(not(feature = "short-windows"))]
pub const KEEP_SETTLED_SECS: i64 = 30 * 24 * 60 * 60;

#[program]
pub mod stillpaid {
    use super::*;

    #[allow(clippy::too_many_arguments)]
    pub fn create_job(
        ctx: Context<CreateJob>,
        job_id: u64,
        freelancer: Pubkey,
        arbiter: Pubkey,
        windows: Windows,
        max_revisions: u8,
        fallback_bps: u16,
        terms_hash: [u8; 32],
        title: String,
    ) -> Result<()> {
        let client = ctx.accounts.client.key();
        require!(fallback_bps <= BPS, StillpaidError::InvalidSplit);
        require!(
            freelancer != Pubkey::default() && freelancer != client,
            StillpaidError::InvalidParties
        );
        require!(
            arbiter == Pubkey::default() || (arbiter != client && arbiter != freelancer),
            StillpaidError::InvalidParties
        );
        windows.validate()?;
        require!(max_revisions <= MAX_REVISIONS, StillpaidError::InvalidRevisions);
        require!(
            !title.is_empty() && title.len() <= MAX_TITLE_LEN,
            StillpaidError::InvalidTitle
        );

        let job = &mut ctx.accounts.job;
        job.client = client;
        job.freelancer = freelancer;
        job.arbiter = arbiter;
        job.mint = ctx.accounts.mint.key();
        job.job_id = job_id;
        job.windows = windows;
        job.max_revisions = max_revisions;
        job.accepted = false;
        job.milestone_count = 0;
        job.open_milestones = 0;
        job.fallback_bps = fallback_bps;
        job.rent_payer = ctx.accounts.payer.key();
        job.terms_hash = terms_hash;
        job.bump = ctx.bumps.job;
        job.title = title;
        emit!(JobCreated {
            job: job.key(),
            client,
            freelancer,
            arbiter,
            fallback_bps,
            terms_hash,
        });
        Ok(())
    }

    pub fn add_milestone(
        ctx: Context<AddMilestone>,
        amount: u64,
        delivery_deadline: i64,
        title: String,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(amount > 0, StillpaidError::InvalidAmount);
        require!(
            delivery_deadline > now && delivery_deadline <= now + MAX_DELIVERY_SECS,
            StillpaidError::InvalidDeadline
        );
        require!(
            !title.is_empty() && title.len() <= MAX_TITLE_LEN,
            StillpaidError::InvalidTitle
        );
        let job = &ctx.accounts.job;
        require!(job.milestone_count < MAX_MILESTONES, StillpaidError::TooManyMilestones);

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.client_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.client.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        let m = &mut ctx.accounts.milestone;
        m.job = job.key();
        m.index = job.milestone_count;
        m.amount = amount;
        m.status = Status::Funded;
        m.delivery_deadline = delivery_deadline;
        m.review_deadline = 0;
        m.negotiate_deadline = 0;
        m.arbiter_deadline = 0;
        m.revisions = 0;
        m.submissions = 0;
        m.deliverable_hash = [0; 32];
        m.reason_hash = [0; 32];
        m.disputed_by = Role::None;
        m.proposal_by = Role::None;
        m.proposal_bps = 0;
        m.paid_freelancer = 0;
        m.paid_client = 0;
        m.settled_at = 0;
        m.rent_payer = ctx.accounts.payer.key();
        m.bump = ctx.bumps.milestone;
        m.title = title;

        let job = &mut ctx.accounts.job;
        job.milestone_count += 1;
        job.open_milestones += 1;
        emit!(MilestoneFunded {
            job: job.key(),
            milestone: m.key(),
            index: m.index,
            amount,
            delivery_deadline,
        });
        Ok(())
    }

    pub fn accept_job(ctx: Context<AcceptJob>) -> Result<()> {
        let job = &mut ctx.accounts.job;
        require!(!job.accepted, StillpaidError::AlreadyAccepted);
        job.accepted = true;
        emit!(JobAccepted { job: job.key(), freelancer: job.freelancer });
        Ok(())
    }

    pub fn submit(ctx: Context<Act>, deliverable_hash: [u8; 32]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let job = &ctx.accounts.job;
        require_keys_eq!(ctx.accounts.actor.key(), job.freelancer, StillpaidError::NotFreelancer);
        require!(job.accepted, StillpaidError::NotAccepted);
        let m = &mut ctx.accounts.milestone;
        require!(m.status == Status::Funded, StillpaidError::WrongStatus);
        require!(now <= m.delivery_deadline, StillpaidError::DeliveryLate);
        m.status = Status::Submitted;
        m.deliverable_hash = deliverable_hash;
        m.review_deadline = now + job.windows.review;
        m.submissions = m.submissions.saturating_add(1);
        emit!(Submitted {
            milestone: m.key(),
            deliverable_hash,
            review_deadline: m.review_deadline,
        });
        Ok(())
    }

    pub fn request_revision(ctx: Context<Act>, reason_hash: [u8; 32]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let job = &ctx.accounts.job;
        require_keys_eq!(ctx.accounts.actor.key(), job.client, StillpaidError::NotClient);
        let m = &mut ctx.accounts.milestone;
        require!(m.status == Status::Submitted, StillpaidError::WrongStatus);
        require!(now <= m.review_deadline, StillpaidError::ReviewOver);
        require!(m.revisions < job.max_revisions, StillpaidError::RevisionsUsedUp);
        m.status = Status::Funded;
        m.revisions += 1;
        m.reason_hash = reason_hash;
        m.delivery_deadline = m.delivery_deadline.max(now + job.windows.fix);
        emit!(RevisionRequested {
            milestone: m.key(),
            revisions: m.revisions,
            reason_hash,
            delivery_deadline: m.delivery_deadline,
        });
        Ok(())
    }

    pub fn open_dispute(ctx: Context<Act>, reason_hash: [u8; 32]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let job = &ctx.accounts.job;
        let role = role_of(job, &ctx.accounts.actor.key())?;
        let m = &mut ctx.accounts.milestone;
        match role {
            Role::Client => {
                require!(m.status == Status::Submitted, StillpaidError::WrongStatus);
                require!(now <= m.review_deadline, StillpaidError::ReviewOver);
            }
            _ => {
                require!(
                    m.status == Status::Funded && m.revisions > 0,
                    StillpaidError::WrongStatus
                );
                require!(now <= m.delivery_deadline, StillpaidError::DeliveryLate);
            }
        }
        m.status = Status::Disputed;
        m.disputed_by = role;
        m.reason_hash = reason_hash;
        m.negotiate_deadline = now + job.windows.negotiate;
        m.arbiter_deadline = m.negotiate_deadline + job.windows.arbiter;
        m.proposal_by = Role::None;
        m.proposal_bps = 0;
        emit!(DisputeOpened {
            milestone: m.key(),
            by: role,
            reason_hash,
            negotiate_deadline: m.negotiate_deadline,
        });
        Ok(())
    }

    pub fn propose_split(ctx: Context<Act>, freelancer_bps: u16) -> Result<()> {
        require!(freelancer_bps <= BPS, StillpaidError::InvalidSplit);
        let role = role_of(&ctx.accounts.job, &ctx.accounts.actor.key())?;
        let m = &mut ctx.accounts.milestone;
        require!(m.status == Status::Disputed, StillpaidError::WrongStatus);
        m.proposal_by = role;
        m.proposal_bps = freelancer_bps;
        emit!(SplitProposed { milestone: m.key(), by: role, freelancer_bps });
        Ok(())
    }

    pub fn approve(ctx: Context<Payout>) -> Result<()> {
        let a = &ctx.accounts;
        require_keys_eq!(a.actor.key(), a.job.client, StillpaidError::NotClient);
        require!(a.milestone.status == Status::Submitted, StillpaidError::WrongStatus);
        settle(ctx, BPS, Status::Released, Outcome::Approved)
    }

    pub fn release_on_silence(ctx: Context<Payout>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let m = &ctx.accounts.milestone;
        require!(m.status == Status::Submitted, StillpaidError::WrongStatus);
        require!(now > m.review_deadline, StillpaidError::ReviewNotOver);
        settle(ctx, BPS, Status::Released, Outcome::Silence)
    }

    /// The other side accepts the standing offer. `freelancer_bps` must match it,
    /// so a last-second change of the offer cannot be accepted by accident.
    pub fn accept_split(ctx: Context<Payout>, freelancer_bps: u16) -> Result<()> {
        let role = role_of(&ctx.accounts.job, &ctx.accounts.actor.key())?;
        let m = &ctx.accounts.milestone;
        require!(m.status == Status::Disputed, StillpaidError::WrongStatus);
        require!(
            m.proposal_by != Role::None && m.proposal_by != role,
            StillpaidError::NoOfferFromOtherSide
        );
        require!(m.proposal_bps == freelancer_bps, StillpaidError::OfferChanged);
        settle(ctx, freelancer_bps, Status::Settled, Outcome::Agreed)
    }

    pub fn resolve(ctx: Context<Payout>, freelancer_bps: u16) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(freelancer_bps <= BPS, StillpaidError::InvalidSplit);
        let a = &ctx.accounts;
        require!(a.job.arbiter != Pubkey::default(), StillpaidError::NoArbiter);
        require_keys_eq!(a.actor.key(), a.job.arbiter, StillpaidError::NotArbiter);
        require!(a.milestone.status == Status::Disputed, StillpaidError::WrongStatus);
        require!(now > a.milestone.negotiate_deadline, StillpaidError::StillNegotiating);
        require!(now <= a.milestone.arbiter_deadline, StillpaidError::ArbiterTooLate);
        settle(ctx, freelancer_bps, Status::Resolved, Outcome::Arbiter)
    }

    pub fn fallback_split(ctx: Context<Payout>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let a = &ctx.accounts;
        let m = &a.milestone;
        require!(m.status == Status::Disputed, StillpaidError::WrongStatus);
        let last = if a.job.arbiter == Pubkey::default() {
            m.negotiate_deadline
        } else {
            m.arbiter_deadline
        };
        require!(now > last, StillpaidError::FallbackNotDue);
        let bps = a.job.fallback_bps;
        settle(ctx, bps, Status::Resolved, Outcome::Timeout)
    }

    pub fn refund(ctx: Context<Payout>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let a = &ctx.accounts;
        require_keys_eq!(a.actor.key(), a.job.client, StillpaidError::NotClient);
        require!(a.milestone.status == Status::Funded, StillpaidError::WrongStatus);
        require!(
            !a.job.accepted || now > a.milestone.delivery_deadline,
            StillpaidError::NotLate
        );
        settle(ctx, 0, Status::Refunded, Outcome::Refunded)
    }

    /// Returns the rent of a settled milestone and its vault to whoever paid it.
    /// Tokens sent to the vault after settlement go to the client first.
    pub fn close_milestone(ctx: Context<CloseMilestone>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let a = ctx.accounts;
        require!(
            matches!(
                a.milestone.status,
                Status::Released | Status::Settled | Status::Resolved | Status::Refunded
            ),
            StillpaidError::WrongStatus
        );
        require!(
            now > a.milestone.settled_at + KEEP_SETTLED_SECS,
            StillpaidError::TooEarlyToClose
        );
        let job_key = a.job.key();
        let index = a.milestone.index.to_le_bytes();
        let bump = [a.milestone.bump];
        let seeds: &[&[u8]] = &[b"milestone", job_key.as_ref(), &index, &bump];
        if a.vault.amount > 0 {
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    a.token_program.to_account_info(),
                    TransferChecked {
                        from: a.vault.to_account_info(),
                        mint: a.mint.to_account_info(),
                        to: a.client_token.to_account_info(),
                        authority: a.milestone.to_account_info(),
                    },
                    &[seeds],
                ),
                a.vault.amount,
                a.mint.decimals,
            )?;
        }
        token_interface::close_account(CpiContext::new_with_signer(
            a.token_program.to_account_info(),
            CloseAccount {
                account: a.vault.to_account_info(),
                destination: a.rent_payer.to_account_info(),
                authority: a.milestone.to_account_info(),
            },
            &[seeds],
        ))?;
        a.job.open_milestones = a.job.open_milestones.saturating_sub(1);
        Ok(())
    }

    /// Once every milestone is closed, the job's rent goes back as well.
    pub fn close_job(ctx: Context<CloseJob>) -> Result<()> {
        let job = &ctx.accounts.job;
        require!(
            job.milestone_count > 0 && job.open_milestones == 0,
            StillpaidError::MilestonesOpen
        );
        Ok(())
    }
}

fn settle(ctx: Context<Payout>, freelancer_bps: u16, status: Status, outcome: Outcome) -> Result<()> {
    let a = ctx.accounts;
    let total = a.vault.amount;
    let to_freelancer = u64::try_from((total as u128) * (freelancer_bps as u128) / (BPS as u128))
        .map_err(|_| StillpaidError::Overflow)?;
    let to_client = total - to_freelancer;

    let job_key = a.job.key();
    let index = a.milestone.index.to_le_bytes();
    let bump = [a.milestone.bump];
    let seeds: &[&[u8]] = &[b"milestone", job_key.as_ref(), &index, &bump];
    for (to, amount) in [(&a.freelancer_token, to_freelancer), (&a.client_token, to_client)] {
        if amount == 0 {
            continue;
        }
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                a.token_program.to_account_info(),
                TransferChecked {
                    from: a.vault.to_account_info(),
                    mint: a.mint.to_account_info(),
                    to: to.to_account_info(),
                    authority: a.milestone.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            a.mint.decimals,
        )?;
    }

    let m = &mut a.milestone;
    m.status = status;
    m.paid_freelancer = to_freelancer;
    m.paid_client = to_client;
    m.settled_at = Clock::get()?.unix_timestamp;
    emit!(Paid {
        milestone: m.key(),
        outcome,
        to_freelancer,
        to_client,
    });
    Ok(())
}

fn role_of(job: &Job, who: &Pubkey) -> Result<Role> {
    if *who == job.client {
        Ok(Role::Client)
    } else if *who == job.freelancer {
        Ok(Role::Freelancer)
    } else {
        err!(StillpaidError::NotAParty)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub struct Windows {
    pub review: i64,
    pub fix: i64,
    pub negotiate: i64,
    pub arbiter: i64,
}

impl Windows {
    fn validate(&self) -> Result<()> {
        for w in [self.review, self.fix, self.negotiate, self.arbiter] {
            require!(
                (MIN_WINDOW_SECS..=MAX_WINDOW_SECS).contains(&w),
                StillpaidError::InvalidWindow
            );
        }
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum Status {
    Funded,
    Submitted,
    Disputed,
    Released,
    Settled,
    Resolved,
    Refunded,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum Role {
    None,
    Client,
    Freelancer,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Approved,
    Silence,
    Agreed,
    Arbiter,
    Timeout,
    Refunded,
}

#[account]
#[derive(InitSpace)]
pub struct Job {
    pub client: Pubkey,
    pub freelancer: Pubkey,
    /// Pubkey::default() = no arbiter: unresolved disputes end in the default split.
    pub arbiter: Pubkey,
    pub mint: Pubkey,
    pub job_id: u64,
    pub windows: Windows,
    pub max_revisions: u8,
    pub accepted: bool,
    pub milestone_count: u16,
    pub open_milestones: u16,
    /// Freelancer's share when a dispute runs out of time, agreed up front.
    pub fallback_bps: u16,
    pub rent_payer: Pubkey,
    pub terms_hash: [u8; 32],
    pub bump: u8,
    #[max_len(MAX_TITLE_LEN)]
    pub title: String,
}

#[account]
#[derive(InitSpace)]
pub struct Milestone {
    pub job: Pubkey,
    pub index: u16,
    /// Amount funded; payouts use the vault balance.
    pub amount: u64,
    pub status: Status,
    pub delivery_deadline: i64,
    pub review_deadline: i64,
    pub negotiate_deadline: i64,
    pub arbiter_deadline: i64,
    pub revisions: u8,
    pub submissions: u8,
    pub deliverable_hash: [u8; 32],
    pub reason_hash: [u8; 32],
    pub disputed_by: Role,
    pub proposal_by: Role,
    pub proposal_bps: u16,
    pub paid_freelancer: u64,
    pub paid_client: u64,
    pub settled_at: i64,
    pub rent_payer: Pubkey,
    pub bump: u8,
    #[max_len(MAX_TITLE_LEN)]
    pub title: String,
}

#[derive(Accounts)]
#[instruction(job_id: u64)]
pub struct CreateJob<'info> {
    pub client: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + Job::INIT_SPACE,
        seeds = [b"job", client.key().as_ref(), &job_id.to_le_bytes()],
        bump
    )]
    pub job: Account<'info, Job>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    /// Classic SPL Token only: Token-2022 fees, hooks or delegates could drain a vault.
    #[account(address = anchor_spl::token::ID @ StillpaidError::UnsupportedMint)]
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AddMilestone<'info> {
    pub client: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, has_one = client, has_one = mint)]
    pub job: Account<'info, Job>,
    #[account(
        init,
        payer = payer,
        space = 8 + Milestone::INIT_SPACE,
        seeds = [b"milestone", job.key().as_ref(), &job.milestone_count.to_le_bytes()],
        bump
    )]
    pub milestone: Account<'info, Milestone>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = client,
        token::token_program = token_program
    )]
    pub client_token: InterfaceAccount<'info, TokenAccount>,
    // init_if_needed: anyone could pre-create this canonical ATA to block the milestone.
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = milestone,
        associated_token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(address = anchor_spl::token::ID @ StillpaidError::UnsupportedMint)]
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AcceptJob<'info> {
    pub freelancer: Signer<'info>,
    #[account(mut, has_one = freelancer)]
    pub job: Account<'info, Job>,
}

#[derive(Accounts)]
pub struct Act<'info> {
    pub actor: Signer<'info>,
    pub job: Account<'info, Job>,
    #[account(
        mut,
        seeds = [b"milestone", job.key().as_ref(), &milestone.index.to_le_bytes()],
        bump = milestone.bump,
        has_one = job
    )]
    pub milestone: Account<'info, Milestone>,
}

#[derive(Accounts)]
pub struct CloseMilestone<'info> {
    #[account(mut, has_one = mint)]
    pub job: Account<'info, Job>,
    #[account(
        mut,
        close = rent_payer,
        seeds = [b"milestone", job.key().as_ref(), &milestone.index.to_le_bytes()],
        bump = milestone.bump,
        has_one = job,
        has_one = rent_payer
    )]
    pub milestone: Account<'info, Milestone>,
    /// Only whoever paid the rent may close, so nobody else can erase a settled record.
    #[account(mut)]
    pub rent_payer: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = milestone,
        associated_token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = job.client,
        associated_token::token_program = token_program
    )]
    pub client_token: InterfaceAccount<'info, TokenAccount>,
    #[account(address = anchor_spl::token::ID @ StillpaidError::UnsupportedMint)]
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct CloseJob<'info> {
    #[account(mut, close = rent_payer, has_one = rent_payer)]
    pub job: Account<'info, Job>,
    /// Only whoever paid the rent may close, so nobody else can erase a settled record.
    #[account(mut)]
    pub rent_payer: Signer<'info>,
}

#[derive(Accounts)]
pub struct Payout<'info> {
    pub actor: Signer<'info>,
    #[account(has_one = mint)]
    pub job: Account<'info, Job>,
    #[account(
        mut,
        seeds = [b"milestone", job.key().as_ref(), &milestone.index.to_le_bytes()],
        bump = milestone.bump,
        has_one = job
    )]
    pub milestone: Account<'info, Milestone>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = milestone,
        associated_token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = job.freelancer,
        associated_token::token_program = token_program
    )]
    pub freelancer_token: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = job.client,
        associated_token::token_program = token_program
    )]
    pub client_token: InterfaceAccount<'info, TokenAccount>,
    #[account(address = anchor_spl::token::ID @ StillpaidError::UnsupportedMint)]
    pub token_program: Interface<'info, TokenInterface>,
}

#[event]
pub struct JobCreated {
    pub job: Pubkey,
    pub client: Pubkey,
    pub freelancer: Pubkey,
    pub arbiter: Pubkey,
    pub fallback_bps: u16,
    pub terms_hash: [u8; 32],
}

#[event]
pub struct MilestoneFunded {
    pub job: Pubkey,
    pub milestone: Pubkey,
    pub index: u16,
    pub amount: u64,
    pub delivery_deadline: i64,
}

#[event]
pub struct JobAccepted {
    pub job: Pubkey,
    pub freelancer: Pubkey,
}

#[event]
pub struct Submitted {
    pub milestone: Pubkey,
    pub deliverable_hash: [u8; 32],
    pub review_deadline: i64,
}

#[event]
pub struct RevisionRequested {
    pub milestone: Pubkey,
    pub revisions: u8,
    pub reason_hash: [u8; 32],
    pub delivery_deadline: i64,
}

#[event]
pub struct DisputeOpened {
    pub milestone: Pubkey,
    pub by: Role,
    pub reason_hash: [u8; 32],
    pub negotiate_deadline: i64,
}

#[event]
pub struct SplitProposed {
    pub milestone: Pubkey,
    pub by: Role,
    pub freelancer_bps: u16,
}

#[event]
pub struct Paid {
    pub milestone: Pubkey,
    pub outcome: Outcome,
    pub to_freelancer: u64,
    pub to_client: u64,
}

#[error_code]
pub enum StillpaidError {
    #[msg("Client, freelancer and arbiter must be three different wallets")]
    InvalidParties,
    #[msg("A time window is shorter than this build allows or longer than 90 days")]
    InvalidWindow,
    #[msg("At most 10 revisions")]
    InvalidRevisions,
    #[msg("Title must be 1 to 64 bytes")]
    InvalidTitle,
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Delivery deadline must be in the future and at most a year out")]
    InvalidDeadline,
    #[msg("A job can have at most 20 milestones")]
    TooManyMilestones,
    #[msg("The freelancer already accepted this job")]
    AlreadyAccepted,
    #[msg("The freelancer has not accepted this job yet")]
    NotAccepted,
    #[msg("Only the freelancer can do this")]
    NotFreelancer,
    #[msg("Only the client can do this")]
    NotClient,
    #[msg("Only the arbiter can do this")]
    NotArbiter,
    #[msg("Only the client or the freelancer can do this")]
    NotAParty,
    #[msg("The milestone is not in the right state for this")]
    WrongStatus,
    #[msg("The delivery deadline has passed")]
    DeliveryLate,
    #[msg("The review window is over; silence counts as approval")]
    ReviewOver,
    #[msg("The review window is still open")]
    ReviewNotOver,
    #[msg("All revisions are used up; approve or open a dispute")]
    RevisionsUsedUp,
    #[msg("A split is given in basis points, 0 to 10000")]
    InvalidSplit,
    #[msg("There is no offer from the other side to accept")]
    NoOfferFromOtherSide,
    #[msg("The offer changed; reload and check it again")]
    OfferChanged,
    #[msg("This job has no arbiter")]
    NoArbiter,
    #[msg("The negotiation window is still open")]
    StillNegotiating,
    #[msg("The default split is not due yet")]
    FallbackNotDue,
    #[msg("The freelancer accepted the job and delivery is not late yet")]
    NotLate,
    #[msg("Only classic SPL Token mints such as USDC are supported")]
    UnsupportedMint,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("A settled milestone stays on record for a while before it can be closed")]
    TooEarlyToClose,
    #[msg("Close all milestones first")]
    MilestonesOpen,
    #[msg("The arbiter deadline has passed; the default split applies")]
    ArbiterTooLate,
}
