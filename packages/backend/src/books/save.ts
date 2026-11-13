import { Effect } from "effect";
import { authenticate, requireFeature } from "../access/door.ts";
import { worldNow } from "../devnet/door.ts";
import { requireSeat } from "../organizations/door.ts";
import type { Database, Sql } from "../platform/db.ts";
import type { FrappeSite } from "../plugs/door.ts";
import { writeAnnotation, type Owner } from "./annotations.ts";
import { selectOrganization, withFeeds } from "./facts.ts";
import { accountLabel, invalid, organizationFields, parseInput, personalFields, type SaveInput } from "./validation.ts";

// This is trusted deployment policy, not a feature key supplied by the request.
const catalogue = { books: { target: "organization", money: true } } as const;

async function authorize(sql: Sql, bearer: string, input: SaveInput) {
  const at = await worldNow(sql);
  const principal = await authenticate(sql, bearer, at);
  if (input.actor.kind === "person") {
    if (principal.kind !== "person") throw new Error("ROLE_PERMISSION_DENIED: a person's own rows only");
    return { principal, owner: { kind: "person", id: principal.personId } as Owner, at, site: null };
  }
  const org = input.actor.orgId;
  await requireSeat(sql, org, { principalId: principal.personId,
    kind: principal.kind === "person" ? "human" : "agent", safe: principal.safeAddress });
  await selectOrganization(sql, org);
  await requireFeature(sql, "books", { personId: principal.personId, orgId: org }, catalogue, at);
  if (input.newAccount || !input.account) {
    // Organizations has not published the finalized fixed-officer source yet. Editable
    // app.hats or an arbitrary indexed wearer cannot supply this missing authority.
    throw new Error("FEATURE_NOT_AVAILABLE: fixed Books-hat authority is unavailable");
  }
  const money = await sql.query(`select fact_id from app.book_facts where org_id=$1
    and reference_kind=$2 and reference_id=$3 and money_key is not null and kind<>'reversed' limit 1`,
  [org, input.reference.kind, input.reference.id]);
  if (!money.rowCount) invalid("reference is not a participant in this Organization's books");
  const organization = (await sql.query("select site from app.organizations where org_id=$1", [org])).rows[0];
  if (!principal.email) throw new Error("FEATURE_NOT_AVAILABLE: native site delegation is unavailable");
  if (!organization?.site) throw new Error("PROVIDER_ERROR: verified site identity unavailable");
  return { principal, owner: { kind: "organization", id: org } as Owner, at, site: String(organization.site) };
}

/** Native validation holds no money/feed locks. Recheck all authority before the atomic Core save. */
export const saveAnnotation = Effect.fn("rpc.books.annotations.save")(function*(db: Database, provider: FrappeSite["Service"],
  bearer: string, value: unknown, context: { traceId: string; callId: string }) {
  if (!bearer) return yield* Effect.fail(new Error("NOT_AUTHENTICATED: bearer session required"));
  const input = yield* Effect.try({ try: () => parseInput(value), catch: (error) => error as Error });
  const first = yield* Effect.tryPromise({ try: () => db.transaction("", (sql) => authorize(sql, bearer, input)), catch: (e) => e as Error });
  yield* Effect.annotateCurrentSpan({ ownerKind: first.owner.kind, ownerId: first.owner.id,
    referenceKind: input.reference.kind, referenceId: input.reference.id });
  const validated = first.owner.kind === "person"
    ? { fields: yield* Effect.try({ try: () => personalFields(input), catch: (e) => e as Error }), accountName: null }
    : yield* organizationFields(input, provider, { orgId: first.owner.id, site: first.site!,
      user: first.principal.email!, traceId: context.traceId }, context.callId).pipe(
      Effect.mapError((error) => "code" in error
        ? new Error(`${error.code === "WRONG_STATE" ? "PROVIDER_RESPONSE_INVALID" : error.code}: ${error.message}`) : error),
    );
  const saved = yield* Effect.tryPromise({ try: () => db.transaction("", async (sql) => {
    const current = await authorize(sql, bearer, input);
    if (current.principal.personId !== first.principal.personId || current.site !== first.site ||
        current.principal.email !== first.principal.email || current.principal.safeAddress !== first.principal.safeAddress)
      throw new Error("NOT_AUTHENTICATED: session identity changed during validation");
    const write = () => writeAnnotation(sql, current.owner, input.reference, validated.fields, {
      at: current.at, traceId: context.traceId, actor: { kind: current.principal.kind, id: current.principal.personId },
    });
    return current.owner.kind === "organization" ? withFeeds(sql, [current.owner.id], current.at, write) : write();
  }), catch: (e) => e as Error });
  return { annotation: {
    reference: input.reference, actor: first.owner,
    account: first.owner.kind === "person" ? accountLabel(saved.account, saved.account_number)
      : saved.account ? { account: saved.account, number: saved.account_number, name: validated.accountName } : null,
    party: saved.party_id ? { type: saved.party_type, id: saved.party_id } : null,
    costCenter: saved.cost_center, project: saved.project, references: saved.references,
    suggestion: saved.suggestion, memo: saved.memo,
    lastEditor: { kind: saved.last_editor_kind, id: saved.last_editor_id }, updatedAt: saved.updated_at,
  } };
}, Effect.mapError((error) => {
  const candidate = "code" in error ? String(error.code) : error.message.split(":")[0]!;
  const code = refused.has(candidate) ? candidate : "PROVIDER_ERROR";
  return Object.assign(error, { code });
}));

const refused = new Set(["NOT_AUTHENTICATED", "INVALID_INPUT", "ROLE_PERMISSION_DENIED", "FEATURE_NOT_AVAILABLE",
  "PROVIDER_ERROR", "PROVIDER_RESPONSE_INVALID"]);

/** Composition mounts this before the private HMAC router. It never accepts an actor credential in JSON. */
export function annotationHandler(db: Database, provider: FrappeSite["Service"],
  run: <A, E>(effect: (context: { traceId: string; callId: string }) => Effect.Effect<A, E>,
    req: import("node:http").IncomingMessage) => Promise<A>) {
  return async (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
    if (req.url?.split("?")[0] !== "/books/annotations/save") return false;
    let status = 200, result: unknown;
    try {
      if (req.method !== "POST") throw new Error("INVALID_INPUT: POST required");
      const bearer = /^Bearer ([^\s]+)$/i.exec(String(req.headers.authorization ?? ""))?.[1] ?? "";
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1_048_576) throw new Error("INVALID_INPUT: request too large");
        chunks.push(chunk);
      }
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { throw new Error("INVALID_INPUT: JSON body required"); }
      // Composition supplies the real request span/call identity and installs/flushes
      // the actual collector. Do not manufacture a parent span merely to match a header.
      result = await run((context) => {
        res.setHeader("x-capxul-trace", context.traceId);
        return saveAnnotation(db, provider, bearer, body, context);
      }, req);
    } catch (error) {
      const message = String((error as Error).message), candidate = message.split(":")[0]!;
      const code = refused.has(candidate) ? candidate : "PROVIDER_ERROR";
      status = code === "NOT_AUTHENTICATED" ? 401 : code === "ROLE_PERMISSION_DENIED" ? 403 :
        code === "INVALID_INPUT" ? 400 : code === "FEATURE_NOT_AVAILABLE" ? 409 : 502;
      result = { error: { code, message: refused.has(candidate) ? message : "The annotation service is unavailable" } };
    }
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(result));
    return true;
  };
}
