# SolSigs — current state (agent context)

> **What this is.** A living description of what SolSigs *is today* so the
> scoring and research stages judge opportunities against reality, not in a
> vacuum. The `coverage_gap` and `strategic_fit` rubric dimensions are scored
> **against this file**: does SolSigs already cover it, and does it fit our lane?
>
> **What this is NOT.** Not code, not internals, not secrets. No endpoint
> implementation details, no payment-middleware internals, no keys, wallets, or
> RPC credentials. This file is read by cheap-model scouts/scorers — treat every
> line as if it could leak. Describe *what* exists and *why it matters*, never *how*.
>
> **Keep it current.** A stale state file actively misleads. Update it when you
> ship something material. Short and accurate beats long and stale.
> Last updated: 2026-06-23

---

## One-line positioning
The complete Solana on-chain data layer for AI agents — Solana-native depth sold
per-call in USDC via x402. Our edge is depth on Solana specifically, not breadth
across chains.

## Lanes we ARE in
- Solana-native on-chain data, sold per-call via x402 (USDC).
- Agent-facing distribution: MCP-first, then A2A / AgentKit / Bedrock as follow-on.
- Tooling/infra that makes SolSigs data easier for agents to consume.
- Ecosystem positioning as the go-to Solana x402 data source.
- Open-source contribution to the x402 Foundation (the conditional escrow program).

## Lanes we are explicitly NOT in (do not propose these)
- **A marketplace** — explicitly rejected, wrong lane. Shelve anything shaped like this.
- Multi-chain breadth at the expense of Solana depth.
- Anything touching the live payment middleware / facilitator / billing path.
- Mainnet deploys or publishing as an agent action (always a separate human step).

---

## What's built — DATA ENDPOINTS (the SolSigs API)
22 endpoints, sold per-call in USDC via x402. List below is sourced directly
from the `solsigs-mcp` tool definitions (`mcp/src/solsigs_mcp/server.py`, package
0.2.0) — each tool name maps to one API path. Use this to dedup `coverage_gap`
against the real surface. `wallet_status` is a local diagnostic, not a billable
endpoint, and is listed separately at the end.

**Pricing & DEX**
- `get_dex_price` (`/dex`) — real-time DEX price, liquidity, and volume for a token across Jupiter + Birdeye.
- `get_batch_prices` (`/price`) — batch multi-token prices with OHLCV candlestick history and token metadata.
- `scan_arbitrage` (`/arb`) — cross-DEX arbitrage opportunities above a profit threshold.
- `get_trending_tokens` (`/trending`) — real-time trending tokens, sortable by volume, price action, or social.

**Wallet & smart-money intel**
- `analyze_wallet` (`/wallet`) — wallet risk score, transaction patterns, wash-trade and rug indicators.
- `get_wallet_trust` (`/trust`) — comprehensive trust/reputation score (age, behaviour, protocol interactions, wash flags).
- `track_smart_money` (`/smartmoney`) — top smart-money wallets with copy-trade signals, scored 0–100.
- `get_whale_activity` (`/whale`) — whale movements, large transfers, accumulation/distribution signals.

**Token discovery & safety**
- `detect_token_launches` (`/launches`) — fresh deployments on pump.fun and Raydium within a look-back window.
- `get_trenches` (`/trenches`) — pump.fun trenches scanner: bonding-curve progress and Raydium graduation alerts.
- `check_token_safety` (`/token-safety`) — full safety check (holders, LP lock/mint, freeze/mint authority) → 0–100 score.
- `get_alpha_feed` (`/alpha`) — alpha feed combining new launches with insider/smart-money signals.

**Derivatives, staking & NFT**
- `get_perps_data` (`/perps`) — Jupiter Perps + Drift markets, open interest, funding rates, position tracking.
- `get_staking_rates` (`/staking`) — liquid-staking APY, TVL, and unstaking terms across major Solana protocols.
- `get_nft_intel` (`/nft`) — NFT collection floor prices, rarity rankings, and wash-trade detection.

**Markets, sentiment & ecosystem**
- `get_prediction_market` (`/predict`) — Polymarket YES/NO contracts (prices, volume, liquidity, end date) by query/category.
- `get_social_sentiment` (`/social`) — social mentions, influencer activity, and trending scores for tokens/NFTs.
- `get_dev_activity` (`/dev`) — GitHub dev activity (commits, contributors, audit status) for Solana protocols.

**AI summaries / catch-all**
- `get_market_summary` (`/summary`) — AI plain-English summary of Solana market conditions for a query.
- `ask_defi_question` (`/ask`) — AI verdict on any Solana/DeFi question, grounded in live on-chain data (catch-all when no specific endpoint fits).

**Infra / utility**
- `rpc_relay` (`/rpc`) — pay-per-call Solana RPC relay (Helius endpoint) with built-in rate limiting.
- `create_alert` (`/alerts`) — register a webhook alert for price, volume, whale, or launch events.

**Diagnostic (not a billable endpoint)**
- `wallet_status` — MCP wallet status: USDC balance + Solana address (paid mode) or free-tier call count.

> Recently fixed: `/ask` now sends `{"query":…}` (was `{"question":…}`).

## What's built — MCP SERVER
- **solsigs-mcp 0.2.0** on PyPI (registry id `io.github.gra-kir/solsigs-mcp`).
  23 tools (22 endpoints + `wallet_status`). Free-tier mode: 50 calls, no wallet
  required. Claude Desktop / Cursor configs in README. **This is our primary
  distribution surface** — distribution opportunities should lead here.
- **Open TODO (next 0.2.x):** carry `environmentVariables` descriptions into
  `mcp/server.json` — `SOLSIGS_MCP_KEY` (now OPTIONAL with free-tier mode; it is
  the agent's OWN spend wallet, never a SolSigs key), plus `SOLANA_RPC_URL`,
  `SOLSIGS_BASE_URL`, `MCP_TRANSPORT` — then re-publish via mcp-publisher.
  (Confirmed still open: current `mcp/server.json` carries no `environmentVariables` block.)

## What's built — ON-CHAIN PROGRAMS
- **`conditional` escrow program** (Anchor) — part of the x402 Foundation
  open-source contribution. Repo `gra-kir/solsigs-py`, branch
  `claude/conditional-escrow-anchor-7gugv4`. Devnet stages complete; a mainnet
  demonstration is under consideration.
- **Agents must keep clear of this:** never touch its deployed program ID or
  upgrade authority. New program work is devnet-only with ephemeral test keypairs.

## What's built — INFRA / MIDDLEWARE (described, not internals)
- Custom on-chain USDC SPL transfer verification middleware enabling x402 on
  Solana mainnet (replacing x402-express, which doesn't support Solana mainnet).
  First verified end-to-end mainnet x402 payment confirmed.
- Hosting: Hetzner VPS, Node.js worker-threads architecture, Nginx reverse proxy,
  Cloudflare, Let's Encrypt SSL, domain solsigs.com.
- **Off-limits to agents.** Listed here only so they recognise it exists and
  never propose modifying it.

---

## ECOSYSTEM & DISTRIBUTION (strategic context — weigh in `strategic_fit`)

### Solana Foundation
- Key relationship: **Rish — Head of AI Growth, Solana Foundation.**
- An opportunity scores higher on strategic fit if it gives the Foundation
  relationship something concrete to point at — a clean reference integration, a
  useful primitive, or ecosystem-visible proof of traction.
- Current state: relationship is active; the conditional escrow program is our
  open-source contribution into the x402 Foundation orbit. An email to Rish is
  drafted and tied to the Pay.sh listing below.
  _<update with latest: last contact, anything Rish has asked for or signalled interest in — not yet on record here>_

### Pay.sh listing (in progress — high near-term priority)
- **PR #138** on the Pay.sh directory is **pending** — email drafted, awaiting
  merge or validator resolution.
- Anything that strengthens the Pay.sh case (resolves the blocker, adds proof of
  usage, improves listing quality) is **high strategic value right now** — flag
  it explicitly to the gate rather than treating it as ordinary distribution.
- Blocker / open question: awaiting merge or validator resolution.
  _<update with the precise current blocker if it has moved — no movement recorded here yet>_

### Reports / presence
- **"State of Solana x402"** — monthly report drafted for solsigs.com. Content
  that feeds or extends this (ecosystem data, trends, competitive moves) has
  distribution value and reinforces the go-to-source positioning.
- **VPS intel monitor (planned):** diff-based cron watching the MCP registry,
  PulseMCP, x402scan, and competitors' server.json (Telegram + log output). A
  find that overlaps this should note it rather than duplicate it.

---

## COMPETITIVE READ
- No incumbent has proven traction in Solana-native x402 data. SolSigs' edge is
  depth on Solana. Differentiate against generalist/multi-chain services on
  depth — do not try to match them on breadth.
  _<add named competitors and their specific gaps as you learn them, so agents
  can score coverage_gap against the field as well as against SolSigs — none
  named on record yet>_

## ROADMAP / what's next (so agents can spot what composes)
- MCP-first distribution, then A2A / AgentKit / Bedrock adapters.
- Land the Pay.sh listing (#138) and convert the Foundation relationship into
  visible reference usage.
- Ship the VPS intel monitor.
- Next solsigs-mcp 0.2.x: the `server.json` environmentVariables descriptions
  (see MCP SERVER TODO above), then re-publish.
  _<add near-term intentions so an agent can see when a find slots into the plan>_

---

## HOW TO USE THIS FILE WHEN SCORING
- **coverage_gap (max 15):** Is this already served by a SolSigs endpoint, the
  MCP server, or the escrow program above? If yes → low score, likely shelve.
  Genuinely unserved → high.
- **strategic_fit (max 15):** Does it deepen Solana-native advantage, strengthen
  the Foundation relationship or the Pay.sh listing, or compose with something
  already built (e.g. an SDK bundling existing endpoints)? High. Generic,
  off-lane, or in a "NOT in" lane → low / shelve.
- **Composability is a signal worth surfacing:** if an opportunity is valuable
  *because* it combines with existing surface (endpoints + a missing SDK, data +
  a missing integration, anything that helps Pay.sh/Foundation), say so
  explicitly in the proposal — that is exactly the insight worth a human's
  attention at the gate.
