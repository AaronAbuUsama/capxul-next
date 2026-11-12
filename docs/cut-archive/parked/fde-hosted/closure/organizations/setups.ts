// The setups area: an Organization's birth and the reads and resume of its setup. The setup's
// durable process is in processes.ts; the SDK flows that drive these rpcs are in flows.ts.
//
// The old area had 17 rpcs (begin, get, the proof receipt, list-mine, resume, prepare and submit
// the authorization, and ten internal load, record, claim, fence, apply and emit steps) and two
// workflows (observe and recover). The target keeps three rpcs: begin, get and resume. Preparing,
// sponsoring and sending the founder's operation are approvals' (the setup opens one approval for
// the install batch); the checks and their recovery cron are the setup process's own waits; the
// proof receipt is the approval's; the founder's unfinished setups are part of `org list`.

import { Schema } from "effect";
import { budget, defineRpc } from "../../packages/blueprint-engine/src/index.ts";
import { concept_organizations } from "../shared/foundation.ts";
import {
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { contract_company_safe_minter } from "../shared/external.ts";
import {
  machine_org_app,
  machine_org_setup,
  table_org_apps,
  SetupIssue,
  SetupStep,
  table_org_members,
  table_org_setups,
  table_organizations,
} from "./data.ts";
import { table_principals } from "../access/data.ts";
import { table_admissions, table_personal_safes } from "../accounts/data.ts";
import { table_files } from "../media/data.ts";
import { table_parties } from "../parties/data.ts";
import { procedure_parties_register } from "../parties/procedures.ts";
import { table_safe_approvals, table_safe_owners } from "../indexing/data.ts";

const O = "packages/backend/src/organizations";
const SET = `${O}/setups`;
const AS_IS = "docs/as-is/archive/organizations/setups.ts";

const S = Schema.String;
const N = Schema.Number;
const NullOr = Schema.NullOr;

/** An Organization's setup as `org show`, `org wait`, `org create` and `org retry` print it. */
export const SetupView = Schema.Struct({
  orgId: S,
  safe: S,
  setup: Schema.Literals(["processing", "awaiting_authorization", "needs_attention", "ready", "failed"]),
  steps: Schema.Array(SetupStep),
  issue: NullOr(SetupIssue),
  /** What would move setup on: the founder's signature, a check again (`org retry`), or nothing. */
  recovery: Schema.Literals(["authorize", "checkAgain", "none"]),
  /** The install approval to open on the approval page while awaiting authorization. */
  approvalId: NullOr(S),
  checkedAt: N,
  /** Once ready, from the chain: the Directors (the Gate's valid signers), the threshold, the next nonce, the proposals waiting. */
  board: NullOr(Schema.Struct({ directors: N, threshold: N, nonce: N, waitingProposals: N })),
  /** The Organization's hosted FDE, once the host has made it: its Party and Safe; live once the install has landed. */
  fde: NullOr(Schema.Struct({ partyId: S, safe: S })),
});

const OneOrganization = Schema.Struct({ orgId: S });

export const rpc_organizations_setups_begin = defineRpc({
  id: "organizations.setups.begin",
  title: "Create the Organization, its Party and its setup, or resume the same intent",
  about:
    "One transaction. The founder's mailbox must be admitted (accounts' admissions; else FEATURE_NOT_AVAILABLE) and their " +
    "personal Safe claimed (accounts' personal Safe past `claim`; else WRONG_STATE). Bio and size are trimmed " +
    "and blank ones dropped; a bio over 280 characters, a country that is not two letters or a logo that is not the " +
    "founder's own media file of purpose `image` in state `kept` is INVALID_INPUT, before any write. The intent (name, handle, country, bio, size, logo) is hashed: " +
    "if the handle's Party already stands for an Organization this founder began with the same intent, that Organization " +
    "and its setup are returned unchanged; another intent is WRONG_STATE; another founder's handle is INVALID_INPUT. " +
    "Otherwise it computes the company Safe's address in-process with the minter's pure `companySafeAddressFor` (no node " +
    "call), inserts the Organization with its ten seats (`seat_limit` 10, aaron.seats) and its setup (`begin`, which " +
    "starts the setup process), and registers the " +
    "Organization's Party, pending, with the handle and that Safe (`parties.register`): a taken or malformed handle fails " +
    "the whole transaction with INVALID_INPUT, so no Organization and no setup are left. Start-up (organizations.startup): " +
    "the Company's abbreviation comes from the name's initials, and its currency, time zone and fiscal-year start from " +
    "the country unless given (USD for a country currency with no USD price pair; an unpriced currency, a bad zone or " +
    "`MM-DD` is INVALID_INPUT); the fundamental apps are " +
    "born installed and native, each app in `apps` wanted (one not in HEAD_APPS, or a fundamental one, is INVALID_INPUT), " +
    "and each fundamental app's concept starts itself from `begin`. Unless `fde` is false, it records `with_fde`: the " +
    "setup's process asks Capxul's FDE host for the FDE later (organizations.fde-at-start-up); no key is made here.",
  was: [
    `${AS_IS}:200`,
    `${SET}/operations/begin.ts:11`,
    `${SET}/writes/begins.ts:139`,
    `${SET}/writes/organizations.ts:61`,
    `${SET}/guards.ts:70`,
  ],
  concept: concept_organizations,
  kind: "mutation",
  who: "A signed-in person admitted from the waitlist whose own personal Safe is claimed.",
  input: Schema.Struct({
    name: S,
    handle: S,
    country: S,
    bio: Schema.optionalKey(S),
    size: Schema.optionalKey(S),
    logoFileId: Schema.optionalKey(S),
    /** ISO 4217; the country's currency when absent. */
    currency: Schema.optionalKey(S),
    /** IANA; the country's first zone when absent. */
    timeZone: Schema.optionalKey(S),
    /** `MM-DD`; the country's fiscal-year start when absent, else `01-01`. */
    fiscalYearStart: Schema.optionalKey(S),
    /** Frappe apps beyond the fundamental ones, wanted until a head installs them. */
    apps: Schema.optionalKey(Schema.Array(S)),
    /** False starts the Organization without its hosted FDE (`--no-fde`); absent or true, the setup asks the FDE host for one. */
    fde: Schema.optionalKey(Schema.Boolean),
  }),
  output: Schema.Struct({ orgId: S, resumed: Schema.Boolean, setup: SetupView }),
  errors: [error_NOT_AUTHENTICATED, error_FEATURE_NOT_AVAILABLE, error_INVALID_INPUT, error_WRONG_STATE],
  reads: [table_principals, table_admissions, table_personal_safes, table_parties, table_files, table_organizations, table_org_setups],
  writes: [table_organizations, table_org_setups, table_org_apps],
  drives: [machine_org_setup.t.begin, machine_org_app.t.install_native, machine_org_app.t.want],
  invokes: [procedure_parties_register],
  emits: [],
  calls: [],
  chain: [contract_company_safe_minter.f.companySafeAddressFor],
  spans: ["rpc.organizations.setups.begin"],
  budget: budget("write"),
});

export const rpc_organizations_setups_get = defineRpc({
  id: "organizations.setups.get",
  title: "Where an Organization's setup stands, read once or followed live",
  about:
    "A live query: `org show` reads it once, `org wait` and the create and retry flows subscribe and are pushed each " +
    "change of the setup's row, with no polling. Visible to a current member, and to the founder while setup is " +
    "unfinished; for anyone else it is ROLE_PERMISSION_DENIED, the same answer as for an id that names nothing, so " +
    "another founder's setup reads as absent. Once ready, `board` comes from indexing: the company Safe's owners that the " +
    "Gate holds valid, its threshold and nonce, and the approved hashes not yet executed at or above that nonce. It never " +
    "writes and never wakes the setup process.",
  was: [`${AS_IS}:247`, `${SET}/operations/get.ts:10`, `${SET}/guards.ts:22`, `${O}/views.ts:44`],
  concept: concept_organizations,
  kind: "live",
  who: "A current member of the Organization, or its founder while setup is unfinished.",
  input: OneOrganization,
  output: SetupView,
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED],
  reads: [table_org_setups, table_organizations, table_org_members, table_safe_owners, table_safe_approvals],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: ["rpc.organizations.setups.get"],
  budget: budget("live-read"),
});

export const rpc_organizations_setups_resume = defineRpc({
  id: "organizations.setups.resume",
  title: "Ask a stopped setup to carry on",
  about:
    "The setup process's signal. The founder only; an Organization with no setup they founded is INVALID_INPUT, so it " +
    "confirms nothing to anyone else. A setup that needs attention moves back to processing (`resume`), and the process " +
    "runs again from its last finished step, opening a fresh install approval when the install is next; a processing " +
    "setup is woken to check its waits again now. A setup waiting for the founder's authorization, or ready, is returned " +
    "as it is: the flow opens the approval page instead. A failed setup is WRONG_STATE: nothing can finish it. It never " +
    "creates an Organization, never sends anything itself and never opens a second approval while one is open.",
  was: [`${AS_IS}:318`, `${SET}/operations/resume.ts:9`, `${SET}/writes/resumes.ts:42`],
  concept: concept_organizations,
  kind: "mutation",
  who: "The founder of the Organization.",
  input: OneOrganization,
  output: SetupView,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_WRONG_STATE],
  reads: [table_org_setups, table_organizations],
  writes: [table_org_setups],
  drives: [machine_org_setup.t.resume],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: ["rpc.organizations.setups.resume"],
  budget: budget("write"),
});
