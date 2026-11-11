// Who may run each projects command, in the terms of docs/design/new-commands.md (G4) and the
// authority model in docs/design/authority.md: a Seat, a hat or the Board, never a named person.
//
// - Member: any active Seat of the Organization, a person's or an agent's. The hosted FDE acts only as
//   the member who asked it, and a self-run own agent as itself (rules.fde-acts-for-asker). Every read,
//   every task command, and a worker's own time.
// - People or Director: a member whose own Safe wears the Organization's People hat, or the Director
//   hat. Managing projects, their members, settings, types and rates, and anyone else's time.
//
// The hat is read from the chain when the command runs, never remembered: `Hats.isWearerOfHat` on the
// caller's Seat's Safe and the deployment's hat ids, through chain-rpc (projects.hat-guard). So a
// member the Board swaps out of the People hat is refused at their next command, and one swapped in
// is admitted at theirs. Nothing about a project (who created it, its department, its customer) gives
// anyone authority over it (projects.permissions).

import {
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { contract_hats, integration_chain_rpc } from "../shared/external.ts";
import { table_org_deployments, table_org_members } from "../organizations/data.ts";
import { table_parties } from "../parties/data.ts";
import { table_project_changes, table_project_settings } from "./data.ts";

export const WHO_MEMBER =
  "Any member of the Organization: an active Seat, a person's or an agent's. The hosted FDE acts only as the member " +
  "who asked it, and a self-run own agent as itself (rules.fde-acts-for-asker). Anyone else naming it is " +
  "ROLE_PERMISSION_DENIED.";

export const WHO_MANAGER =
  "People or Director: a member whose own Safe wears the Organization's People hat, or the Director hat, as the chain " +
  "reads it when the command runs. Authority is the hat's, never a person's: whoever is swapped into the hat may act " +
  "and whoever is swapped out may not, the People hat by the Board and the Director hat by the Shareholders' top hat " +
  "(the founder's Safe, then the Governor). A self-run own agent may only once the Board granted its Safe the People " +
  "hat, since no agent is a Director (board.no-agent-directors); the hosted FDE only as the member who asked it, with " +
  "their hats (rules.fde-acts-for-asker).";

export const WHO_WORKER =
  "The timesheet's own worker, for their own time: any member, a self-run own agent included; the hosted FDE only as " +
  "the member who asked it, for their time (rules.fde-acts-for-asker). For anyone else's time, People or Director: a " +
  "member whose own Safe wears the People hat or the Director hat, as the chain reads it when the command runs.";

/** The tenant guard every command runs first. */
export const MEMBER_GUARD =
  "It first finds the caller's active Seat in the Organization (by principal, an agent's also by its Safe): none is " +
  "ROLE_PERMISSION_DENIED and nothing is read or written. ";

/** The hat guard every People-or-Director command runs next, before it reads or writes anything else. */
export const HAT_GUARD =
  MEMBER_GUARD +
  "Then it reads, live through chain-rpc, whether the Seat's Safe wears the deployment's People hat and, if not, its " +
  "Director hat (`Hats.isWearerOfHat`, which also asks the hat's eligibility and good standing): neither is " +
  "ROLE_PERMISSION_DENIED, and a chain that cannot answer is PROVIDER_ERROR; either way nothing is written " +
  "(projects.hat-guard). ";

/** The worker guard: the hat is read only when the timesheet is not the caller's own. */
export const WORKER_GUARD =
  MEMBER_GUARD +
  "When the timesheet's worker is not the caller's own Party, it then reads the caller's People or Director hat live, " +
  "as every People-or-Director command does: neither is ROLE_PERMISSION_DENIED, an unreadable chain PROVIDER_ERROR, " +
  "and nothing is written (projects.hat-guard). ";

/** What every write also writes: its change-log row, numbered under the settings row's lock (projects.change-log). */
export const LOG_LINE =
  "The write appends one row to the Organization's change log with the next `seq`, which becomes the record's " +
  "`version`, so a connected head receives it on its next push (projects.change-log). ";

/** What the member guard reads, and the Parties every view names. */
export const MEMBER_READS = [table_org_members, table_parties] as const;
/** What the hat guard reads besides: which hat is the People hat and which the Director hat. */
export const HAT_READS = [table_org_members, table_parties, table_org_deployments] as const;
/** The hat guard's one outside call, and the view it calls. */
export const HAT_CALLS = [integration_chain_rpc.c.readContract] as const;
export const HAT_CHAIN = [contract_hats.f.isWearerOfHat] as const;

/** What every write also writes: the change log and its counter. */
export const LOGGED = [table_project_changes, table_project_settings] as const;

/** A read that takes nothing but the Organization fails only at the member guard. */
export const GUARD_ERRORS = [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED] as const;
export const READ_ERRORS = [...GUARD_ERRORS, error_INVALID_INPUT] as const;
export const WRITE_ERRORS = [...READ_ERRORS, error_WRONG_STATE] as const;
/** A write behind the hat guard also fails as chain-rpc's readContract fails. */
export const MANAGE_ERRORS = [...READ_ERRORS, error_PROVIDER_ERROR, error_PROVIDER_RESPONSE_INVALID] as const;
/** The same, for a write that moves a status. */
export const HAT_ERRORS = [...MANAGE_ERRORS, error_WRONG_STATE] as const;

/** Where ERPNext's Projects module was read (frappe/erpnext, cloned at /tmp/erpnext). */
export const FRAPPE = "/tmp/erpnext/erpnext/projects/doctype";
