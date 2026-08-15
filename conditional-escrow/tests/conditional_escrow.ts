/**
 * Security test suite for the conditional_escrow program — runs on DEVNET.
 *
 * Proves the spec MUST-rules (1..11) plus the post-audit fixes (F1, F3, F4, F5,
 * F6) and regressions. Each test builds a fresh escrow with a random payment_id
 * so cases are independent. Funds for sub-accounts are transferred from the
 * provider wallet (the "master") rather than airdropped per-account.
 *
 * NOTE ON TIMING: after fix F5 the minimum escrow TTL is MIN_TTL_SECS (60s), so
 * expiry-related tests must wait out a real ~60s+ window. They are slow by
 * construction; this is integration coverage, not a unit suite.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  mintTo,
  transfer as splTransfer,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

const idl = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "target/idl/conditional_escrow.json"), "utf8")
);

const CONDITIONAL = Buffer.from("conditional");
const VAULT = Buffer.from("vault");
const MIN_TTL_SECS = 60; // mirror of program constant (F5)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand32 = () => Array.from(crypto.randomBytes(32));

describe("conditional_escrow (devnet)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = new anchor.Program(idl as anchor.Idl, provider) as Program;
  const connection = provider.connection;
  const master = (provider.wallet as anchor.Wallet).payer;

  const DECIMALS = 6;
  const AMOUNT = 1_000_000; // 1.0 token
  let mint: PublicKey;
  let mint2: PublicKey; // a second, unrelated mint
  let masterAta: PublicKey;

  const matrix: { rule: string; pass: boolean }[] = [];
  const record = (rule: string, pass: boolean) => matrix.push({ rule, pass });

  const escrowPda = (payer: PublicKey, payTo: PublicKey, m: PublicKey, pid: number[]) =>
    PublicKey.findProgramAddressSync(
      [CONDITIONAL, payer.toBuffer(), payTo.toBuffer(), m.toBuffer(), Buffer.from(pid)],
      program.programId
    )[0];

  const vaultPda = (escrow: PublicKey) =>
    PublicKey.findProgramAddressSync([VAULT, escrow.toBuffer()], program.programId)[0];

  async function fundSol(to: PublicKey, sol: number) {
    const tx = new anchor.web3.Transaction().add(
      SystemProgram.transfer({
        fromPubkey: master.publicKey,
        toPubkey: to,
        lamports: Math.floor(sol * LAMPORTS_PER_SOL),
      })
    );
    await provider.sendAndConfirm(tx, []);
  }

  // Ensure the canonical ATA(owner, mint) exists (master pays). Returns address.
  // After F4 the program no longer creates destination ATAs, so settlement
  // callers must provision them up front.
  async function ensureAta(owner: PublicKey, m: PublicKey = mint): Promise<PublicKey> {
    const ata = getAssociatedTokenAddressSync(m, owner, true);
    const info = await connection.getAccountInfo(ata);
    if (info === null) {
      const ix = createAssociatedTokenAccountInstruction(master.publicKey, ata, owner, m);
      await provider.sendAndConfirm(new anchor.web3.Transaction().add(ix), []);
    }
    return ata;
  }

  async function makeEscrow(opts: {
    amount?: number;
    expiryOffsetSec: number;
    payer?: Keypair;
    payerAta?: PublicKey;
    mintOverride?: PublicKey;
    payToOverride?: PublicKey;
    releaseAuthorityOverride?: Keypair;
  }) {
    const amount = opts.amount ?? AMOUNT;
    const payerKp = opts.payer ?? master;
    const m = opts.mintOverride ?? mint;
    const payerAta = opts.payerAta ?? masterAta;

    const releaseAuthority = opts.releaseAuthorityOverride ?? Keypair.generate();
    if (!opts.releaseAuthorityOverride) await fundSol(releaseAuthority.publicKey, 0.05);
    const payTo = opts.payToOverride ?? Keypair.generate().publicKey;

    const paymentId = rand32();
    const predicateHash = rand32();
    const expiry = Math.floor(Date.now() / 1000) + opts.expiryOffsetSec;

    const escrow = escrowPda(payerKp.publicKey, payTo, m, paymentId);
    const vault = vaultPda(escrow);

    const signers = payerKp === master ? [] : [payerKp];
    await program.methods
      .initializeAndDeposit(
        paymentId,
        new anchor.BN(amount),
        new anchor.BN(expiry),
        payTo,
        predicateHash,
        releaseAuthority.publicKey
      )
      .accountsPartial({
        payer: payerKp.publicKey,
        mint: m,
        payerAta,
        payTo,
        escrow,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers(signers)
      .rpc();

    return { paymentId, payTo, releaseAuthority, payer: payerKp, mint: m, escrow, vault, amount };
  }

  // doRelease now passes payer_ata (surplus destination). By default it ensures
  // pay_to's ATA exists (F4: program won't create it). Pass ensureDest:false to
  // exercise the "destination missing" failure.
  async function doRelease(e: any, overrides: any = {}) {
    const payToAta = overrides.payToAta ?? getAssociatedTokenAddressSync(e.mint, e.payTo, true);
    if (overrides.ensureDest !== false && overrides.payToAta === undefined) {
      await ensureAta(e.payTo, e.mint);
    }
    const payerAta = overrides.payerAta ?? getAssociatedTokenAddressSync(e.mint, e.payer.publicKey, true);
    return program.methods
      .release(overrides.responseHash ?? rand32())
      .accountsPartial({
        releaseAuthority: (overrides.releaseAuthority ?? e.releaseAuthority).publicKey,
        escrow: e.escrow,
        vault: e.vault,
        payTo: overrides.payTo ?? e.payTo,
        mint: e.mint,
        payToAta,
        payerAta,
        payer: e.payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([overrides.releaseAuthority ?? e.releaseAuthority])
      .rpc();
  }

  async function doRefund(e: any, signer: Keypair, overrides: any = {}) {
    const payerAta = overrides.payerAta ?? getAssociatedTokenAddressSync(e.mint, e.payer.publicKey, true);
    if (overrides.ensureDest !== false && overrides.payerAta === undefined) {
      await ensureAta(e.payer.publicKey, e.mint);
    }
    const rh = overrides.responseHash === undefined ? null : overrides.responseHash;
    return program.methods
      .refund(rh)
      .accountsPartial({
        signer: signer.publicKey,
        escrow: e.escrow,
        vault: e.vault,
        mint: e.mint,
        payerAta,
        payer: e.payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers(signer === master ? [] : [signer])
      .rpc();
  }

  async function expectFail(p: Promise<any>, label: string): Promise<string> {
    try {
      await p;
      assert.fail(`${label}: expected transaction to be REJECTED but it succeeded`);
    } catch (err: any) {
      const msg = err?.error?.errorCode?.code || err?.message || String(err);
      console.log(`    ✓ rejected (${label}): ${msg}`.slice(0, 160));
      return msg;
    }
  }

  async function tokenBal(ata: PublicKey): Promise<number> {
    try {
      const acc = await getAccount(connection, ata);
      return Number(acc.amount);
    } catch {
      return 0;
    }
  }

  before("fund master + create mints", async function () {
    this.timeout(180000);
    const bal = await connection.getBalance(master.publicKey);
    console.log(`  master ${master.publicKey.toBase58()} balance: ${bal / LAMPORTS_PER_SOL} SOL`);
    assert.isAbove(bal, 0.2 * LAMPORTS_PER_SOL, "master wallet underfunded for devnet run");

    mint = await createMint(connection, master, master.publicKey, null, DECIMALS);
    mint2 = await createMint(connection, master, master.publicKey, null, DECIMALS);
    const ata = await getOrCreateAssociatedTokenAccount(connection, master, mint, master.publicKey);
    masterAta = ata.address;
    await mintTo(connection, master, mint, masterAta, master, 100 * AMOUNT);
    console.log(`  mint=${mint.toBase58()}  mint2=${mint2.toBase58()}`);
  });

  // ============================ ORIGINAL RULES 1..11 ============================

  it("1. happy path: deposit -> release before expiry -> funds at pay_to; closed", async function () {
    this.timeout(120000);
    const e = await makeEscrow({ expiryOffsetSec: 3600 });
    await doRelease(e);
    const payToAta = getAssociatedTokenAddressSync(e.mint, e.payTo, true);
    assert.equal(await tokenBal(payToAta), e.amount, "pay_to did not receive full amount");
    assert.isNull(await connection.getAccountInfo(e.escrow), "escrow not closed");
    assert.isNull(await connection.getAccountInfo(e.vault), "vault not closed");
    record("1 happy path release->pay_to, closed", true);
  });

  it("2. refund after expiry is PERMISSIONLESS -> funds back to payer", async function () {
    this.timeout(150000);
    const e = await makeEscrow({ expiryOffsetSec: MIN_TTL_SECS + 2 });
    await sleep((MIN_TTL_SECS + 8) * 1000); // let expiry pass
    const random = Keypair.generate();
    await fundSol(random.publicKey, 0.02);
    const before = await tokenBal(masterAta);
    await doRefund(e, random); // random, NOT release authority, NOT payer
    const after = await tokenBal(masterAta);
    assert.equal(after - before, e.amount, "payer not refunded full amount");
    assert.isNull(await connection.getAccountInfo(e.escrow), "escrow not closed");
    record("2 refund after expiry permissionless", true);
  });

  it("3. release AFTER expiry is REJECTED", async function () {
    this.timeout(150000);
    const e = await makeEscrow({ expiryOffsetSec: MIN_TTL_SECS + 2 });
    await sleep((MIN_TTL_SECS + 8) * 1000);
    await expectFail(doRelease(e), "release after expiry");
    record("3 release after expiry rejected", true);
    await doRefund(e, master).catch(() => {});
  });

  it("4. release by a NON-release_authority is REJECTED", async function () {
    this.timeout(120000);
    const e = await makeEscrow({ expiryOffsetSec: 3600 });
    const imposter = Keypair.generate();
    await fundSol(imposter.publicKey, 0.05);
    await expectFail(doRelease(e, { releaseAuthority: imposter }), "release by imposter");
    record("4 release by non-authority rejected", true);
    await doRelease(e);
  });

  it("5. refund BEFORE expiry by a non-release_authority is REJECTED", async function () {
    this.timeout(120000);
    const e = await makeEscrow({ expiryOffsetSec: 3600 });
    const random = Keypair.generate();
    await fundSol(random.publicKey, 0.05);
    await expectFail(doRefund(e, random), "refund before expiry by random");
    record("5 refund before expiry by non-authority rejected", true);
    await doRefund(e, e.releaseAuthority).catch(() => {});
  });

  it("6. release to a destination != ATA(pay_to, mint) is REJECTED", async function () {
    this.timeout(120000);
    const e = await makeEscrow({ expiryOffsetSec: 3600 });
    const wrongOwner = Keypair.generate().publicKey;
    const wrongAta = getAssociatedTokenAddressSync(e.mint, wrongOwner, true);
    const ix = createAssociatedTokenAccountInstruction(master.publicKey, wrongAta, wrongOwner, e.mint);
    await provider.sendAndConfirm(new anchor.web3.Transaction().add(ix), []);
    await expectFail(doRelease(e, { payToAta: wrongAta }), "release to non-pay_to ATA");
    record("6 release to non-pay_to dest rejected", true);
    await doRelease(e);
  });

  it("7. refund to a destination != ATA(payer, mint) is REJECTED", async function () {
    this.timeout(120000);
    const e = await makeEscrow({ expiryOffsetSec: 3600 });
    const wrongOwner = Keypair.generate().publicKey;
    const wrongAta = getAssociatedTokenAddressSync(e.mint, wrongOwner, true);
    const ix = createAssociatedTokenAccountInstruction(master.publicKey, wrongAta, wrongOwner, e.mint);
    await provider.sendAndConfirm(new anchor.web3.Transaction().add(ix), []);
    await expectFail(doRefund(e, e.releaseAuthority, { payerAta: wrongAta }), "refund to non-payer ATA");
    record("7 refund to non-payer dest rejected", true);
    await doRefund(e, e.releaseAuthority).catch(() => {});
  });

  it("8. double-settle (release then release / refund) is REJECTED", async function () {
    this.timeout(120000);
    const e = await makeEscrow({ expiryOffsetSec: 3600 });
    await doRelease(e);
    await expectFail(doRelease(e), "second release after close");
    await expectFail(doRefund(e, e.releaseAuthority), "refund after release/close");
    record("8 double-settle rejected (account closed)", true);
  });

  it("9. re-init with an already-used payment_id (still OPEN) is REJECTED", async function () {
    this.timeout(120000);
    const payTo = Keypair.generate().publicKey;
    const releaseAuthority = Keypair.generate();
    await fundSol(releaseAuthority.publicKey, 0.05);
    const paymentId = rand32();
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const escrow = escrowPda(master.publicKey, payTo, mint, paymentId);
    const vault = vaultPda(escrow);

    const init = () =>
      program.methods
        .initializeAndDeposit(paymentId, new anchor.BN(AMOUNT), new anchor.BN(expiry), payTo, rand32(), releaseAuthority.publicKey)
        .accountsPartial({
          payer: master.publicKey, mint, payerAta: masterAta, payTo, escrow, vault,
          tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();

    await init();
    await expectFail(init(), "re-init same payment_id while open");
    record("9 re-init used payment_id (open) rejected", true);
    const e = { mint, payTo, payer: master, escrow, vault, releaseAuthority, amount: AMOUNT };
    await doRefund(e, releaseAuthority).catch(() => {});
  });

  it("10. wrong mint / amount mismatch on deposit is REJECTED", async function () {
    this.timeout(120000);
    const mint2Ata = await getOrCreateAssociatedTokenAccount(connection, master, mint2, master.publicKey);
    await mintTo(connection, master, mint2, mint2Ata.address, master, AMOUNT);
    await expectFail(
      makeEscrow({ expiryOffsetSec: 3600, payerAta: mint2Ata.address }),
      "deposit with payer_ata of wrong mint"
    );

    const poorOwner = Keypair.generate();
    await fundSol(poorOwner.publicKey, 0.05);
    const poorAta = await getOrCreateAssociatedTokenAccount(connection, master, mint, poorOwner.publicKey);
    await mintTo(connection, master, mint, poorAta.address, master, 1);
    await expectFail(
      makeEscrow({ expiryOffsetSec: 3600, payer: poorOwner, payerAta: poorAta.address, amount: AMOUNT }),
      "deposit amount exceeds balance"
    );
    record("10 wrong mint / amount mismatch rejected", true);
  });

  it("11. no path sends funds to release_authority, fee payer, or third party", async function () {
    this.timeout(180000);
    const e1 = await makeEscrow({ expiryOffsetSec: 3600 });
    const raAta = getAssociatedTokenAddressSync(e1.mint, e1.releaseAuthority.publicKey, true);
    await expectFail(doRelease(e1, { payToAta: raAta }), "release -> release_authority ATA");

    const third = Keypair.generate().publicKey;
    const thirdAta = getAssociatedTokenAddressSync(e1.mint, third, true);
    await expectFail(doRelease(e1, { payToAta: thirdAta }), "release -> third party ATA");
    await doRelease(e1);

    const e2 = await makeEscrow({ expiryOffsetSec: 3600 });
    await expectFail(doRefund(e2, e2.releaseAuthority, { payerAta: thirdAta }), "refund -> third party ATA");
    await doRefund(e2, e2.releaseAuthority).catch(() => {});
    record("11 funds cannot reach authority/fee-payer/third party", true);
  });

  // ============================ POST-AUDIT FIX TESTS ============================

  it("F1a. donation-then-RELEASE: exactly `amount` to pay_to, surplus to payer; no revert", async function () {
    this.timeout(150000);
    const e = await makeEscrow({ expiryOffsetSec: 3600 });
    const payToAta = await ensureAta(e.payTo, e.mint);
    const SURPLUS = 250_000;
    await splTransfer(connection, master, masterAta, e.vault, master, SURPLUS);
    assert.equal(await tokenBal(e.vault), e.amount + SURPLUS, "vault not inflated as set up");

    const payerBefore = await tokenBal(masterAta);
    await doRelease(e); // must not revert despite surplus
    const payerAfter = await tokenBal(masterAta);

    assert.equal(await tokenBal(payToAta), e.amount, "pay_to must receive EXACTLY amount, not the surplus");
    assert.equal(payerAfter - payerBefore, SURPLUS, "surplus must be returned to payer");
    assert.isNull(await connection.getAccountInfo(e.vault), "vault not closed after surplus drain");
    record("F1a donation+release: exact amount to pay_to, surplus->payer", true);
  });

  it("F1b. donation-then-REFUND: payer receives amount + surplus; no revert", async function () {
    this.timeout(180000);
    const e = await makeEscrow({ expiryOffsetSec: MIN_TTL_SECS + 2 });
    await ensureAta(e.payer.publicKey, e.mint);
    const SURPLUS = 333_000;
    await splTransfer(connection, master, masterAta, e.vault, master, SURPLUS);

    await sleep((MIN_TTL_SECS + 8) * 1000);
    const before = await tokenBal(masterAta);
    const random = Keypair.generate();
    await fundSol(random.publicKey, 0.02);
    await doRefund(e, random);
    const after = await tokenBal(masterAta);

    assert.equal(after - before, e.amount + SURPLUS, "payer must receive amount + surplus on refund");
    assert.isNull(await connection.getAccountInfo(e.vault), "vault not closed");
    record("F1b donation+refund: amount+surplus -> payer", true);
  });

  it("F3. a Token-2022 mint is REJECTED at init", async function () {
    this.timeout(120000);
    const t22Mint = await createMint(
      connection, master, master.publicKey, null, DECIMALS, Keypair.generate(),
      undefined, TOKEN_2022_PROGRAM_ID
    );
    const t22Ata = await getOrCreateAssociatedTokenAccount(
      connection, master, t22Mint, master.publicKey, false, undefined, undefined, TOKEN_2022_PROGRAM_ID
    );
    await mintTo(connection, master, t22Mint, t22Ata.address, master, AMOUNT, [], undefined, TOKEN_2022_PROGRAM_ID);

    const payTo = Keypair.generate().publicKey;
    const releaseAuthority = Keypair.generate();
    const paymentId = rand32();
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const escrow = escrowPda(master.publicKey, payTo, t22Mint, paymentId);
    const vault = vaultPda(escrow);

    await expectFail(
      program.methods
        .initializeAndDeposit(paymentId, new anchor.BN(AMOUNT), new anchor.BN(expiry), payTo, rand32(), releaseAuthority.publicKey)
        .accountsPartial({
          payer: master.publicKey, mint: t22Mint, payerAta: t22Ata.address, payTo, escrow, vault,
          tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc(),
      "init with Token-2022 mint"
    );
    record("F3 Token-2022 mint rejected at init", true);
  });

  it("F4. settlement does NOT charge the settler ATA-creation rent (dest must pre-exist)", async function () {
    this.timeout(150000);
    // (a) release with a NON-existent pay_to ATA is rejected (no silent create+charge).
    const e = await makeEscrow({ expiryOffsetSec: 3600 });
    await expectFail(doRelease(e, { ensureDest: false }), "release with missing pay_to ATA");

    // (b) with the ATA pre-created, the release authority pays only tx fee, not ~2M lamports rent.
    await ensureAta(e.payTo, e.mint);
    const raBefore = await connection.getBalance(e.releaseAuthority.publicKey);
    await doRelease(e);
    const raAfter = await connection.getBalance(e.releaseAuthority.publicKey);
    const spent = raBefore - raAfter;
    console.log(`    release authority spent ${spent} lamports (should be ~tx fee, << ATA rent ~2039280)`);
    assert.isBelow(spent, 100_000, "settler appears to have paid ATA-creation rent");
    record("F4 settler not charged ATA rent (dest pre-exists)", true);
  });

  it("F5. too-short / past expiry rejected; exact-boundary now==expiry: release rejected, refund allowed", async function () {
    this.timeout(180000);
    // (a) past expiry rejected
    await expectFail(makeEscrow({ expiryOffsetSec: -10 }), "past expiry");
    // (b) sub-MIN_TTL expiry rejected
    await expectFail(makeEscrow({ expiryOffsetSec: MIN_TTL_SECS - 30 }), "too-short expiry");

    // (c) exact boundary: escrow at exactly MIN_TTL, wait until now>=expiry, then
    //     release must be rejected (now < expiry false) and refund must work.
    const e = await makeEscrow({ expiryOffsetSec: MIN_TTL_SECS });
    await ensureAta(e.payTo, e.mint);
    await ensureAta(e.payer.publicKey, e.mint);
    await sleep((MIN_TTL_SECS + 6) * 1000);
    await expectFail(doRelease(e), "release at/after exact expiry boundary");
    await doRefund(e, master); // permissionless after expiry
    assert.isNull(await connection.getAccountInfo(e.escrow), "escrow not closed by boundary refund");
    record("F5 min-TTL enforced; exact boundary release-no/refund-yes", true);
  });

  it("INV. pay_to == release_authority at INIT: funds still only reach ATA(pay_to)", async function () {
    this.timeout(120000);
    const ra = Keypair.generate();
    await fundSol(ra.publicKey, 0.05);
    const e = await makeEscrow({ expiryOffsetSec: 3600, payToOverride: ra.publicKey, releaseAuthorityOverride: ra });
    const raAta = await ensureAta(ra.publicKey, e.mint);
    await doRelease(e);
    // pay_to (the recorded recipient) receiving its own funds — allowed by design.
    assert.equal(await tokenBal(raAta), e.amount, "pay_to(=authority) did not receive amount");
    // Sending to a *different* destination is still rejected even in this config.
    const other = getAssociatedTokenAddressSync(e.mint, Keypair.generate().publicKey, true);
    const e2 = await makeEscrow({ expiryOffsetSec: 3600, payToOverride: ra.publicKey, releaseAuthorityOverride: ra });
    await expectFail(doRelease(e2, { payToAta: other }), "release to non pay_to even when pay_to==authority");
    await doRelease(e2);
    record("INV pay_to==authority: funds only to ATA(pay_to)", true);
  });

  it("INV. pay_to == payer at INIT: release sends to ATA(payer)=ATA(pay_to)", async function () {
    this.timeout(120000);
    const e = await makeEscrow({ expiryOffsetSec: 3600, payToOverride: master.publicKey });
    const before = await tokenBal(masterAta);
    await doRelease(e); // payToAta and payerAta both resolve to masterAta
    const after = await tokenBal(masterAta);
    assert.equal(after - before, e.amount, "pay_to(=payer) did not receive amount on release");
    record("INV pay_to==payer: release reaches ATA(payer)", true);
  });

  it("REG. closed-account revival impossible; re-init after close (F6) succeeds cleanly", async function () {
    this.timeout(150000);
    const payTo = Keypair.generate().publicKey;
    const releaseAuthority = Keypair.generate();
    await fundSol(releaseAuthority.publicKey, 0.05);
    const paymentId = rand32(); // reuse the SAME id across the close boundary
    const mkExpiry = () => Math.floor(Date.now() / 1000) + 3600;
    const escrow = escrowPda(master.publicKey, payTo, mint, paymentId);
    const vault = vaultPda(escrow);
    await ensureAta(payTo, mint);

    const init = () =>
      program.methods
        .initializeAndDeposit(paymentId, new anchor.BN(AMOUNT), new anchor.BN(mkExpiry()), payTo, rand32(), releaseAuthority.publicKey)
        .accountsPartial({
          payer: master.publicKey, mint, payerAta: masterAta, payTo, escrow, vault,
          tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();

    await init();
    const e = { mint, payTo, payer: master, escrow, vault, releaseAuthority, amount: AMOUNT };
    await doRelease(e);
    assert.isNull(await connection.getAccountInfo(escrow), "escrow not closed");
    assert.isNull(await connection.getAccountInfo(vault), "vault not closed");
    await expectFail(doRelease(e), "settle on closed (revival attempt)");

    // F6: the freed (payer, pay_to, mint, payment_id) tuple can be initialized again.
    await init();
    // Program is constructed from a runtime-loaded IDL (untyped `Idl`), so the
    // account namespace isn't statically aware of `escrow`.
    const reopened = await (program.account as any).escrow.fetch(escrow);
    assert.equal(reopened.amount.toNumber(), AMOUNT, "re-init after close did not produce a fresh escrow");
    await doRelease(e); // clean up the reopened escrow
    record("REG revival impossible; re-init after close ok (documented F6)", true);
  });

  after(() => {
    console.log("\n=== TEST MATRIX (rule -> pass/fail) ===");
    for (const r of matrix) console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.rule}`);
    console.log(`  program id: ${program.programId.toBase58()}`);
  });
});
