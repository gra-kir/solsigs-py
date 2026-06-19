#!/usr/bin/env node
/*
 * SolSigs x402 Intel Monitor  —  standalone weekly digest
 * ------------------------------------------------------------------
 * INFORMATIONAL ONLY. This script gathers and analyses x402-ecosystem
 * developments that could affect SolSigs and delivers a digest to
 * Telegram. It never registers services, posts to X, sends outreach,
 * or takes any autonomous action. Output = one Telegram message.
 *
 * It is fully standalone: it does NOT import index.js, db.js, or any
 * payment / settlement middleware, and must never be made to.
 *
 * Secrets are read from the environment only and are never logged.
 *
 * Pieces:
 *   A) GATHER + ANALYZE  — one Anthropic call, web_search enabled.
 *   B) DETERMINISTIC PR  — read-only GitHub check of pay-skills PR #138.
 *   C) STATE / DIFF      — persists each run; next run diffs against it.
 *   D) DELIVER           — renders + sends the Telegram message.
 *
 * Run once by hand before adding to cron. A clean exit code is NOT
 * proof of delivery — confirm the message actually lands in Telegram.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Config (all from env; never hard-code secrets)
// ---------------------------------------------------------------------------

const MODEL = process.env.INTEL_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = parseInt(process.env.INTEL_MAX_TOKENS || '4000', 10);

// State dir. On the VPS, point this at /root/x402-swarm/intel/state, or just
// run the repo from there. Defaults to ./state next to this script.
const STATE_DIR = process.env.INTEL_STATE_DIR || path.join(__dirname, 'state');

// Anthropic
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Telegram — reuse Hermes's existing delivery vars. The names below are the
// common ones; override with INTEL_TELEGRAM_* if Hermes uses different names.
// DO NOT invent new credentials — point these at whatever Hermes already uses.
const TG_TOKEN =
  process.env.INTEL_TELEGRAM_TOKEN ||
  process.env.TELEGRAM_BOT_TOKEN ||
  process.env.TELEGRAM_TOKEN ||
  process.env.TG_TOKEN;
const TG_CHAT =
  process.env.INTEL_TELEGRAM_CHAT_ID ||
  process.env.TELEGRAM_CHAT_ID ||
  process.env.TG_CHAT_ID;

// Optional: raises GitHub's unauthenticated rate limit. Read-only use only.
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

const PR_REPO = 'solana-foundation/pay-skills';
const PR_NUMBER = 138;

// ---------------------------------------------------------------------------
// Secret-safe logging
// ---------------------------------------------------------------------------

// Build a redaction list from anything secret we hold, so a stray value in an
// error string can never reach stdout/stderr.
const SECRETS = [ANTHROPIC_API_KEY, TG_TOKEN, GITHUB_TOKEN].filter(Boolean);

function redact(s) {
  let out = String(s);
  for (const sec of SECRETS) {
    if (sec) out = out.split(sec).join('[REDACTED]');
  }
  // Belt and suspenders: scrub anything that looks like a key/token.
  out = out.replace(/sk-ant-[A-Za-z0-9_-]+/g, '[REDACTED]');
  out = out.replace(/\b\d{6,}:[A-Za-z0-9_-]{30,}\b/g, '[REDACTED]'); // telegram bot token shape
  return out;
}

function log(...args) {
  console.log(redact(args.join(' ')));
}
function logErr(...args) {
  console.error(redact(args.join(' ')));
}

const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// C) State store
// ---------------------------------------------------------------------------

function loadLatestDigest() {
  try {
    const pointer = path.join(STATE_DIR, 'latest.json');
    if (fs.existsSync(pointer)) {
      return JSON.parse(fs.readFileSync(pointer, 'utf8'));
    }
    // Fallback: newest digest-*.json by name (dates sort lexicographically).
    if (!fs.existsSync(STATE_DIR)) return null;
    const files = fs
      .readdirSync(STATE_DIR)
      .filter((f) => /^digest-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort();
    if (!files.length) return null;
    return JSON.parse(fs.readFileSync(path.join(STATE_DIR, files[files.length - 1]), 'utf8'));
  } catch (e) {
    logErr('Warning: could not load previous digest:', e.message);
    return null;
  }
}

function saveDigest(digest) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const file = path.join(STATE_DIR, `digest-${digest.date}.json`);
  fs.writeFileSync(file, JSON.stringify(digest, null, 2));
  fs.writeFileSync(path.join(STATE_DIR, 'latest.json'), JSON.stringify(digest, null, 2));
  return file;
}

// ---------------------------------------------------------------------------
// B) Deterministic PR #138 check (read-only)
// ---------------------------------------------------------------------------

async function checkPr138() {
  const url = `https://api.github.com/repos/${PR_REPO}/pulls/${PR_NUMBER}`;
  const headers = {
    'User-Agent': 'solsigs-intel-monitor',
    Accept: 'application/vnd.github+json',
  };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      return { ok: false, error: `GitHub ${res.status}`, state: 'unknown', merged: false, merged_at: null };
    }
    const pr = await res.json();
    const merged = pr.merged === true || !!pr.merged_at;
    return {
      ok: true,
      state: merged ? 'merged' : pr.state, // open | closed | merged
      merged,
      merged_at: pr.merged_at || null,
      title: pr.title || '',
      url: pr.html_url || `https://github.com/${PR_REPO}/pull/${PR_NUMBER}`,
    };
  } catch (e) {
    return { ok: false, error: e.message, state: 'unknown', merged: false, merged_at: null };
  }
}

// ---------------------------------------------------------------------------
// A) Gather + analyze (one Anthropic call, web_search enabled)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an x402 ecosystem intelligence analyst for SolSigs.

SolSigs is the complete Solana on-chain DeFi data layer for AI agents. It exposes
23 MCP tools — 22 paid x402 endpoints (USDC on Solana mainnet) plus a free
wallet_status — covering DEX pricing, batch pricing/OHLCV, staking APYs, dev
activity, arbitrage, prediction markets, perps, wallet risk, wallet trust, token
launches, token safety, whale tracking, smart-money tracking, trending tokens,
memecoin trenches, NFT intel, social sentiment, an alpha feed, a DeFi Q&A
endpoint, RPC relay, and webhook alerts. The payTo address and endpoint manifest
are published at solsigs.com/.well-known/x402.json. SolSigs also ships an MCP
server so Claude, Hermes, Cursor and other agents can call it natively.

Your job: surface ANYTHING genuinely NEW in the x402 ecosystem this week that
could affect SolSigs positively OR negatively. You are informational only — you
recommend, you never act.

SEARCH CHECKLIST — search for fresh, dated developments in EACH of these every run:
  * x402.org and official x402 / Coinbase x402 announcements
  * the x402 spec repo — new releases or BREAKING spec changes (flag these loudly)
  * Solana Foundation pay-skills repo activity
  * 8004scan.io, 8004.org, solana.com/agent-registry (Solana agent trust layer)
  * facilitators Dexter and PayAI — product / partnership / competitive moves
  * MCP registry / PulseMCP / Smithery / mcp.so changes affecting listings
  * Virtuals ACP — especially any move toward Solana
  * competitors in the Solana DeFi-data-for-agents lane
  * general x402 news (CoinDesk, etc.)

RULES:
  * Every claim needs a dated source link. No link, no claim.
  * x402scan is JS-rendered — do NOT rely on live-scraping it; use dated reports
    and search results instead.
  * If you cannot verify an item against a real source, mark it "UNCONFIRMED" in
    the "what" field rather than asserting it as fact.
  * DIFF: you are given last week's digest. Only surface items that are genuinely
    NEW or materially changed versus last week. Do not repeat last week's items.
  * Be specific to SolSigs in every "why_solsigs" line.

OUTPUT: return ONLY a single JSON object (no prose, no markdown code fences),
exactly this shape:
{
  "items": [
    {
      "what": "one line; prefix with UNCONFIRMED: if unverified",
      "source": "https://... (dated)",
      "tag": "OPPORTUNITY | THREAT | WATCH",
      "why_solsigs": "one line, specific to SolSigs",
      "suggestion": "do-once listing | wake-up-trigger signal | ignore (wrong lane) | URGENT breaking change | no action",
      "next_step": "one concrete line"
    }
  ],
  "top_line": "the single most important development this week + the one recommended action, or 'nothing actionable this week'"
}`;

function buildUserPrompt(lastDigest, pr138) {
  const prLine = pr138.ok
    ? `Deterministic signal (already verified out-of-band, do not re-check): solana-foundation/pay-skills PR #138 state = ${pr138.state}${pr138.merged_at ? `, merged_at = ${pr138.merged_at}` : ''}.`
    : `Deterministic signal: PR #138 status could not be fetched this run (${pr138.error}).`;

  const last = lastDigest
    ? JSON.stringify({ date: lastDigest.date, items: lastDigest.items, top_line: lastDigest.top_line })
    : 'null (no prior digest — this is the first run; surface the current notable state of the ecosystem)';

  return `Today is ${today()}.

${prLine}

LAST WEEK'S DIGEST (diff against this — only surface NEW items):
${last}

Run the full search checklist now and return the JSON object described in your
instructions. Remember: dated source link per claim, mark unverifiable items
UNCONFIRMED, and keep every line skimmable on mobile.`;
}

function extractJson(text) {
  if (!text) return null;
  // Strip accidental code fences.
  let t = text.replace(/```(?:json)?/gi, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = t.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch (e) {
    return null;
  }
}

async function gatherAndAnalyze(lastDigest, pr138) {
  // Lazy require so the script gives a clear error if the SDK isn't installed.
  let Anthropic;
  try {
    Anthropic = require('@anthropic-ai/sdk');
  } catch (e) {
    throw new Error(
      "Missing dependency '@anthropic-ai/sdk'. Run `npm install` in the intel/ dir first."
    );
  }

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 12 }];
  const baseMessages = [{ role: 'user', content: buildUserPrompt(lastDigest, pr138) }];

  // Server-tool loop: web_search runs server-side and may return pause_turn when
  // it hits its internal iteration cap. Re-send to let it resume.
  let messages = baseMessages;
  let response;
  const MAX_CONTINUATIONS = 6;
  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });
    if (response.stop_reason !== 'pause_turn') break;
    messages = [...baseMessages, { role: 'assistant', content: response.content }];
  }

  const text = (response.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  const parsed = extractJson(text);
  if (!parsed || !Array.isArray(parsed.items)) {
    throw new Error('Model did not return parseable digest JSON. Raw head: ' + text.slice(0, 300));
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// D) Deliver
// ---------------------------------------------------------------------------

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderTelegram(digest, pr138) {
  const lines = [];
  lines.push(`<b>SolSigs x402 Intel</b> — ${esc(digest.date)}`);
  lines.push('');

  // Top line first.
  lines.push(`<b>TOP LINE:</b> ${esc(digest.top_line || 'nothing actionable this week')}`);

  // Deterministic PR #138 alert always shown if merged.
  if (pr138.ok && pr138.merged) {
    lines.push('');
    lines.push(`🚨 <b>PR #138 MERGED</b> — fire launch kit. ${esc(pr138.merged_at || '')}`);
    lines.push(esc(pr138.url));
  }

  const byTag = (tag) => (digest.items || []).filter((it) => (it.tag || '').toUpperCase() === tag);
  const section = (label, emoji, tag) => {
    const items = byTag(tag);
    if (!items.length) return;
    lines.push('');
    lines.push(`${emoji} <b>${label}</b>`);
    for (const it of items) {
      lines.push(`• ${esc(it.what)}`);
      if (it.why_solsigs) lines.push(`   ↳ ${esc(it.why_solsigs)}`);
      const sug = [it.suggestion, it.next_step].filter(Boolean).map(esc).join(' — ');
      if (sug) lines.push(`   ⮕ ${sug}`);
      if (it.source) lines.push(`   ${esc(it.source)}`);
    }
  };

  section('THREAT', '🔴', 'THREAT');
  section('OPPORTUNITY', '🟢', 'OPPORTUNITY');
  section('WATCH', '🟡', 'WATCH');

  if (!(digest.items || []).length && !(pr138.ok && pr138.merged)) {
    lines.push('');
    lines.push('No new items this week.');
  }

  let out = lines.join('\n');
  if (out.length > 4000) out = out.slice(0, 3980) + '\n…(truncated)';
  return out;
}

async function sendTelegram(text) {
  const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TG_CHAT,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) {
    throw new Error(`Telegram delivery failed: ${res.status} ${redact(JSON.stringify(body))}`);
  }
  return body;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Preflight: required env (report presence only, never values).
  const missing = [];
  if (!ANTHROPIC_API_KEY) missing.push('ANTHROPIC_API_KEY');
  if (!TG_TOKEN) missing.push('Telegram bot token (TELEGRAM_BOT_TOKEN / TELEGRAM_TOKEN / INTEL_TELEGRAM_TOKEN)');
  if (!TG_CHAT) missing.push('Telegram chat id (TELEGRAM_CHAT_ID / INTEL_TELEGRAM_CHAT_ID)');
  if (missing.length) {
    logErr('Missing required env: ' + missing.join(', '));
    process.exit(2);
  }

  log(`[${today()}] SolSigs x402 intel monitor starting (model=${MODEL}, state=${STATE_DIR})`);

  const lastDigest = loadLatestDigest();
  log('Previous digest:', lastDigest ? lastDigest.date : 'none (first run)');

  // B) deterministic PR check + flip detection vs last run
  const pr138 = await checkPr138();
  const prevPr = lastDigest && lastDigest.pr138 ? lastDigest.pr138 : null;
  const flippedToMerged = pr138.ok && pr138.merged && !(prevPr && prevPr.merged);
  log(`PR #138: ${pr138.ok ? pr138.state : 'fetch failed'}${flippedToMerged ? ' (NEWLY MERGED)' : ''}`);

  // A) gather + analyze
  log('Querying Anthropic with web_search…');
  const analysis = await gatherAndAnalyze(lastDigest, pr138);

  // Fold the deterministic launch trigger into the top line if it just flipped.
  if (flippedToMerged) {
    analysis.top_line = `PR #138 merged — fire launch kit. ${analysis.top_line || ''}`.trim();
  }

  const digest = {
    date: today(),
    generated_at: new Date().toISOString(),
    model: MODEL,
    pr138: { ok: pr138.ok, state: pr138.state, merged: pr138.merged, merged_at: pr138.merged_at },
    items: analysis.items || [],
    top_line: analysis.top_line || 'nothing actionable this week',
  };

  // C) persist
  const file = saveDigest(digest);
  log('Wrote', file, `(${digest.items.length} items)`);

  // D) deliver
  const text = renderTelegram(digest, pr138);
  log('--- Rendered Telegram message ---\n' + text + '\n--- end ---');
  await sendTelegram(text);
  log('Telegram message dispatched. (Confirm it actually landed in the chat.)');
}

main().catch((e) => {
  logErr('FATAL:', e && e.message ? e.message : String(e));
  process.exit(1);
});
