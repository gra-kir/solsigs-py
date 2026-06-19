# SolSigs x402 Intel Monitor

A **standalone, informational-only** weekly digest. It searches the x402
ecosystem for anything new that could help or hurt SolSigs, does a deterministic
read-only check of `solana-foundation/pay-skills` PR #138, and sends one
**Telegram** message. It takes no autonomous action — no service registration,
no outreach, no posting. Output is the Telegram message and a JSON state file,
nothing else.

It does **not** import or touch `index.js`, `db.js`, or any payment/settlement
middleware, and must never be made to.

> ⚠️ **Handover note — not yet run or verified.** This script was authored in a
> remote container that is **not** the production VPS: it has no Telegram
> credentials, no `ANTHROPIC_API_KEY`, and no access to the Hermes swarm, so it
> could not be executed or its delivery confirmed here. Treat it as reviewed
> source, not a tested artifact. **Do the VERIFY steps below on the VPS before
> adding it to cron.**

## What it does

- **A) Gather + analyze** — one Anthropic call (`claude-sonnet-4-6`,
  `max_tokens` 4000) with the server-side `web_search` tool enabled. The system
  prompt makes the model an x402 intelligence analyst for SolSigs and gives it
  the required source checklist (x402.org / Coinbase x402, the x402 spec repo,
  Solana Foundation pay-skills, 8004scan/8004.org/agent-registry, Dexter & PayAI,
  MCP registries, Virtuals ACP, Solana DeFi-data competitors, general x402 news).
  Every claim needs a dated source; unverifiable items are marked `UNCONFIRMED`.
- **B) Deterministic PR #138** — read-only `GET` of the PR via the GitHub API.
  If it flipped to **merged** since the last run, that becomes a top-line
  "fire launch kit" alert (not left to fuzzy search).
- **C) State / diff** — each run is written to
  `state/digest-<date>.json` plus a `state/latest.json` pointer. The next run
  loads the latest and passes it to the model so only genuinely new items surface.
- **D) Deliver** — renders a skimmable Telegram message (date header, top line
  first, then THREAT → OPPORTUNITY → WATCH with links) and sends it.

## Requirements

- Node 18+ (uses the built-in global `fetch`).
- `npm install` in this directory (pulls `@anthropic-ai/sdk`).

## Configuration (environment only — never hard-code secrets)

| Variable | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | Read from env. Never logged. |
| Telegram bot token | ✅ | First match of `INTEL_TELEGRAM_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_TOKEN`, `TG_TOKEN`. **Point this at the same var Hermes already uses to post digests — do not mint a new bot.** |
| Telegram chat id | ✅ | First match of `INTEL_TELEGRAM_CHAT_ID`, `TELEGRAM_CHAT_ID`, `TG_CHAT_ID`. Use the operator's chat. |
| `INTEL_STATE_DIR` | optional | Defaults to `./state`. On the VPS set to `/root/x402-swarm/intel/state` (or just run the repo from there). |
| `GITHUB_TOKEN` / `GH_TOKEN` | optional | Read-only; only raises the GitHub rate limit. |
| `INTEL_MODEL` | optional | Defaults to `claude-sonnet-4-6`. |
| `INTEL_MAX_TOKENS` | optional | Defaults to `4000`. |

> **Confirm the Telegram var names against the live Hermes config before the
> first run.** Phase-1 diagnosis on the VPS will show exactly which vars Hermes
> uses; map this script's overrides onto them rather than creating new ones.

## VERIFY (do this on the VPS, before cron)

```bash
cd /root/x402-swarm/intel        # or wherever you place this directory
npm install
node monitor.js
```

Then confirm **all** of:

1. It exits 0 **and** prints no secret values (the script self-redacts, but
   eyeball the output).
2. A message actually **lands in the Telegram chat**. A clean exit code is not
   proof of delivery — the operator should see the message.
3. `state/digest-<date>.json` was written.
4. The rendered Telegram text (printed between `--- Rendered Telegram message ---`
   markers) reads well on mobile.

The first run has no prior digest, so the model reports the current notable state
of the ecosystem rather than a diff; subsequent runs diff against `latest.json`.

## Schedule (only after a clean manual run + confirmed delivery)

Confirm the server timezone first — cron uses the system clock:

```bash
timedatectl            # or: cat /etc/timezone ; date
```

Then add a Monday-morning entry. **Example** (Monday 08:00 server time; adjust
the hour to Monday morning in the operator's timezone, and set absolute paths):

```cron
0 8 * * 1 cd /root/x402-swarm/intel && /usr/bin/node monitor.js >> /root/x402-swarm/intel/state/cron.log 2>&1
```

If the server clock is UTC and Grant is not, offset the hour accordingly (e.g.
for 08:00 America/Los_Angeles in winter, use `0 16 * * 1`). Env vars must be
visible to cron — either rely on the same mechanism Hermes uses (e.g. an env
file sourced in the command) or export them in the crontab.

Notes:
- Run by hand once successfully **before** putting it in cron.
- The script is idempotent per day (it overwrites `digest-<date>.json`).
- It never writes outside the state dir and never calls the payment path.
