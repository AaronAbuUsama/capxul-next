import type { Sql } from "../platform/db.ts";
import type { Address } from "viem";
import { changeOfficer, type OfficerInput } from "./officers.ts";
import { approve, reject, requireMember, type BoardContext } from "./proposals.ts";
import { officerView, proposalView } from "./views.ts";
import type { ProposalStatus } from "./types.ts";

export type BoardWorld = Omit<BoardContext, "principalId" | "safe" | "kind" | "now"> & {
  hats: Address; payments: Address; worldNow: () => Promise<number>;
};

export const boardPaths = ["/board/proposals/get", "/board/proposals/list", "/board/proposals/approve", "/board/proposals/reject",
  "/board/officers/get", "/board/officers/grant", "/board/officers/revoke"] as const;

/** Integrator calls inside one worker transaction. No shared mount, commit, HMAC or actor-body path. */
export async function route(sql: Sql, authorization: string, path: string, input: unknown, world: BoardWorld, trace = "") {
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  if (!match) throw new Error("NOT_AUTHENTICATED: bearer session required");
  const now = await world.worldNow();
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("PROVIDER_RESPONSE_INVALID: canonical world clock required");
  const principal = await world.doors.authenticate(sql, match[1]!, now);
  const context: BoardContext = { ...world, now, principalId: principal.personId, safe: principal.safeAddress as Address,
    kind: principal.kind === "person" ? "human" : "agent" };
  if (!input || typeof input !== "object" || !("orgId" in input) || typeof input.orgId !== "string" || !input.orgId) {
    throw new Error("INVALID_INPUT: organization required");
  }
  const org = input.orgId;
  await requireMember(sql, org, context);
  const id = (key: "proposalId" | "changeId") => {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value !== "string" || !value) throw new Error(`INVALID_INPUT: ${key} required`);
    return value;
  };
  switch (path) {
    case "/board/proposals/get": return proposalView(sql, org, id("proposalId"), world.facts);
    case "/board/proposals/list": {
      const status = (input as { status?: unknown }).status;
      if (status !== null && !["awaiting_approvals", "executed", "failed", "rejected", "replaced"].includes(status as string)) {
        throw new Error("INVALID_INPUT: proposal status required (or null)");
      }
      const rows = (await sql.query(`select proposal_id from app.board_proposals where org_id=$1 and ($2::text is null or status=$2)
        order by nonce desc,created_at desc,proposal_id`, [org, status as ProposalStatus | null])).rows;
      return Promise.all(rows.map((r) => proposalView(sql, org, r.proposal_id, world.facts)));
    }
    case "/board/proposals/approve": return approve(sql, context, org, id("proposalId"), trace);
    case "/board/proposals/reject": return proposalView(sql, org, await reject(sql, context, org, id("proposalId"), world.payments, trace), world.facts);
    case "/board/officers/get": return officerView(sql, org, id("changeId"), world.siteUrl, world.facts);
    case "/board/officers/grant":
    case "/board/officers/revoke": {
      const change = await changeOfficer(sql, context, input as OfficerInput, path.endsWith("/grant") ? "grant" : "revoke", world.client, world.hats, trace);
      return officerView(sql, org, change, world.siteUrl, world.facts);
    }
    default: throw new Error("INVALID_INPUT: unknown Board operation");
  }
}
