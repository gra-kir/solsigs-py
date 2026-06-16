/**
 * Delivery-predicate evaluator — the off-chain decision function of the
 * `conditional` scheme's release authority.
 *
 * TRUST BOUNDARY: this module does NOT run on chain. The escrow program records
 * the `response_hash` this module produces and trusts whoever holds
 * `release_authority` to have evaluated the predicate honestly. Nothing here is
 * enforced by the program; the on-chain `predicate_hash` only *commits* the
 * escrow to a specific predicate descriptor for auditability.
 */
import * as crypto from "crypto";
import * as fs from "fs";
import Ajv from "ajv";

/** A predicate descriptor: "deliver iff the response validates against this schema". */
export type PredicateDescriptor = {
  type: "json-schema";
  /** Where the schema is fetched from (https:// or file://). */
  schemaUrl: string;
  /** Hex sha256 the fetched schema bytes MUST hash to (content-addressing). */
  schemaHash: string;
};

export type DeliveryStatus = "DELIVERED" | "FAILED";

export type DeliveryResult = {
  status: DeliveryStatus;
  reason: string;
  /** Hex sha256 of the raw response body — recorded on chain via release/refund. */
  responseHash: string;
};

/** Transport-agnostic view of an HTTP response, so the evaluator is testable. */
export type HttpResponse = { status: number; bodyBytes: Buffer };

export const sha256Hex = (data: Buffer | string): string =>
  crypto.createHash("sha256").update(data).digest("hex");

/** sha256 (raw 32 bytes) of the canonical predicate descriptor — the on-chain predicate_hash. */
export function predicateHash(p: PredicateDescriptor): Buffer {
  const canonical = JSON.stringify({ type: p.type, schemaUrl: p.schemaUrl, schemaHash: p.schemaHash });
  return crypto.createHash("sha256").update(canonical).digest();
}

export async function fetchSchemaBytes(schemaUrl: string): Promise<Buffer> {
  if (schemaUrl.startsWith("file://")) {
    return fs.readFileSync(new URL(schemaUrl));
  }
  const res = await fetch(schemaUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Perform an HTTP call and normalize it (timeouts/network errors -> status 0, empty body). */
export async function callEndpoint(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15000
): Promise<HttpResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    return { status: res.status, bodyBytes: Buffer.from(await res.arrayBuffer()) };
  } catch {
    return { status: 0, bodyBytes: Buffer.alloc(0) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Evaluate delivery. DELIVERED iff: schema fetch + hash-check pass, status is 2xx,
 * body is present, parses as JSON, and validates against the schema. FAILED otherwise.
 * `responseHash` is always computed (even on failure) so it can be recorded on refund.
 */
export async function evaluateDelivery(
  resp: HttpResponse,
  predicate: PredicateDescriptor
): Promise<DeliveryResult> {
  const responseHash = sha256Hex(resp.bodyBytes);
  const fail = (reason: string): DeliveryResult => ({ status: "FAILED", reason, responseHash });

  if (predicate.type !== "json-schema") return fail(`unsupported predicate type ${predicate.type}`);

  // 1. Schema integrity: fetch and verify content hash (reject on mismatch).
  let schemaBytes: Buffer;
  try {
    schemaBytes = await fetchSchemaBytes(predicate.schemaUrl);
  } catch (e: any) {
    return fail(`schema unreachable: ${e.message}`);
  }
  const gotHash = sha256Hex(schemaBytes);
  if (gotHash !== predicate.schemaHash.toLowerCase()) {
    return fail(`schema hash mismatch (got ${gotHash}, expected ${predicate.schemaHash})`);
  }

  // 2. Status must be 2xx.
  if (resp.status < 200 || resp.status >= 300) return fail(`non-2xx status ${resp.status}`);

  // 3. Body must be present, JSON, and schema-valid.
  if (resp.bodyBytes.length === 0) return fail("empty body");
  let body: unknown;
  try {
    body = JSON.parse(resp.bodyBytes.toString("utf8"));
  } catch {
    return fail("body is not valid JSON");
  }
  let schema: object;
  try {
    schema = JSON.parse(schemaBytes.toString("utf8"));
  } catch {
    return fail("schema is not valid JSON");
  }
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (!validate(body)) return fail(`schema validation failed: ${ajv.errorsText(validate.errors)}`);

  return { status: "DELIVERED", reason: "2xx and schema-valid", responseHash };
}
