// Board proposals (acc:org.member.grant/1): in a company with more than one founding Director, `hat grant --propose`
// does not apply the grant. The founder's Safe approves the company Safe's batch and the grant waits; when every other
// founding Director has approved (`org proposal approve`), it executes and reads `applied`. `org member get` reads the
// hats a person wears from the chain. The chain work is packages/devnet's company module (propose, approveProposal).
import { randomBytes } from "node:crypto";
import type { Address, Hex } from "viem";
import { approvedBy, approveProposal, proposeGrant } from "../../../../packages/devnet/src/modules/company/service.ts";
import { syncTime, touchChainTx } from "./chain.ts";
import { person } from "./cli.ts";
import type { Out } from "./doc.ts";
import { refuse } from "./errors.ts";
import { touched } from "./trace.ts";
import { HAT_NAMES, proto, registry, saveRegistry, v4Org, v4Wears, type V4Org, type V4Proposal } from "./v4.ts";

const orgOf = (slug: string): V4Org => v4Org(slug) ?? (() => { throw refuse("UNKNOWN_ORG", `no company ${slug} on the chain`); })();
const proposalOf = (o: V4Org, id: string): V4Proposal => o.proposals?.[id] ?? (() => { throw refuse("NOT_FOUND", `no proposal ${id} in ${o.slug}`); })();

/** The proposal as it stands: its state, and which founding Director has approved, read from the company Safe. */
async function view(o: V4Org, x: V4Proposal) {
  const p = await proto();
  const approvals = await Promise.all((o.directors ?? []).map(async (d) => ({ director: d.email, approved: x.state === "applied" || await approvedBy(p, o.company, d.safe as Hex, x.safeTxHash) })));
  return { id: x.id, kind: x.kind, hat: x.hat, wearer: x.wearer, department: x.department || null, state: x.state, proposedBy: x.proposedBy, approvals, txHash: x.txHash ?? null };
}
const linesOf = (v: Awaited<ReturnType<typeof view>>) => [
  `proposal ${v.id} (${v.kind}: ${v.hat} to ${v.wearer}): ${v.state}`,
  ...v.approvals.map((a) => `  ${a.director}: ${a.approved ? "approved" : "waiting"}`),
];

/** `hat grant --propose`: the founder proposes the grant; it waits for the other Directors. */
export async function proposeHatGrant(slug: string, hat: string, email: string, wearer: Address, department: string, by: string): Promise<Out> {
  const r = registry(); const o = r[slug] ?? orgOf(slug);
  if ((o.directors ?? []).length < 2) throw refuse("INVALID_INPUT", `${slug} has one Director: its Board acts at once, so there is nothing to propose (grant without --propose)`);
  const id = o.hats[hat]; if (id === undefined) throw refuse("UNKNOWN_HAT", `no hat ${hat} in ${slug}`);
  if (await v4Wears(slug, wearer, hat)) throw refuse("CHAIN_REFUSED", `AlreadyWorn: ${email} already wears ${hat}`);
  await syncTime();
  const made = await proposeGrant(await proto(), o.company, BigInt(id), wearer);
  const x: V4Proposal = { id: `prop_${randomBytes(6).toString("hex")}`, kind: "hat grant", hat, wearer: email, department, safeTxHash: made.safeTxHash, calls: made.calls.map((c) => ({ to: c.to, data: c.data })), state: "waiting", proposedBy: by };
  o.departments[`${id}:${wearer.toLowerCase()}`] = department;
  (o.proposals ??= {})[x.id] = x; saveRegistry(r);
  const v = await view(o, x);
  return { data: v, lines: linesOf(v) };
}

export async function orgProposalGet(args: string[]): Promise<Out> {
  const [slug, id] = args;
  if (!slug || !id) throw refuse("USAGE", "usage: org proposal get <slug> <proposal id>");
  const o = orgOf(slug); const v = await view(o, proposalOf(o, id));
  return { data: v, lines: linesOf(v) };
}

/** A founding Director approves; the last approval executes the batch and the proposal reads `applied`. */
export async function orgProposalApprove(args: string[]): Promise<Out> {
  const [slug, id] = args; const asAt = args.indexOf("--as"); const as = asAt >= 0 ? args[asAt + 1] : undefined;
  if (!slug || !id || !as) throw refuse("USAGE", "usage: org proposal approve <slug> <proposal id> --as <director email>");
  touched.actor = as;
  const r = registry(); const o = r[slug] ?? orgOf(slug); const x = proposalOf(o, id);
  const director = o.company.coDirectors?.find((_, i) => (o.directors ?? [])[i + 1]?.email.toLowerCase() === as.toLowerCase());
  const founder = (o.directors ?? [])[0]?.email.toLowerCase() === as.toLowerCase();
  if (!director && !founder) throw refuse("ROLE_PERMISSION_DENIED", `${as} is not a Director of ${slug}: only a Director approves a Board proposal`);
  person(as);
  if (x.state === "applied") throw refuse("INVALID_STATE", `proposal ${id} is already applied`);
  if (director) {
    await syncTime();
    let done;
    try { done = await approveProposal(await proto(), o.company, { safeTxHash: x.safeTxHash, calls: x.calls }, director); }
    catch (e) {
      const m = (e as Error).message;
      throw m.startsWith("STALE_PROPOSAL") ? refuse("STALE_PROPOSAL", `proposal ${id}: ${m.slice(16)}`) : refuse("CHAIN_REFUSED", `chain refused the approval: ${m.split("\n").slice(0, 3).join(" ")}`);
    }
    if (done.executed) { x.state = "applied"; x.txHash = done.txHash; touchChainTx(done.txHash as Hex, "board proposal"); }
    saveRegistry(r);
  }
  const v = await view(o, x);
  return { data: v, lines: linesOf(v) };
}

/** The hats a person wears in the company, as the chain says. */
export async function orgMemberGet(args: string[]): Promise<Out> {
  const [slug, email] = args;
  if (!slug || !email) throw refuse("USAGE", "usage: org member get <slug> <email>");
  orgOf(slug); const who = person(email);
  const hats = [];
  for (const h of HAT_NAMES) if (await v4Wears(slug, who.address as Address, h)) hats.push(h);
  return { data: { email: who.email, address: who.address, hats }, lines: [`${who.email} in ${slug}: ${hats.length ? hats.join(", ") : "no hats"}`] };
}
