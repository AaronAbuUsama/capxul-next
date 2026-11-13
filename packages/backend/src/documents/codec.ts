import { hashTypedData, keccak256, toBytes, type Hex } from "viem";

export type Amount = { token_address: string; decimals: number; amount_raw: string };
type Named = { party_id: string | null; safe: string };
export type Content =
  | { kind: "memo"; basis: "payment" | "movement"; reference: string; note: string; amount: Amount; source: string; destination: string }
  | { kind: "invoice"; invoice_number: string; payer: Named; payee: Named; amount: Amount; due_at: number | null; note: string; lines: { description: string; quantity: number; unit_amount_raw: string }[] }
  | { kind: "terms"; title: string; parties: (Named & { role: string })[]; lines: { label: string; value: string }[] }
  | { kind: "receipt"; media_type: string; bytes: Uint8Array; filename: string | null };
export type Participant = Named & { role: "payer" | "payee" | "holder" };
export type StoreInput = {
  owner_kind: "person" | "organization"; owner_id: string;
  subject: { kind: "payment" | "movement" | "request" | "agreement" | "expense-claim" | "employee-advance" | "grant" | "round" | "commitment" | "share-transfer"; id: string };
  chain_id: number; issued_at: number; participants: Participant[]; content: Content;
};
const invalid = (reason: string): never => { throw new Error(`INVALID_INPUT: ${reason}`); };
const text = (s: string, max: number, min = 0) => {
  if (typeof s !== "string" || s.length < min || s.length > max) invalid("document text");
  return s;
};
const uint = (s: string): bigint => {
  if (typeof s !== "string" || !/^(0|[1-9][0-9]*)$/.test(s)) invalid("document amount");
  const n = BigInt(s); if (n >= 2n ** 256n) invalid("document amount"); return n;
};
const time = (n: number) => { if (!Number.isSafeInteger(n) || n < 0) invalid("document time"); };
export const address = (s: string) => {
  if (typeof s !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(s)) invalid("document Safe");
  return s.toLowerCase();
};
const named = (n: Named) => ({ party_id: n.party_id === null ? null : text(n.party_id, 200, 1), safe: address(n.safe) });
const amount = (a: Amount) => {
  if (!Number.isInteger(a.decimals) || a.decimals < 0 || a.decimals > 255) invalid("document decimals");
  uint(a.amount_raw); return { token_address: address(a.token_address), decimals: a.decimals, amount_raw: a.amount_raw };
};
const list = <T>(xs: T[], max: number, min = 1) => {
  if (!Array.isArray(xs) || xs.length < min || xs.length > max) invalid("document list"); return xs;
};
/** Lexicographic keys, no whitespace, UTF-8; input property ordering cannot change a financial hash. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined || typeof value === "number" && !Number.isFinite(value)) invalid("document encoding");
  return encoded;
}

function facts(content: Exclude<Content, { kind: "receipt" }>) {
  switch (content.kind) {
    case "memo":
      if (!["payment", "movement"].includes(content.basis)) invalid("memo basis");
      return { kind: content.kind, basis: content.basis, reference: text(content.reference, 120), note: text(content.note, 280), amount: amount(content.amount), source: address(content.source), destination: address(content.destination) };
    case "invoice": {
      const a = amount(content.amount);
      const lines = list(content.lines, 100).map((l) => {
        if (!Number.isSafeInteger(l.quantity) || l.quantity < 1) invalid("invoice quantity");
        uint(l.unit_amount_raw); return { description: text(l.description, 280, 1), quantity: l.quantity, unit_amount_raw: l.unit_amount_raw };
      });
      if (lines.reduce((sum, l) => sum + BigInt(l.quantity) * uint(l.unit_amount_raw), 0n) !== uint(a.amount_raw)) invalid("invoice lines do not add up");
      if (content.due_at !== null) time(content.due_at);
      return { kind: content.kind, invoice_number: text(content.invoice_number, 120, 1), payer: named(content.payer), payee: named(content.payee), amount: a, due_at: content.due_at, note: text(content.note, 280), lines };
    }
    case "terms": return { kind: content.kind, title: text(content.title, 120, 1), parties: list(content.parties, 8).map((p) => ({ ...named(p), role: text(p.role, 120, 1) })), lines: list(content.lines, 40).map((l) => ({ label: text(l.label, 120, 1), value: text(l.value, 2000, 1) })) };
    default: return invalid("unsupported Core document kind");
  }
}

export function receiptBytes(content: Extract<Content, { kind: "receipt" }>): Buffer {
  const bytes = Buffer.from(content.bytes);
  if (!bytes.length || bytes.length > 128 * 1024) invalid("receipt size");
  switch (content.media_type) {
    case "application/json": try { JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { invalid("receipt JSON"); } break;
    case "application/pdf": if (!/^%PDF-[12]\./.test(bytes.toString("ascii", 0, 8))) invalid("receipt PDF"); break;
    case "image/png": if (!bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) invalid("receipt PNG"); break;
    case "image/jpeg": if (bytes[0] !== 255 || bytes[1] !== 216) invalid("receipt JPEG"); break;
    default: invalid("receipt type");
  }
  if (content.filename !== null) text(content.filename, 255, 1);
  return bytes;
}

const types = { Document: [
  { name: "originId", type: "bytes32" }, { name: "kind", type: "string" },
  { name: "issuedAt", type: "uint256" }, { name: "contentHash", type: "bytes32" },
] } as const;
export function documentHash(chain: number, origin: Hex, kind: string, issued: number, contentHash: Hex) {
  return hashTypedData({ domain: { name: "Capxul Document", version: "1", chainId: chain }, types, primaryType: "Document", message: { originId: origin, kind, issuedAt: BigInt(issued), contentHash } });
}

export function encode(input: StoreInput) {
  if (!["person", "organization"].includes(input.owner_kind)) invalid("document owner");
  text(input.owner_id, 200, 1); text(input.subject.id, 300, 1);
  if (!["payment", "movement", "request", "agreement", "expense-claim", "employee-advance", "grant", "round", "commitment", "share-transfer"].includes(input.subject.kind)) invalid("document subject");
  if (!Number.isSafeInteger(input.chain_id) || input.chain_id < 1) invalid("document chain");
  time(input.issued_at);
  const participants = list(input.participants, 8).map((p) => {
    if (!["payer", "payee", "holder"].includes(p.role)) invalid("document participant role");
    return { ...named(p), role: p.role };
  });
  const artifact = input.content.kind === "receipt";
  const content = artifact ? null : facts(input.content as Exclude<Content, { kind: "receipt" }>);
  const origin = keccak256(toBytes(`${input.subject.kind}:${input.subject.id}`));
  const payload = content === null ? null : { version: 1, originId: origin, kind: content.kind, issuedAt: input.issued_at, content };
  const bytes = artifact ? receiptBytes(input.content as Extract<Content, { kind: "receipt" }>) : Buffer.from(canonical(payload));
  const content_hash = keccak256(bytes);
  return {
    bytes, participants, participant_safes: participants.map((p) => p.safe), content_hash,
    document_hash: artifact ? content_hash : documentHash(input.chain_id, origin, input.content.kind, input.issued_at, keccak256(toBytes(canonical(content)))),
    kind: input.content.kind, format: artifact ? "artifact" : "envelope",
    media_type: artifact ? (input.content as Extract<Content, { kind: "receipt" }>).media_type : "application/json",
    issued_at: artifact ? null : input.issued_at,
    filename: artifact ? (input.content as Extract<Content, { kind: "receipt" }>).filename : null,
  };
}
