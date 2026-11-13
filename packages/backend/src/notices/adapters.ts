import { parseAbi, type Address, type PublicClient } from "viem";
import { readPrincipal, readPrincipalByEmail, readPrincipalBySafe } from "../access/door.ts";
import { readAdmissionForEvent } from "../accounts/door.ts";
import { readOfficerChange, readProposal } from "../board/door.ts";
import { currentWearers } from "../budgets/door.ts";
import { info } from "../organizations/door.ts";
import { readCommandPayments, readPayment } from "../payments/door.ts";
import type { Sql } from "../platform/db.ts";
import { getRequest } from "../requests/door.ts";
import type { Sources } from "./sources.ts";

const owners = parseAbi(["function getOwners() view returns (address[])"]);
const found = <T>(row: T | null | undefined, what: string): T => {
  if (!row) throw new Error(`NOT_FOUND: ${what} source row`);
  return row;
};

/** Binds Notices to each source door. Reads run on the worker Sql that prepareDue already scoped to the event owner. */
export function sourceDoors(chain: PublicClient): Omit<Sources, "partyName"> {
  return {
    async admission(sql, event) {
      const a = found(await readAdmissionForEvent(sql, event.entity_id), "admission");
      return { email: a.mailbox, admitted_by: a.admitted_by, referrer_email: a.referrer_email, referral_rewarded_with_invite: a.referral_rewarded_with_invite };
    },
    principal: readPrincipal,
    principalBySafe: readPrincipalBySafe,
    principalByEmail: readPrincipalByEmail,
    async organization(sql, id) {
      const o = await info(sql, id);
      return { name: o.name, safe: o.safe };
    },
    async proposal(sql, org, id) {
      const p = found(await readProposal(sql, org, id), "proposal");
      return { proposer_safe: p.proposer_safe, safe_address: p.safe_address, note: p.note, opener: p.opener,
        subject: `${p.subject_kind} ${p.subject_id}`, proposer_principal_id: p.proposer_principal_id };
    },
    async officerChange(sql, org, id) {
      const c = found(await readOfficerChange(sql, org, id), "officer change");
      return { change: c.change, permission: c.permission, email: c.email, principal_id: c.principal_id, note: c.note };
    },
    payment: async (sql, owner, id) => found(await readPayment(sql, owner, id), "payment"),
    commandPayments: readCommandPayments,
    hatWearers: currentWearers,
    request: (sql: Sql, owner, id) => getRequest(sql, { owner_kind: owner.kind, owner_id: owner.id, request_id: id }),
    safeOwners: (safe) => chain.readContract({ address: safe as Address, abi: owners, functionName: "getOwners" }),
  };
}
