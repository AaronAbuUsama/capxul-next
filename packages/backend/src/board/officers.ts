import { createHash, randomUUID } from "node:crypto";
import { encodeFunctionData, parseAbi, type Address, type PublicClient } from "viem";
import type { Sql } from "../platform/db.ts";
import { readOfficerChange } from "./door.ts";
import { officerEvent } from "./events.ts";
import { createProposal, requireDirector, type BoardContext } from "./proposals.ts";
import type { Call, Permission } from "./types.ts";

const hats = parseAbi([
  "function isWearerOfHat(address wearer,uint256 hat) view returns (bool)",
  "function mintHat(uint256 hat,address wearer) returns (bool)",
  "function changeHatMaxSupply(uint256 hat,uint32 maxSupply)",
  "function setHatWearerStatus(uint256 hat,address wearer,bool eligible,bool standing) returns (bool)",
]);
export type OfficerInput = { orgId: string; member: string; permission: Permission; note: string | null };

async function member(sql: Sql, org: string, selector: string) {
  const mailbox = selector.trim().toLowerCase();
  const handle = mailbox.startsWith("@");
  const key = handle ? mailbox.slice(1) : createHash("sha256").update(mailbox).digest("hex");
  const row = (await sql.query(`select m.*,p.state as party_state,p.display_name,p.handle
    from app.org_members m join app.parties p on p.party_id=m.party_id
    where m.org_id=$1 and m.status='active' and p.state<>'released'
      and ${handle ? "p.kind='agent' and p.handle=$2" : "p.kind='person' and p.mailbox_digest=$2"}`, [org, key])).rows[0];
  if (!row) throw new Error("INVALID_INPUT: invite this member first");
  if (row.kind === "agent" && row.party_state !== "active") throw new Error("WRONG_STATE: agent Safe is not active");
  return { ...row, email: handle ? null : mailbox, name: handle ? `@${row.handle}` : row.display_name };
}

export async function changeOfficer(sql: Sql, context: BoardContext, input: OfficerInput, change: "grant" | "revoke", client: PublicClient, hatsAddress: Address, trace = "") {
  if (!["manage-books", "issue-invoices", "manage-people"].includes(input.permission) || typeof input.member !== "string" || !input.member.trim() ||
      input.note !== null && typeof input.note !== "string") throw new Error("INVALID_INPUT: member, permission and optional note required");
  await sql.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [input.orgId]);
  const state = await requireDirector(sql, input.orgId, context, true);
  if (input.permission === "manage-books") await context.doors.requireFeature(sql, "books", { personId: context.principalId, orgId: input.orgId }, context.catalogue, context.now);
  const who = await member(sql, input.orgId, input.member);
  const claimed = await context.facts.safe(sql, context.chainId, who.safe_address);
  if (!claimed?.deployed) throw new Error("WRONG_STATE: member has no claimed Safe");
  const id = state.deployment[({ "manage-books": "books_hat", "issue-invoices": "invoicing_hat", "manage-people": "people_hat" } as const)[input.permission]];
  if (id === null) throw new Error("WRONG_STATE: the Organization's deployment binds no hat to this permission yet");
  if ((await sql.query(`select 1 from app.officer_changes where org_id=$1 and member_id=$2 and permission=$3 and waiting`, [input.orgId, who.member_id, input.permission])).rowCount) {
    throw new Error("WRONG_STATE: this member's permission change still waits");
  }
  let wears: boolean;
  try { wears = await client.readContract({ address: hatsAddress, abi: hats, functionName: "isWearerOfHat", args: [who.safe_address, BigInt(id)], blockNumber: state.blockNumber }); }
  catch { throw new Error("PROVIDER_ERROR: could not read current officer hat"); }
  if (wears === (change === "grant")) throw new Error(`WRONG_STATE: member ${wears ? "already wears" : "does not wear"} this hat`);
  if (change === "grant" && input.permission === "manage-people" &&
      await context.facts.hasOffice(sql, context.chainId, state.safe.safe_address, who.safe_address)) {
    throw new Error("ROLE_CONFLICT: member holds a department or team office");
  }
  const calls: Call[] = [];
  const call = (data: `0x${string}`) => calls.push({ to: hatsAddress, value: "0", data });
  if (change === "grant") {
    const hat = await context.facts.hat(sql, context.chainId, id, state.safe.safe_address);
    if (!hat) throw new Error("WRONG_STATE: officer hat is not indexed");
    const waiting = (await sql.query("select count(*) as n from app.officer_changes where org_id=$1 and hat_id=$2 and waiting and change='grant'", [input.orgId, id])).rows[0];
    const next = BigInt(hat.supply) + BigInt(waiting.n) + 1n;
    if (next > BigInt(hat.max_supply)) {
      if (next > 0xffffffffn) throw new Error("WRONG_STATE: hat capacity exhausted");
      call(encodeFunctionData({ abi: hats, functionName: "changeHatMaxSupply", args: [BigInt(id), Number(next)] }));
    }
    call(encodeFunctionData({ abi: hats, functionName: "mintHat", args: [BigInt(id), who.safe_address] }));
  } else call(encodeFunctionData({ abi: hats, functionName: "setHatWearerStatus", args: [BigInt(id), who.safe_address, false, true] }));
  const changeId = `spc_${randomUUID().replaceAll("-", "")}`;
  const note = input.note ?? `${change === "grant" ? "Give" : "Take back"} ${input.permission} ${change === "grant" ? "to" : "from"} ${who.name ?? input.member}`;
  const proposal = await createProposal(sql, context, { org_id: input.orgId, opener: "board", subject_kind: "officer-change", subject_id: changeId,
    kind: "transaction", rejects: null, calls, note, payment: null,
    summary: { title: note, from: { label: input.orgId, address: state.safe.safe_address }, to: { label: who.name ?? input.member }, amount: null, recipients: [], warnings: [] } }, state, trace);
  await sql.query(`insert into app.officer_changes
    (org_id,change_id,member_id,party_id,principal_id,member_safe,email,name,change,permission,hat_id,proposal_id,note,state,waiting,created_at,updated_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'proposed',true,$14,$14)`,
  [input.orgId, changeId, who.member_id, who.party_id, who.principal_id, who.safe_address, who.email, who.name, change, input.permission, id, proposal.proposal_id, note, context.now]);
  await officerEvent(sql, (await readOfficerChange(sql, input.orgId, changeId))!, context.principalId, null, "propose", trace, context.now);
  return changeId;
}
