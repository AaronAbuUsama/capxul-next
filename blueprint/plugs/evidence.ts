// What the spike's door section decided for the plugs (spikes/skeleton/FINDINGS.md, The door, the recorder and the clock). The coordinator's decisions on
// Aaron's delegation of the book; the owner's list gets nothing from them. Each states what the spike showed and, where it did not, what waits on which test.

import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import * as f from "../shared/foundation.ts";
import { BY } from "./kit.ts";

const DOOR = "spikes/skeleton/FINDINGS.md, The door: how a person is reached without a browser and without a stored password";
const dec = (spec: { id: string; title: string; question: string; options: { label: string; text: string }[]; chosen: string; why: string; evidence: string }) =>
  defineDecision({ ...spec, source: BY(spec.evidence), affects: [f.system_capxul, f.concept_plugs, f.component_frappe_app] as never });

export const decision_plugs_door_assertion = dec({
  id: "plugs.door-assertion",
  title: "A person is reached on a site by a short-lived signed assertion, nothing stored",
  question: "How do the CLI, an agent or the service act on a site as a person, without a browser and without a stored password or key?",
  options: [
    {
      label: "signed-assertion",
      text:
        "The service signs {user, site, expiry 60 seconds, nonce} and sends it as `X-Capxul-Assertion`. The Capxul app registers a Frappe auth hook that checks the signature, " +
        "the site name, the expiry (host time, on purpose), that the User is enabled and that it wears at least one hat on this site (a Capxul Hat Grant row), then runs as that User. " +
        "From there it is plain Frappe: the person's roles, user permissions and feature switches. Administrator has no hat and is never reachable; the CLI refuses without `--as`. " +
        "Revoking the last hat closes the door at once. Nothing is stored for the person: no password, key or token. The real product signs with Core's private key and each site holds only Core's " +
        "public key (the spike's shared secret lets any site forge any person). Whether the assertion also carries the person's own key, so the person and not Core is the root, is open and not on " +
        "the owner's list: it waits on the access design. The nonce is carried and not yet checked: the site will remember each nonce for the assertion's lifetime (an eval: a replayed assertion is refused).",
    },
    { label: "api-keys", text: "Frappe API keys per person (generate_keys; the secret is shown once, must be kept by Core, must be revoked with the hat): rejected, it stores and rotates what the assertion does not." },
  ],
  chosen: "signed-assertion",
  why:
    "Shown by the spike's door: every verb ran as the calling person, and a revoked hat closed it. Two Frappe traps found: frappe.set_user wipes the request's form_dict (the hook saves and restores it), and ERPNext's " +
    "default per-Employee User Permission confines an HR person to their own record (the hat code creates employees with it off). Replay is the open edge, hence the nonce check.",
  evidence: DOOR,
});

export const decision_plugs_seven_hats = dec({
  id: "plugs.seven-hats",
  title: "Seven hats, not four; a hat's roles are a table that ships with the app",
  question: "How many hats does the site need, who owns the table that maps them to roles, and how does a new hat reach every site?",
  options: [
    {
      label: "seven-hats-shipped-map",
      text:
        "The spike needed seven: admin, budget-holder, payroll-approver, member, and `sales`, `hr-manager`, `project-manager`, because a salesperson, an HR manager and a project manager each need roles the other hats must not give. " +
        "Today only `admin` can open the CRM (its Sales Manager and Sales User roles, plus System Manager); `sales` and `sales-manager` roles are what a salesperson needs, and whether a department or territory scopes it is open " +
        "(Frappe CRM has its own hierarchy permission hooks). The map from hat to roles is one table that ships with the app (plugs.hat-map-ships), versioned, so adding a hat is a release that adds a row to every site, never an edit on a site. " +
        "A department narrows a hat through Frappe User Permissions, which limit only documents that have a department link; a Payment Entry has none, so money authority stays on the chain (cut.department-budgets). " +
        "The chain's hat definition must accept a new hat name without a redeploy: the stand-in Hats.sol did not and the chain was redeployed from nothing (a finding for the real contracts, m1-contracts-reconcile). " +
        "A hat added on the chain with no row on a site gives `Unknown hat` and a parked event (plugs.poison-event).",
    },
    { label: "four-hats", text: "Keep the skeleton's four hats and widen their roles: a salesperson would then hold the HR roles." },
  ],
  chosen: "seven-hats-shipped-map",
  why: "FINDINGS, The door (Seven hats now; What the door reaches: 225 types for a salesperson against 527 for the admin hat) and CRM: Roles, the hat that is missing. The roles for the Books and Invoicing officer hats are still an assumption: the job evals of m3 prove them (plugs.hat-roles-by-job).",
  evidence: DOOR,
});
