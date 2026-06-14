const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'swarm.db'));
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS earnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worker TEXT NOT NULL,
    route TEXT NOT NULL,
    earned_usdc REAL NOT NULL,
    buyer_address TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worker TEXT,
    message TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS free_tier (
    key TEXT PRIMARY KEY,
    calls_used INTEGER NOT NULL DEFAULT 0,
    max_calls INTEGER NOT NULL DEFAULT 50,
    email TEXT,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
  );
`);

const stmtLogEarning = db.prepare(
  'INSERT INTO earnings (worker, route, earned_usdc, buyer_address, created_at) VALUES (?, ?, ?, ?, ?)'
);

const stmtLogError = db.prepare(
  'INSERT INTO errors (worker, message, created_at) VALUES (?, ?, ?)'
);

function logEarning(worker, route, earned, buyerAddress) {
  stmtLogEarning.run(worker, route, earned, buyerAddress || null, Date.now());
}

function logError(worker, message) {
  stmtLogError.run(worker, message, Date.now());
}

function getStats() {
  const now = Date.now();

  const totalRow = db
    .prepare('SELECT COALESCE(SUM(earned_usdc), 0) as total, COUNT(*) as calls FROM earnings')
    .get();
  const totalEarned = totalRow.total;

  const earningsByWorker = db
    .prepare('SELECT worker, SUM(earned_usdc) as earned, COUNT(*) as calls FROM earnings GROUP BY worker')
    .all();

  const since24h = now - 24 * 60 * 60 * 1000;
  const last24hRow = db
    .prepare('SELECT COALESCE(SUM(earned_usdc), 0) as total FROM earnings WHERE created_at > ?')
    .get(since24h);

  // ── Revenue-page fields ──────────────────────────────────────────
  // "Today" = since 00:00 UTC (calendar day), distinct from the rolling 24h figure.
  const d = new Date(now);
  const startOfDayUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const todayRow = db
    .prepare('SELECT COALESCE(SUM(earned_usdc), 0) as revenue, COUNT(*) as calls FROM earnings WHERE created_at >= ?')
    .get(startOfDayUtc);

  // Per-endpoint, last 7 days
  const since7d = now - 7 * 24 * 60 * 60 * 1000;
  const endpoints = db
    .prepare(
      `SELECT route AS path, COUNT(*) AS calls7d, COALESCE(SUM(earned_usdc), 0) AS revenue7d
       FROM earnings WHERE created_at > ? GROUP BY route ORDER BY calls7d DESC`
    )
    .all(since7d);

  // Recent on-chain settlements — only rows carrying a real Solana signature.
  // (buyer_address holds the payment tx signature; free-tier / internal calls
  // leave it null, so we filter on a base58-signature-length sanity check.)
  const recentTx = db
    .prepare(
      `SELECT route AS endpoint, earned_usdc AS amountUsdc, buyer_address AS sig, created_at
       FROM earnings
       WHERE buyer_address IS NOT NULL AND length(buyer_address) >= 64
       ORDER BY created_at DESC LIMIT 12`
    )
    .all()
    .map((r) => ({
      endpoint: r.endpoint,
      amountUsdc: r.amountUsdc,
      sig: r.sig,
      ts: new Date(r.created_at).toISOString(),
    }));

  return {
    totalEarned,
    earningsByWorker,
    last24h: last24hRow.total,
    // revenue-page fields
    callsToday: todayRow.calls,
    revenueTodayUsdc: todayRow.revenue,
    callsAllTime: totalRow.calls,
    revenueAllTimeUsdc: totalEarned,
    endpoints,
    recentTx,
  };
}

// ── Free Tier ──────────────────────────────────────────────────

const stmtCreateKey = db.prepare(
  'INSERT OR IGNORE INTO free_tier (key, max_calls, email, created_at) VALUES (?, ?, ?, ?)'
);

const stmtGetKey = db.prepare('SELECT * FROM free_tier WHERE key = ?');

const stmtIncrementUsage = db.prepare(
  'UPDATE free_tier SET calls_used = calls_used + 1, last_used_at = ? WHERE key = ?'
);

const stmtFreeTierStats = db.prepare(
  'SELECT COUNT(*) as total_keys, SUM(calls_used) as total_calls FROM free_tier'
);

function createFreeTierKey(email = null, maxCalls = 50) {
  const key = 'fts_' + crypto.randomBytes(16).toString('hex');
  stmtCreateKey.run(key, maxCalls, email || null, Date.now());
  return { key, max_calls: maxCalls, calls_used: 0, remaining: maxCalls };
}

function checkFreeTierKey(key) {
  const row = stmtGetKey.get(key);
  if (!row) return null;
  const remaining = Math.max(0, row.max_calls - row.calls_used);
  return { ...row, remaining };
}

function useFreeTierCall(key) {
  stmtIncrementUsage.run(Date.now(), key);
}

function getFreeTierStats() {
  return stmtFreeTierStats.get();
}

module.exports = {
  logEarning, logError, getStats,
  createFreeTierKey, checkFreeTierKey, useFreeTierCall, getFreeTierStats,
};
