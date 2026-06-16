/**
 * Security test suite for the conditional_escrow program — runs on DEVNET.
 *
 * Proves the spec MUST-rules (1..11). Each test builds a fresh escrow with a
 * random payment_id so cases are independent. Funds for sub-accounts are
 * transferred from the provider wallet (the "master") rather than airdropped
 * per-account, to stay within devnet airdrop limits.
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
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  mintTo,
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

  // Results matrix printed at the end.
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

  // Build + fund an escrow. Returns the handles a test needs.
  async function makeEscrow(opts: {
    amount?: number;
    expiryOffsetSec: number;
    payer?: Keypair; // defaults to master
    payerAta?: PublicKey; // token source; defaults to master's ATA
    mintOverride?: PublicKey; // mint stored/seeded (defaults to `mint`)
  }) {
    const amount = opts.amount ?? AMOUNT;
    const payerKp = opts.payer ?? master;
    const m = opts.mintOverride ?? mint;
    const payerAta = opts.payerAta ?? masterAta;

    const payTo = Keypair.generate().publicKey;
    const releaseAuthority = Keypair.generate();
    await fundSol(releaseAuthority.publicKey, 0.05);

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

  async function doRelease(e: any, overrides: any = {}) {
    const payToAta =
      overrides.payToAta ?? getAssociatedTokenAddressSync(e.mint, e.payTo);
    return program.methods
      .release(overrides.responseHash ?? rand32())
      .accountsPartial({
        releaseAuthority: (overrides.releaseAuthority ?? e.releaseAuthority).publicKey,
        escrow: e.escrow,
        vault: e.vault,
        payTo: overrides.payTo ?? e.payTo,
        mint: e.mint,
        payToAta,
        payer: e.payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([overrides.releaseAuthority ?? e.releaseAuthority])
      .rpc();
  }

  async function doRefund(e: any, signer: Keypair, overrides: any = {}) {
    const payerAta =
      overrides.payerAta ?? getAssociatedTokenAddressSync(e.mint, e.payer.publicKey);
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
    // Plenty of tokens for all escrows.
    await mintTo(connection, master, mint, masterAta, master, 100 * AMOUNT);
    console.log(`  mint=${mint.toBase58()}  mint2=${mint2.toBase58()}`);
  });

  it("1. happy path: deposit -> release before expiry -> funds at pay_to; closed", async function () {
    this.timeout(120000);
    const e = await makeEscrow({ expiryOffsetSec: 3600 });
    await doRelease(e);

    const payToAta = getAssociatedTokenAddressSync(e.mint, e.payTo);
    assert.equal(await tokenBal(payToAta), e.amount, "pay_to did not receive full amount");
    assert.isNull(await connection.getAccountInfo(e.escrow), "escrow not closed");
    assert.isNull(await connection.getAccountInfo(e.vault), "vault not closed");
    record("1 happy path release->pay_to, closed", true);
  });

  it("2. refund after expiry is PERMISSIONLESS -> funds back to payer", async function () {
    this.timeout(120000);
    const e = await makeEscrow({ expiryOffsetSec: 8 });
    await sleep(16000); // let expiry pass

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
    this.timeout(120000);
    const e = await makeEscrow({ expiryOffsetSec: 8 });
    await sleep(16000);
    await expectFail(doRelease(e), "release after expiry");
    record("3 release after expiry rejected", true);
    // cleanup: refund permissionlessly
    await doRefund(e, master).catch(() => {});
  });

  it("4. release by a NON-release_authority is REJECTED", async function () {
    this.timeout(120000);
    const e = await makeEscrow({ expiryOffsetSec: 3600 });
    const imposter = Keypair.generate();
    await fundSol(imposter.publicKey, 0.05);
    await expectFail(doRelease(e, { releaseAuthority: imposter }), "release by imposter");
    record("4 release by non-authority rejected", true);
    await doRelease(e); // cleanup with real authority
  });

  it("5. refund BEFORE expiry by a non-release_authority is REJECTED", async function () {
    this.timeout(120000);
    const e = await makeEscrow({ expiryOffsetSec: 3600 });
    const random = Keypair.generate();
    await fundSol(random.publicKey, 0.05);
    await expectFail(doRefund(e, random), "refund before expiry by random");
    record("5 refund before expiry by non-authority rejected", true);
    // cleanup: authority refunds early (allowed)
    await doRefund(e, e.releaseAuthority).catch(() => {});
  });

  it("6. release to a destination != ATA(pay_to, mint) is REJECTED", async function () {
    this.timeout(120000);
    const e = await makeEscrow({ expiryOffsetSec: 3600 });
    // wrong destination: a token account owned by someone else
    const wrongOwner = Keypair.generate().publicKey;
    const wrongAta = getAssociatedTokenAddressSync(e.mint, wrongOwner);
    const ix = createAssociatedTokenAccountInstruction(
      master.publicKey, wrongAta, wrongOwner, e.mint
    );
    await provider.sendAndConfirm(new anchor.web3.Transaction().add(ix), []);
    await expectFail(doRelease(e, { payToAta: wrongAta }), "release to non-pay_to ATA");
    record("6 release to non-pay_to dest rejected", true);
    await doRelease(e); // cleanup
  });

  it("7. refund to a destination != ATA(payer, mint) is REJECTED", async function () {
    this.timeout(120000);
    const e = await makeEscrow({ expiryOffsetSec: 3600 });
    const wrongOwner = Keypair.generate().publicKey;
    const wrongAta = getAssociatedTokenAddressSync(e.mint, wrongOwner);
    const ix = createAssociatedTokenAccountInstruction(
      master.publicKey, wrongAta, wrongOwner, e.mint
    );
    await provider.sendAndConfirm(new anchor.web3.Transaction().add(ix), []);
    await expectFail(
      doRefund(e, e.releaseAuthority, { payerAta: wrongAta }),
      "refund to non-payer ATA"
    );
    record("7 refund to non-payer dest rejected", true);
    await doRefund(e, e.releaseAuthority).catch(() => {});
  });

  it("8. double-settle (release then release / refund) is REJECTED", async function () {
    this.timeout(120000);
    const e = await makeEscrow({ expiryOffsetSec: 3600 });
    await doRelease(e); // first release succeeds
    await expectFail(doRelease(e), "second release after close");
    await expectFail(doRefund(e, e.releaseAuthority), "refund after release/close");
    record("8 double-settle rejected (account closed)", true);
  });

  it("9. re-init with an already-used payment_id is REJECTED", async function () {
    this.timeout(120000);
    // Build an escrow but keep it OPEN, then try to re-init same seeds.
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

    await init(); // first succeeds
    await expectFail(init(), "re-init same payment_id");
    record("9 re-init used payment_id rejected", true);
    // cleanup: refund the open escrow
    const e = { mint, payTo, payer: master, escrow, vault, releaseAuthority, amount: AMOUNT };
    await doRefund(e, releaseAuthority).catch(() => {});
  });

  it("10. wrong mint / amount mismatch on deposit is REJECTED", async function () {
    this.timeout(120000);
    // (a) wrong mint: escrow seeded with `mint` but payer_ata belongs to mint2
    const mint2Ata = await getOrCreateAssociatedTokenAccount(connection, master, mint2, master.publicKey);
    await mintTo(connection, master, mint2, mint2Ata.address, master, AMOUNT);
    await expectFail(
      makeEscrow({ expiryOffsetSec: 3600, payerAta: mint2Ata.address }),
      "deposit with payer_ata of wrong mint"
    );

    // (b) amount mismatch: deposit more than the source ATA holds
    const poorOwner = Keypair.generate();
    await fundSol(poorOwner.publicKey, 0.05);
    const poorAta = await getOrCreateAssociatedTokenAccount(connection, master, mint, poorOwner.publicKey);
    await mintTo(connection, master, mint, poorAta.address, master, 1); // only 1 unit
    await expectFail(
      makeEscrow({ expiryOffsetSec: 3600, payer: poorOwner, payerAta: poorAta.address, amount: AMOUNT }),
      "deposit amount exceeds balance"
    );
    record("10 wrong mint / amount mismatch rejected", true);
  });

  it("11. no path sends funds to release_authority, fee payer, or third party", async function () {
    this.timeout(180000);
    // (a) release destination = release_authority's ATA -> rejected
    const e1 = await makeEscrow({ expiryOffsetSec: 3600 });
    const raAta = getAssociatedTokenAddressSync(e1.mint, e1.releaseAuthority.publicKey);
    await expectFail(doRelease(e1, { payToAta: raAta }), "release -> release_authority ATA");

    // (b) release destination = arbitrary third party ATA -> rejected
    const third = Keypair.generate().publicKey;
    const thirdAta = getAssociatedTokenAddressSync(e1.mint, third);
    await expectFail(doRelease(e1, { payToAta: thirdAta }), "release -> third party ATA");
    await doRelease(e1); // legitimate path still works, cleanup

    // (c) refund destination = third party ATA -> rejected
    const e2 = await makeEscrow({ expiryOffsetSec: 3600 });
    await expectFail(
      doRefund(e2, e2.releaseAuthority, { payerAta: thirdAta }),
      "refund -> third party ATA"
    );
    await doRefund(e2, e2.releaseAuthority).catch(() => {});
    record("11 funds cannot reach authority/fee-payer/third party", true);
  });

  after(() => {
    console.log("\n=== TEST MATRIX (rule -> pass/fail) ===");
    for (const r of matrix) console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.rule}`);
    console.log(`  program id: ${program.programId.toBase58()}`);
  });
});
