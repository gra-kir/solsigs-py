require('dotenv').config();
const express = require('express');
const { PublicKey } = require('@solana/web3.js');
const { getAssociatedTokenAddress } = require('@solana/spl-token');

const { getPublicKey, getUsdcBalance, getConnection } = require('./wallet');
const db = require('./db');
const WorkerPool = require('./pool');
const { getQueueDepth, getTokenCount } = require('./birdeye');

const PORT = process.env.PORT || 3000;
const TASK_NAMES = ['dexFeed', 'arbScanner', 'walletIntel', 'launchDetector', 'summarizer', 'rpcBalancer'];

async function main() {
  // 1. Init SQLite
  console.log('[boot] Database ready');

  // 2. Init wallet
  const walletAddress = getPublicKey();
  const usdcBalance = await getUsdcBalance().catch(() => 0);
  console.log(`[boot] Wallet: ${walletAddress}`);
  console.log(`[boot] USDC balance: ${usdcBalance}`);

  // 3. Init worker pool
  const pool = new WorkerPool();
  pool.init(TASK_NAMES);
  console.log('[boot] Worker pool initialized — 6 workers spawned');

  // 4. Start Express
  const app = express();
  app.use(express.json());

  // ── CORS — required for browser-based x402 agents and x402scan ───────────
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Payment-Signature, X-Payment, Authorization');
    res.setHeader('Access-Control-Expose-Headers', 'Payment-Required, X-Payment-Response');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // ── x402 v2 payment middleware (Solana USDC, no facilitator dependency) ────
  //
  // Inbound: reads PAYMENT-SIGNATURE header (x402 v2) with X-PAYMENT fallback
  // (x402 v1). The client submits a USDC transfer on Solana, gets a confirmed
  // transaction signature (base58), and passes it. We verify on-chain:
  // confirmed, correct amount, correct recipient, not older than 60s, not reused.
  //
  // Outbound: returns full PaymentRequired JSON in the response body (so
  // body-reading x402 clients work) AND in the base64-encoded PAYMENT-REQUIRED
  // header (for header-reading clients). Body was previously empty ({}).

  const USDC_MINT_ADDRESS = process.env.USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const NETWORK_LABEL     = process.env.NETWORK === 'devnet' ? 'solana-devnet' : 'solana-mainnet';
  const MAX_TX_AGE_SEC    = 60;

  const ROUTE_PRICES = {
    'POST /dex':      0.002,
    'POST /arb':      0.010,
    'POST /wallet':   0.005,
    'POST /launches': 0.003,
    'POST /summary':  0.008,
    'POST /rpc':      0.001,
  };

  // Replay protection: signature → expiry timestamp (ms)
  const usedSignatures = new Map();
  function sweepSignatures() {
    const now = Date.now();
    for (const [sig, exp] of usedSignatures) {
      if (now > exp) usedSignatures.delete(sig);
    }
  }

  // Find a USDC transferChecked or transfer instruction paying our ATA
  function findUsdcTransfer(tx, ourAta, requiredAtomic) {
    const allIxs = [...(tx.transaction.message.instructions || [])];
    for (const inner of (tx.meta?.innerInstructions || [])) {
      allIxs.push(...inner.instructions);
    }
    for (const ix of allIxs) {
      if (ix.program !== 'spl-token' || !ix.parsed) continue;
      const { type, info } = ix.parsed;
      if (type === 'transferChecked') {
        if (info.destination === ourAta &&
            info.mint        === USDC_MINT_ADDRESS &&
            BigInt(info.tokenAmount.amount) >= BigInt(requiredAtomic)) return true;
      } else if (type === 'transfer') {
        if (info.destination === ourAta &&
            BigInt(info.amount) >= BigInt(requiredAtomic)) return true;
      }
    }
    return false;
  }

  async function verifyPayment(signature, requiredAtomic, recipientAddress) {
    if (usedSignatures.has(signature)) return { ok: false, error: 'Signature already used' };

    const connection = getConnection();
    const ourAta = (await getAssociatedTokenAddress(
      new PublicKey(USDC_MINT_ADDRESS),
      new PublicKey(recipientAddress)
    )).toString();

    let tx;
    try {
      tx = await connection.getParsedTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
    } catch (e) {
      return { ok: false, error: 'RPC error fetching transaction' };
    }

    if (!tx)                    return { ok: false, error: 'Transaction not found or not yet confirmed' };
    if (tx.meta?.err)           return { ok: false, error: 'Transaction failed on-chain' };

    const ageSec = Math.floor(Date.now() / 1000) - (tx.blockTime || 0);
    if (ageSec > MAX_TX_AGE_SEC) return { ok: false, error: `Transaction too old (${ageSec}s, max ${MAX_TX_AGE_SEC}s)` };

    if (!findUsdcTransfer(tx, ourAta, requiredAtomic)) {
      return { ok: false, error: `No USDC transfer of ≥${requiredAtomic} atomic units to ${recipientAddress} found` };
    }

    usedSignatures.set(signature, Date.now() + MAX_TX_AGE_SEC * 2 * 1000);
    sweepSignatures();
    return { ok: true };
  }

  // ENDPOINT METADATA — used for v2 PaymentRequired resource descriptions
  const ENDPOINT_META = {
    'POST /dex':      { desc: 'Solana DEX price data — real-time prices, liquidity, and volume across Jupiter + Birdeye',             tags: ['solana', 'defi', 'dex'] },
    'POST /arb':      { desc: 'Cross-DEX arbitrage opportunity detection — find profitable trades between Solana exchanges',        tags: ['solana', 'defi', 'arbitrage'] },
    'POST /wallet':   { desc: 'Wallet risk scoring and transaction analysis — detect suspicious patterns, wash trading, and rug risks',  tags: ['solana', 'wallet', 'risk'] },
    'POST /launches': { desc: 'New token launch detection — spot fresh deployments and snipe opportunities on pump.fun and Raydium',    tags: ['solana', 'tokens', 'launches'] },
    'POST /summary':  { desc: 'AI-powered plain-English market summary — turn raw Solana data into readable insights',                  tags: ['solana', 'ai', 'analytics'] },
    'POST /rpc':      { desc: 'Pay-per-call Solana RPC relay — shared Helius endpoint with built-in rate limiting',                     tags: ['solana', 'rpc', 'infrastructure'] },
  };

  // SOLANA CAIP-2: namespace:chainId
  const SOLANA_CAIP2 = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

  function paymentRequirements(path, priceUsdc, host, protocol) {
    const meta = ENDPOINT_META[`POST ${path}`] || { desc: `Payment for POST ${path}`, tags: ['solana'] };
    const resourceUrl = `${protocol}://${host}${path}`;
    return {
      x402Version: 2,
      error:       'Payment required — attach PAYMENT-SIGNATURE header with a confirmed USDC transfer',
      accepts: [{
        scheme:             'exact',
        network:            SOLANA_CAIP2,
        maxAmountRequired:  String(Math.round(priceUsdc * 1_000_000)),
        asset:              USDC_MINT_ADDRESS,
        payTo:              walletAddress,
        maxTimeoutSeconds:  MAX_TX_AGE_SEC,
        resource:           resourceUrl,
        description:        meta.desc,
        extra:              { name: 'USDC', decimals: 6, serviceName: 'SolSigs', tags: meta.tags },
      }],
    };
  }

  function send402(res, paymentRequired) {
    const encoded = Buffer.from(JSON.stringify(paymentRequired)).toString('base64');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Payment-Required', encoded);
    // Body carries the full PR so body-reading clients work without header parsing
    res.status(402).json(paymentRequired);
  }

  app.use(async (req, res, next) => {
    if (req.method !== 'POST') return next();
    const price = ROUTE_PRICES[`POST ${req.path}`];
    if (price === undefined) return next();

    // v2: PAYMENT-SIGNATURE first, fall back to X-PAYMENT for v1 compat
    const sig = (req.headers['payment-signature'] || req.headers['x-payment'] || '').trim();
    if (!sig) {
      const pr = paymentRequirements(req.path, price, req.get('host'), req.protocol);
      pr.error = 'PAYMENT-SIGNATURE header is required';
      return send402(res, pr);
    }

    const result = await verifyPayment(sig, Math.round(price * 1_000_000), walletAddress).catch(e => ({ ok: false, error: e.message }));
    if (!result.ok) {
      const pr = paymentRequirements(req.path, price, req.get('host'), req.protocol);
      pr.error = result.error;
      return send402(res, pr);
    }

    req.paymentSignature = sig;
    next();
  });

  // Route: DEX Price Feed
  app.post('/dex', async (req, res) => {
    try {
      const result = await pool.dispatch('dexFeed', req.body);
      db.logEarning('dexFeed', '/dex', 0.002, req.paymentSignature);
      res.json(result);
    } catch (err) {
      db.logError('dexFeed', err.message);
      res.status(503).json({ error: 'Worker unavailable, try again' });
    }
  });

  // Route: Arbitrage Scanner
  app.post('/arb', async (req, res) => {
    try {
      const result = await pool.dispatch('arbScanner', req.body);
      db.logEarning('arbScanner', '/arb', 0.010, req.paymentSignature);
      res.json(result);
    } catch (err) {
      db.logError('arbScanner', err.message);
      res.status(503).json({ error: 'Worker unavailable, try again' });
    }
  });

  // Route: Wallet Intelligence
  app.post('/wallet', async (req, res) => {
    try {
      const result = await pool.dispatch('walletIntel', req.body);
      db.logEarning('walletIntel', '/wallet', 0.005, req.paymentSignature);
      res.json(result);
    } catch (err) {
      db.logError('walletIntel', err.message);
      res.status(503).json({ error: 'Worker unavailable, try again' });
    }
  });

  // Route: Token Launch Detector
  app.post('/launches', async (req, res) => {
    try {
      const result = await pool.dispatch('launchDetector', req.body);
      db.logEarning('launchDetector', '/launches', 0.003, req.paymentSignature);
      res.json(result);
    } catch (err) {
      db.logError('launchDetector', err.message);
      res.status(503).json({ error: 'Worker unavailable, try again' });
    }
  });

  // Route: Summarizer
  app.post('/summary', async (req, res) => {
    try {
      const result = await pool.dispatch('summarizer', req.body);
      db.logEarning('summarizer', '/summary', 0.008, req.paymentSignature);
      res.json(result);
    } catch (err) {
      db.logError('summarizer', err.message);
      res.status(503).json({ error: 'Worker unavailable, try again' });
    }
  });

  // Route: RPC Balancer
  app.post('/rpc', async (req, res) => {
    try {
      const result = await pool.dispatch('rpcBalancer', req.body);
      db.logEarning('rpcBalancer', '/rpc', 0.001, req.paymentSignature);
      res.json(result);
    } catch (err) {
      db.logError('rpcBalancer', err.message);
      res.status(503).json({ error: 'Worker unavailable, try again' });
    }
  });

  // ── Rate limiter for the public /stats endpoint ─────────────────────────
  // Simple per-IP fixed-window limiter (no external dep). Behind Cloudflare,
  // so trust cf-connecting-ip first, then x-forwarded-for, then socket IP.
  const STATS_RATE_WINDOW_MS = 60 * 1000;
  const STATS_RATE_MAX = 60; // 60 requests / minute / IP
  const statsRateBucket = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [ip, b] of statsRateBucket) if (now > b.resetAt) statsRateBucket.delete(ip);
  }, 5 * 60 * 1000).unref?.();

  function statsRateLimit(req, res, next) {
    const ip =
      req.headers['cf-connecting-ip'] ||
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    let b = statsRateBucket.get(ip);
    if (!b || now > b.resetAt) { b = { count: 0, resetAt: now + STATS_RATE_WINDOW_MS }; statsRateBucket.set(ip, b); }
    b.count++;
    if (b.count > STATS_RATE_MAX) {
      res.setHeader('Retry-After', Math.ceil((b.resetAt - now) / 1000));
      return res.status(429).json({ error: 'Rate limit exceeded — try again shortly.' });
    }
    next();
  }

  // Public stats — revenue figures only. No wallet balance, no worker/internal
  // telemetry. Safe to serve publicly; rate-limited to deter scraping.
  app.get('/stats', statsRateLimit, (req, res) => {
    const s = db.getStats();
    res.setHeader('Cache-Control', 'public, max-age=15');
    res.json({
      callsToday:         s.callsToday,
      revenueTodayUsdc:   s.revenueTodayUsdc,
      callsAllTime:       s.callsAllTime,
      revenueAllTimeUsdc: s.revenueAllTimeUsdc,
      endpoints:          s.endpoints,
      recentTx:           s.recentTx,
      earnings: {
        totalEarned:      s.totalEarned,
        last24h:          s.last24h,
        earningsByWorker: s.earningsByWorker,
      },
      uptime_seconds: Math.floor(process.uptime()),
      updatedAt: new Date().toISOString(),
    });
  });

  // Admin stats — full operational telemetry incl. wallet balance and worker
  // internals. Key-gated with the same secret as the dashboard.
  app.get('/admin/stats', async (req, res) => {
    const crypto = require('crypto');
    const pass = req.query.key || '';
    const hash = crypto.createHash('sha256').update(pass).digest('hex');
    if (hash !== (process.env.DASHBOARD_KEY_SHA256 || '')) {
      return res.status(403).json({ error: 'Access denied — provide ?key=YOUR_KEY' });
    }
    const stats   = db.getStats();
    const status  = pool.getStatus();
    const balance = await getUsdcBalance().catch(() => 0);
    const birdeye = { queueDepth: getQueueDepth(), tokens: getTokenCount() };
    res.json({ balance_usdc: balance, earnings: stats, workers: status, birdeye, uptime_seconds: Math.floor(process.uptime()) });
  });

  // x402 discovery document — validators and agents discover all endpoints here
  app.get('/.well-known/x402.json', (req, res) => {
    const protocol = req.protocol;
    const host = req.get('host');
    const ENDPOINT_LIST = Object.entries(ENDPOINT_META).map(([key, meta]) => {
      const [, epPath] = key.split(' ');
      const price = ROUTE_PRICES[key] || 0;
      return {
        method: 'POST',
        path: epPath,
        description: meta.desc,
        price: String(price),
        currency: 'USDC',
        maxAmountRequired: String(Math.round(price * 1_000_000)),
        asset: USDC_MINT_ADDRESS,
        maxTimeoutSeconds: MAX_TX_AGE_SEC,
        tags: meta.tags,
      };
    });
    res.json({
      x402Version: 2,
      network: SOLANA_CAIP2,
      name: 'SolSigs',
      description: 'Solana blockchain data via micropayments — DEX prices, arbitrage, wallet intel, token launches, AI summaries, and more.',
      url: `${protocol}://${host}`,
      payTo: walletAddress,
      asset: USDC_MINT_ADDRESS,
      endpoints: ENDPOINT_LIST,
    });
  });

  // Dashboard route (no payment)
  app.get('/', (req, res) => res.sendFile(__dirname + '/landing.html'));
  app.get('/revenue', (req, res) => res.sendFile(__dirname + '/revenue.html'));
  app.get('/discover', (req, res) => res.sendFile(__dirname + '/discover.html'));
  app.get('/docs', (req, res) => res.sendFile(__dirname + '/docs.html'));
  app.get("/og-image.png", (req, res) => res.sendFile(__dirname + "/og-image.png"));

  // x402scan discovery — serves OpenAPI spec for auto-registration
  app.get("/openapi.json", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.sendFile(__dirname + "/openapi.json");
  });

  // Dashboard auth middleware
  app.use('/dashboard', (req, res, next) => {
    const pass = req.query.key || '';
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(pass).digest('hex');
    if (hash === (process.env.DASHBOARD_KEY_SHA256 || '')) return next();
    res.status(403).send('Access denied — provide ?key=YOUR_KEY');
  });


  app.get('/dashboard', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>x402 Swarm Dashboard</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:        #080810;
    --surface:   #0f0f1a;
    --surface2:  #161625;
    --border:    #1e1e35;
    --green:     #00e87a;
    --green-dim: #00884a;
    --red:       #ff3d55;
    --amber:     #ffaa00;
    --blue:      #4dabff;
    --purple:    #9d7fff;
    --text:      #dde0f5;
    --muted:     #5a5a80;
    --font: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--font);
    font-size: 13px;
    min-height: 100vh;
    padding: 24px;
  }

  /* ── Header ── */
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 28px;
  }
  .logo {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .logo-icon {
    width: 36px; height: 36px;
    background: linear-gradient(135deg, var(--green), var(--blue));
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    font-size: 18px;
  }
  .logo-text { font-size: 18px; font-weight: 700; letter-spacing: 0.04em; color: #fff; }
  .logo-sub  { font-size: 11px; color: var(--muted); margin-top: 1px; }
  .header-right { text-align: right; }
  .refresh-badge {
    display: inline-flex; align-items: center; gap: 6px;
    background: var(--surface2); border: 1px solid var(--border);
    border-radius: 20px; padding: 4px 12px; font-size: 11px; color: var(--muted);
  }
  .pulse {
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--green);
    box-shadow: 0 0 6px var(--green);
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%       { opacity: 0.4; transform: scale(0.7); }
  }
  .last-updated { font-size: 10px; color: var(--muted); margin-top: 4px; }

  /* ── Grid helpers ── */
  .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 16px; }
  .grid-6 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 16px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }

  @media (max-width: 900px) {
    .grid-3, .grid-6 { grid-template-columns: 1fr 1fr; }
    .grid-2           { grid-template-columns: 1fr; }
  }
  @media (max-width: 560px) {
    .grid-3, .grid-6, .grid-2 { grid-template-columns: 1fr; }
  }

  /* ── Cards ── */
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
    position: relative;
    overflow: hidden;
    transition: border-color 0.2s;
  }
  .card:hover { border-color: #2e2e50; }
  .card::before {
    content: '';
    position: absolute; top: 0; left: 0; right: 0; height: 1px;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent);
  }

  /* ── Stat cards (top row) ── */
  .stat-label {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em;
    color: var(--muted); margin-bottom: 8px;
  }
  .stat-value {
    font-size: 32px; font-weight: 700; line-height: 1;
    color: #fff; letter-spacing: -0.02em;
  }
  .stat-value.green  { color: var(--green); text-shadow: 0 0 20px rgba(0,232,122,0.3); }
  .stat-value.blue   { color: var(--blue);  text-shadow: 0 0 20px rgba(77,171,255,0.3); }
  .stat-value.purple { color: var(--purple); }
  .stat-sub { font-size: 11px; color: var(--muted); margin-top: 6px; }

  .card-accent-green { border-left: 3px solid var(--green); }
  .card-accent-blue  { border-left: 3px solid var(--blue); }
  .card-accent-purple{ border-left: 3px solid var(--purple); }

  /* ── Section label ── */
  .section-label {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.14em;
    color: var(--muted); margin-bottom: 12px; display: flex; align-items: center; gap: 8px;
  }
  .section-label::after {
    content: ''; flex: 1; height: 1px; background: var(--border);
  }

  /* ── Worker cards ── */
  .worker-header {
    display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 14px;
  }
  .worker-name { font-size: 13px; font-weight: 600; color: #fff; }
  .worker-route { font-size: 10px; color: var(--muted); margin-top: 2px; }
  .status-dot {
    width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; margin-top: 3px;
    transition: background 0.3s, box-shadow 0.3s;
  }
  .status-dot.idle  { background: var(--green); box-shadow: 0 0 8px var(--green-dim); }
  .status-dot.busy  { background: var(--amber); box-shadow: 0 0 8px rgba(255,170,0,0.5);
                      animation: pulse 0.8s ease-in-out infinite; }
  .status-dot.error { background: var(--red); box-shadow: 0 0 8px rgba(255,61,85,0.5); }

  .worker-stats { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
  .ws-item { }
  .ws-val  { font-size: 18px; font-weight: 700; color: #fff; }
  .ws-key  { font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); margin-top: 2px; }

  .earned-pill {
    display: inline-block; margin-top: 12px;
    background: rgba(0,232,122,0.08); border: 1px solid rgba(0,232,122,0.2);
    color: var(--green); border-radius: 20px; padding: 3px 10px; font-size: 11px;
  }

  /* ── Birdeye card ── */
  .birdeye-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .be-meter-label {
    display: flex; justify-content: space-between;
    font-size: 10px; color: var(--muted); margin-bottom: 6px;
  }
  .be-bar-bg {
    height: 6px; border-radius: 3px; background: var(--surface2); overflow: hidden;
  }
  .be-bar-fill {
    height: 100%; border-radius: 3px; transition: width 0.5s ease;
    background: linear-gradient(90deg, var(--green), var(--blue));
  }
  .be-bar-fill.warn {
    background: linear-gradient(90deg, var(--amber), var(--red));
  }
  .be-val { font-size: 28px; font-weight: 700; color: #fff; margin-bottom: 4px; }
  .be-sub { font-size: 10px; color: var(--muted); }

  /* ── Endpoints table ── */
  .endpoints-table { width: 100%; border-collapse: collapse; }
  .endpoints-table th {
    text-align: left; font-size: 9px; text-transform: uppercase;
    letter-spacing: 0.12em; color: var(--muted); padding: 0 10px 10px 10px;
    border-bottom: 1px solid var(--border);
  }
  .endpoints-table td { padding: 10px; border-bottom: 1px solid rgba(30,30,53,0.5); }
  .endpoints-table tr:last-child td { border-bottom: none; }
  .endpoints-table tr:hover td { background: rgba(255,255,255,0.015); }
  .ep-method {
    display: inline-block; background: rgba(77,171,255,0.12); color: var(--blue);
    border: 1px solid rgba(77,171,255,0.2); border-radius: 4px;
    padding: 1px 7px; font-size: 10px; font-weight: 600; letter-spacing: 0.05em;
  }
  .ep-route  { color: #fff; font-size: 12px; font-weight: 600; }
  .ep-desc   { color: var(--muted); font-size: 11px; }
  .ep-price  {
    color: var(--green); font-size: 13px; font-weight: 700;
    background: rgba(0,232,122,0.06); border: 1px solid rgba(0,232,122,0.15);
    border-radius: 6px; padding: 3px 10px; display: inline-block;
  }
  .ep-url    { color: var(--muted); font-size: 10px; }

  /* ── Footer ── */
  footer {
    margin-top: 28px; text-align: center;
    font-size: 10px; color: var(--muted); letter-spacing: 0.06em;
  }

  /* ── Loading state ── */
  .loading { opacity: 0.4; }
  .error-banner {
    background: rgba(255,61,85,0.08); border: 1px solid rgba(255,61,85,0.25);
    border-radius: 8px; padding: 10px 16px; color: var(--red);
    font-size: 11px; margin-bottom: 16px; display: none;
  }
</style>
</head>
<body>

<header>
  <div class="logo">
    <div class="logo-icon">&#9889;</div>
    <div>
      <div class="logo-text">x402 Swarm</div>
      <div class="logo-sub">Solana Micropayment Revenue Engine</div>
    </div>
  </div>
  <div class="header-right">
    <div class="refresh-badge">
      <div class="pulse" id="pulse"></div>
      <span>Live &mdash; 5s refresh</span>
    </div>
    <div class="last-updated" id="lastUpdated">Connecting...</div>
  </div>
</header>

<div class="error-banner" id="errorBanner"></div>

<!-- Top stats -->
<div class="grid-3">
  <div class="card card-accent-green">
    <div class="stat-label">Total Earned (All Time)</div>
    <div class="stat-value green" id="totalEarned">—</div>
    <div class="stat-sub" id="earned24h">Last 24h: —</div>
  </div>
  <div class="card card-accent-blue">
    <div class="stat-label">Wallet Balance</div>
    <div class="stat-value blue" id="walletBalance">—</div>
    <div class="stat-sub" id="walletAddr">Loading wallet...</div>
  </div>
  <div class="card card-accent-purple">
    <div class="stat-label">Server Uptime</div>
    <div class="stat-value purple" id="uptime">—</div>
    <div class="stat-sub" id="networkBadge">—</div>
  </div>
</div>

<!-- Workers -->
<div class="section-label">Workers</div>
<div class="grid-6" id="workersGrid">
  <!-- populated by JS -->
</div>

<!-- Birdeye + Endpoints -->
<div class="grid-2">

  <!-- Birdeye -->
  <div class="card">
    <div class="stat-label" style="margin-bottom:16px;">Birdeye Rate Limiter</div>
    <div class="birdeye-grid">
      <div>
        <div class="be-val" id="beTokens">—</div>
        <div class="be-sub">Tokens available</div>
        <div style="margin-top:14px;">
          <div class="be-meter-label">
            <span>Token bucket</span>
            <span id="beTokensPct">—</span>
          </div>
          <div class="be-bar-bg">
            <div class="be-bar-fill" id="beTokensBar" style="width:0%"></div>
          </div>
        </div>
      </div>
      <div>
        <div class="be-val" id="beQueue">—</div>
        <div class="be-sub">Queued requests</div>
        <div style="margin-top:14px;">
          <div class="be-meter-label">
            <span>Queue depth</span>
            <span id="beQueuePct">—</span>
          </div>
          <div class="be-bar-bg">
            <div class="be-bar-fill" id="beQueueBar" style="width:0%"></div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Endpoints -->
  <div class="card">
    <div class="stat-label" style="margin-bottom:14px;">Endpoints &amp; Pricing</div>
    <table class="endpoints-table">
      <thead>
        <tr>
          <th>Route</th>
          <th>Service</th>
          <th>Price</th>
        </tr>
      </thead>
      <tbody id="endpointsBody">
      </tbody>
    </table>
  </div>

</div>

<footer>x402 Swarm &bull; Solana USDC Micropayments &bull; <span id="footerTs"></span></footer>

<script>
  const ENDPOINTS = [
    { method:'POST', route:'/dex',      label:'DEX Price Feed',     price:'$0.002' },
    { method:'POST', route:'/arb',      label:'Arb Scanner',        price:'$0.010' },
    { method:'POST', route:'/wallet',   label:'Wallet Intel',       price:'$0.005' },
    { method:'POST', route:'/launches', label:'Launch Detector',    price:'$0.003' },
    { method:'POST', route:'/summary',  label:'Summarizer',         price:'$0.008' },
    { method:'POST', route:'/rpc',      label:'RPC Balancer',       price:'$0.001' },
  ];

  const WORKER_META = {
    dexFeed:        { label:'DEX Feed',        route:'/dex',      icon:'&#128200;' },
    arbScanner:     { label:'Arb Scanner',     route:'/arb',      icon:'&#9889;' },
    walletIntel:    { label:'Wallet Intel',    route:'/wallet',   icon:'&#128274;' },
    launchDetector: { label:'Launch Detector', route:'/launches', icon:'&#128640;' },
    summarizer:     { label:'Summarizer',      route:'/summary',  icon:'&#129504;' },
    rpcBalancer:    { label:'RPC Balancer',    route:'/rpc',      icon:'&#9881;' },
  };

  const EARNINGS_BY_WORKER = {};

  // Build endpoints table once
  const tbody = document.getElementById('endpointsBody');
  ENDPOINTS.forEach(ep => {
    const tr = document.createElement('tr');
    tr.innerHTML = \`
      <td><span class=\"ep-method\">\${ep.method}</span> <span class=\"ep-route\">\${ep.route}</span></td>
      <td class=\"ep-desc\">\${ep.label}</td>
      <td><span class=\"ep-price\">\${ep.price}</span></td>
    \`;
    tbody.appendChild(tr);
  });

  // Build worker cards once
  const grid = document.getElementById('workersGrid');
  const TASK_NAMES = ['dexFeed','arbScanner','walletIntel','launchDetector','summarizer','rpcBalancer'];
  TASK_NAMES.forEach(name => {
    const meta = WORKER_META[name];
    const div = document.createElement('div');
    div.className = 'card';
    div.id = 'wcard-' + name;
    div.innerHTML = \`
      <div class=\"worker-header\">
        <div>
          <div class=\"worker-name\">\${meta.icon} \${meta.label}</div>
          <div class=\"worker-route\">POST \${meta.route}</div>
        </div>
        <div class=\"status-dot idle\" id=\"wdot-\${name}\"></div>
      </div>
      <div class=\"worker-stats\">
        <div class=\"ws-item\">
          <div class=\"ws-val\" id=\"wstatus-\${name}\">IDLE</div>
          <div class=\"ws-key\">Status</div>
        </div>
        <div class=\"ws-item\">
          <div class=\"ws-val\" id=\"wqueue-\${name}\">—</div>
          <div class=\"ws-key\">Queue</div>
        </div>
        <div class=\"ws-item\">
          <div class=\"ws-val\" id=\"wcrashes-\${name}\">—</div>
          <div class=\"ws-key\">Crashes</div>
        </div>
      </div>
      <div class=\"earned-pill\" id=\"wearned-\${name}\">$0.000000 earned</div>
    \`;
    grid.appendChild(div);
  });

  function fmtUsdc(n) {
    if (n === undefined || n === null) return '—';
    return '$' + Number(n).toFixed(6);
  }

  function fmtUptime(s) {
    if (!s && s !== 0) return '—';
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (d > 0) return \`\${d}d \${h}h \${m}m\`;
    if (h > 0) return \`\${h}h \${m}m \${sec}s\`;
    if (m > 0) return \`\${m}m \${sec}s\`;
    return \`\${sec}s\`;
  }

  function setEl(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  async function refresh() {
    const pulse = document.getElementById('pulse');
    pulse.style.background = '#ffaa00';
    try {
      const res = await fetch('/admin/stats' + window.location.search);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const d = await res.json();

      document.getElementById('errorBanner').style.display = 'none';

      // Top stats
      const te = d.earnings && d.earnings.totalEarned != null ? d.earnings.totalEarned : 0;
      setEl('totalEarned', fmtUsdc(te));
      const l24 = d.earnings && d.earnings.last24h != null ? d.earnings.last24h : 0;
      setEl('earned24h', 'Last 24h: ' + fmtUsdc(l24));
      setEl('walletBalance', fmtUsdc(d.balance_usdc));
      setEl('walletAddr', 'Mainnet USDC balance');
      setEl('uptime', fmtUptime(d.uptime_seconds));
      setEl('networkBadge', (window.location.hostname === 'localhost' ? 'localhost' : window.location.hostname) + ':' + window.location.port);

      // Build earnings lookup from earningsByWorker
      if (d.earnings && d.earnings.earningsByWorker) {
        d.earnings.earningsByWorker.forEach(r => {
          EARNINGS_BY_WORKER[r.worker] = r.total_earned || 0;
        });
      }

      // Workers
      if (d.workers) {
        d.workers.forEach(w => {
          const dot = document.getElementById('wdot-' + w.taskName);
          const statusEl = document.getElementById('wstatus-' + w.taskName);
          const crashes = w.crashes || 0;
          if (!dot) return;
          if (crashes > 5) {
            dot.className = 'status-dot error';
            if (statusEl) statusEl.textContent = 'WARN';
          } else if (w.busy) {
            dot.className = 'status-dot busy';
            if (statusEl) statusEl.textContent = 'BUSY';
          } else {
            dot.className = 'status-dot idle';
            if (statusEl) statusEl.textContent = 'IDLE';
          }
          setEl('wqueue-' + w.taskName, w.queueDepth != null ? w.queueDepth : 0);
          setEl('wcrashes-' + w.taskName, crashes);
          const earned = EARNINGS_BY_WORKER[w.taskName] || 0;
          setEl('wearned-' + w.taskName, fmtUsdc(earned) + ' earned');
        });
      }

      // Birdeye
      if (d.birdeye) {
        const maxTokens = 55;
        const maxQueue  = 20;
        const tokens = d.birdeye.tokens != null ? d.birdeye.tokens : 0;
        const queue  = d.birdeye.queueDepth != null ? d.birdeye.queueDepth : 0;
        setEl('beTokens', tokens);
        setEl('beQueue',  queue);
        const tPct = Math.round((tokens / maxTokens) * 100);
        const qPct = Math.round((queue  / maxQueue)  * 100);
        setEl('beTokensPct', tPct + '%');
        setEl('beQueuePct',  qPct + '%');
        const tBar = document.getElementById('beTokensBar');
        const qBar = document.getElementById('beQueueBar');
        if (tBar) { tBar.style.width = tPct + '%'; tBar.className = 'be-bar-fill' + (tPct < 20 ? ' warn' : ''); }
        if (qBar) { qBar.style.width = qPct + '%'; qBar.className = 'be-bar-fill' + (qPct > 60 ? ' warn' : ''); }
      }

      setEl('lastUpdated', 'Updated ' + new Date().toLocaleTimeString());
      setEl('footerTs', new Date().toLocaleString());
      pulse.style.background = 'var(--green)';

    } catch (e) {
      const banner = document.getElementById('errorBanner');
      banner.style.display = 'block';
      banner.textContent = 'Failed to fetch /stats: ' + e.message;
      setEl('lastUpdated', 'Error at ' + new Date().toLocaleTimeString());
      pulse.style.background = 'var(--red)';
    }
  }

  refresh();
  setInterval(refresh, 5000);
</script>
</body>
</html>`);
  });

  app.listen(PORT, () => {
    console.log(`[boot] x402 swarm live on port ${PORT}`);
    console.log(`[boot] Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`[boot] Stats:     http://localhost:${PORT}/stats`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('[shutdown] SIGTERM received — shutting down');
    pool.shutdown();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('[shutdown] SIGINT received — shutting down');
    pool.shutdown();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('[boot] Fatal error:', err);
  process.exit(1);
});
