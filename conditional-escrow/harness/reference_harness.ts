/**
 * Reference harness for the `conditional` scheme — end-to-end on DEVNET.
 *
 * Demonstrates BOTH outcomes against the already-deployed escrow program, using
 * the live SolSigs API as the worked example:
 *   RELEASE path (good delivery): GET https://solsigs.com/openapi.json -> 200 +
 *     schema-valid -> evaluator DELIVERED -> release_authority calls release().
 *   REFUND path (bad delivery): POST https://solsigs.com/dex with no x402 payment
 *     -> typed 402 -> evaluator FAILED -> release_authority calls refund().
 *
 * Escrowed asset is a DEVNET test mint (never mainnet USDC). Each settlement tx
 * is verified by an external RPC getTransaction (err must be null).
 */
import * as anchor from "@coral-xyz/anchor";
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
  mintTo,
  getAccount,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import {
  PredicateDescriptor,
  callEndpoint,
  evaluateDelivery,
  fetchSchemaBytes,
  predicateHash,
  sha256Hex,
} from "./evaluator";

const RPC = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
const SOLSIGS = "https://solsigs.com";
const CONDITIONAL = Buffer.from("conditional");
const VAULT = Buffer.from("vault");
const DECIMALS = 6;
const AMOUNT = 1_000_000; // 1.0 test token

const hexToBytes = (h: string) => Array.from(Buffer.from(h, "hex"));

async function rpcGetTx(sig: string): Promise<{ slot: number; err: unknown } | null> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTransaction",
      params: [sig, { maxSupportedTransactionVersion: 0, encoding: "json" }],
    }),
  });
  const j: any = await res.json();
  if (!j.result) return null;
  return { slot: j.result.slot, err: j.result.meta?.err ?? null };
}

const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

async function confirmExternally(label: string, sig: string) {
  // poll a few times — the RPC node may lag a beat behind confirmation
  for (let i = 0; i < 10; i++) {
    const r = await rpcGetTx(sig);
    if (r) {
      const ok = r.err === null;
      console.log(`    [${ok ? "OK" : "ERR"}] ${label}: slot=${r.slot} err=${JSON.stringify(r.err)}`);
      console.log(`         ${explorer(sig)}`);
      if (!ok) throw new Error(`${label} tx has err=${JSON.stringify(r.err)}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`${label}: tx ${sig} did not resolve on external RPC`);
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const idl = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "target/idl/conditional_escrow.json"), "utf8")
  );
  const program = new anchor.Program(idl as anchor.Idl, provider);
  const connection = provider.connection;
  const master = (provider.wallet as anchor.Wallet).payer;

  console.log(`program: ${program.programId.toBase58()}`);
  console.log(`wallet:  ${master.publicKey.toBase58()}  balance: ${(await connection.getBalance(master.publicKey)) / LAMPORTS_PER_SOL} SOL\n`);

  // ---- devnet test mint + payer funds ----
  const mint = await createMint(connection, master, master.publicKey, null, DECIMALS);
  const masterAta = (await getOrCreateAssociatedTokenAccount(connection, master, mint, master.publicKey)).address;
  await mintTo(connection, master, mint, masterAta, master, 10 * AMOUNT);
  console.log(`devnet test mint: ${mint.toBase58()}\n`);

  // ---- predicate descriptor (content-addressed schema) ----
  const schemaPath = path.join(process.cwd(), "harness/schemas/solsigs-openapi.schema.json");
  const schemaUrl = `file://${schemaPath}`;
  const schemaHash = sha256Hex(await fetchSchemaBytes(schemaUrl));
  const predicate: PredicateDescriptor = { type: "json-schema", schemaUrl, schemaHash };
  const predHash = predicateHash(predicate);
  console.log(`predicate: json-schema  schemaHash=${schemaHash}`);
  console.log(`on-chain predicate_hash=${predHash.toString("hex")}\n`);

  const escrowPda = (payer: PublicKey, payTo: PublicKey, pid: number[]) =>
    PublicKey.findProgramAddressSync(
      [CONDITIONAL, payer.toBuffer(), payTo.toBuffer(), mint.toBuffer(), Buffer.from(pid)],
      program.programId
    )[0];
  const vaultPda = (escrow: PublicKey) =>
    PublicKey.findProgramAddressSync([VAULT, escrow.toBuffer()], program.programId)[0];

  async function deposit(payTo: PublicKey, releaseAuthority: PublicKey, expiryOffset: number) {
    const paymentId = Array.from(require("crypto").randomBytes(32)) as number[];
    const escrow = escrowPda(master.publicKey, payTo, paymentId);
    const vault = vaultPda(escrow);
    const expiry = Math.floor(Date.now() / 1000) + expiryOffset;
    const sig = await program.methods
      .initializeAndDeposit(
        paymentId,
        new anchor.BN(AMOUNT),
        new anchor.BN(expiry),
        payTo,
        hexToBytes(predHash.toString("hex")),
        releaseAuthority
      )
      .accountsPartial({
        payer: master.publicKey,
        mint,
        payerAta: masterAta,
        payTo,
        escrow,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();
    return { paymentId, escrow, vault, sig };
  }

  const bal = async (ata: PublicKey) => {
    try {
      return Number((await getAccount(connection, ata)).amount);
    } catch {
      return 0;
    }
  };

  // ===================== RELEASE PATH (good delivery) =====================
  console.log("=== RELEASE PATH: good delivery (GET /openapi.json) ===");
  {
    const payTo = Keypair.generate().publicKey;
    const payToAta = getAssociatedTokenAddressSync(mint, payTo);
    const dep = await deposit(payTo, master.publicKey, 3600);
    console.log(`  deposit tx: ${dep.sig}`);
    await confirmExternally("deposit", dep.sig);

    const resp = await callEndpoint(`${SOLSIGS}/openapi.json`, { method: "GET" });
    const verdict = await evaluateDelivery(resp, predicate);
    console.log(`  endpoint: GET ${SOLSIGS}/openapi.json  ->  HTTP ${resp.status}`);
    console.log(`  evaluator: ${verdict.status} (${verdict.reason})`);
    console.log(`  response_hash: ${verdict.responseHash}`);
    if (verdict.status !== "DELIVERED") throw new Error("expected DELIVERED on good delivery");

    const sig = await program.methods
      .release(hexToBytes(verdict.responseHash))
      .accountsPartial({
        releaseAuthority: master.publicKey,
        escrow: dep.escrow,
        vault: dep.vault,
        payTo,
        mint,
        payToAta,
        payer: master.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`  release tx: ${sig}`);
    await confirmExternally("release", sig);
    console.log(`  pay_to balance: ${await bal(payToAta)} (expected ${AMOUNT})`);
    console.log(`  escrow closed: ${(await connection.getAccountInfo(dep.escrow)) === null}\n`);
  }

  // ===================== REFUND PATH (bad delivery) =====================
  console.log("=== REFUND PATH: bad delivery (POST /dex, unpaid -> 402) ===");
  {
    const payTo = Keypair.generate().publicKey;
    const dep = await deposit(payTo, master.publicKey, 3600);
    console.log(`  deposit tx: ${dep.sig}`);
    await confirmExternally("deposit", dep.sig);

    const before = await bal(masterAta);
    const resp = await callEndpoint(`${SOLSIGS}/dex`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "SOL" }),
    });
    const verdict = await evaluateDelivery(resp, predicate);
    console.log(`  endpoint: POST ${SOLSIGS}/dex (no x402 payment)  ->  HTTP ${resp.status}`);
    console.log(`  evaluator: ${verdict.status} (${verdict.reason})`);
    console.log(`  response_hash: ${verdict.responseHash}`);
    if (verdict.status !== "FAILED") throw new Error("expected FAILED on bad delivery");

    const sig = await program.methods
      .refund(hexToBytes(verdict.responseHash))
      .accountsPartial({
        signer: master.publicKey,
        escrow: dep.escrow,
        vault: dep.vault,
        mint,
        payerAta: masterAta,
        payer: master.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`  refund tx: ${sig}`);
    await confirmExternally("refund", sig);
    console.log(`  payer refunded: ${(await bal(masterAta)) - before} (expected ${AMOUNT})`);
    console.log(`  escrow closed: ${(await connection.getAccountInfo(dep.escrow)) === null}\n`);
  }

  // ===================== evaluator self-checks (off-chain only) =====================
  console.log("=== evaluator self-checks (off-chain) ===");
  const good = await callEndpoint(`${SOLSIGS}/openapi.json`, { method: "GET" });
  const r1 = await evaluateDelivery(good, predicate);
  console.log(`  good response, correct predicate -> ${r1.status} (expect DELIVERED)`);
  const r2 = await evaluateDelivery(good, { ...predicate, schemaHash: "00".repeat(32) });
  console.log(`  good response, tampered schemaHash -> ${r2.status} (expect FAILED: ${r2.reason})`);
  const r3 = await evaluateDelivery({ status: 200, bodyBytes: Buffer.from('{"not":"openapi"}') }, predicate);
  console.log(`  2xx but schema-invalid body -> ${r3.status} (expect FAILED: ${r3.reason})`);
  const r4 = await evaluateDelivery({ status: 200, bodyBytes: Buffer.alloc(0) }, predicate);
  console.log(`  2xx but empty body -> ${r4.status} (expect FAILED: ${r4.reason})`);
  if (!(r1.status === "DELIVERED" && r2.status === "FAILED" && r3.status === "FAILED" && r4.status === "FAILED")) {
    throw new Error("evaluator self-checks failed");
  }

  console.log("\nALL PATHS CONFIRMED ON DEVNET.");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("HARNESS FAILED:", e);
    process.exit(1);
  }
);
