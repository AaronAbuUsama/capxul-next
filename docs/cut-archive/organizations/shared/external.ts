// Moved out of the built book by the cut, 10 November 2026, from books/target/shared/external.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { defineContract, defineIntegration } from "../../../packages/book/src/index.ts";
import { component_backend, component_core_sdk } from "./foundation.ts";
import {
  error_AMOUNT_BELOW_USE,
  error_CANCELLED,
  error_CHILDREN_EXCEED_PARENT,
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_PAYROLL_BUDGET_EXCEEDED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_RATE_LIMITED,
  error_ROLE_PERMISSION_DENIED,
  error_TRANSACTION_FAILED,
  error_VERIFICATION_REQUIRED,
  error_WORK_DIED,
  error_WRONG_ENVIRONMENT,
  error_WRONG_STATE,
} from "./vocabulary.ts";

export const integration_frappe_head = defineIntegration({
  id: "frappe-head",
  title: "A connected Frappe head: the Organization's Frappe site and its host",
  about:
    "An Organization's Frappe site (the head, aaron.frappe-head), reached over HTTPS with the API key and secret its head " +
    "connection holds under record-bound encryption, behind the Effect service `FrappeHead`. Capxul always calls; the head " +
    "only rings Capxul's doorbell, with no data. Every call goes to the Capxul app for Frappe's whitelisted methods (component frappe-app), so " +
    "Capxul depends on one versioned contract, not on ERPNext's internals. Each concept that holds a fundamental app's " +
    "records syncs them itself: it pushes its changes in its own change order and pulls the head's, by the rules of " +
    "organizations.head-ownership. Dates cross in the Organization's time zone, which the head's System Settings must " +
    "share; instants cross as UTC, and the head's own now is the world's (organizations.head-clock, " +
    "devnet.head-follows-world). Nothing that moves money goes through the head: a head asks for money only through " +
    "Capxul's commands. Installing an app is the head's host's: Frappe Cloud's site API when the head is hosted there, " +
    "with the Frappe Cloud team's own API token (a site's key cannot install apps), which the connection seals beside " +
    "the site's key. The document family (organizations.doc-family) reaches the rest of the head through `docRead` and " +
    "`docWrite`: each names the member's mailbox, member id, the roles their hats give at that call and org-apps' " +
    "native modules; the Capxul app brings that User's Capxul-held roles to the set given and runs the call as the " +
    "User under Frappe's permissions; it refuses a native module's DocType (naming the module), money (ledger hooks, " +
    "repost_allowed_doctypes, MONEY_MODULES, LEDGER_UNHOOKED) and child tables (organizations.doc-reach); under an " +
    "active Workflow it refuses a direct submit or cancel itself, since Frappe's server would let one skip the " +
    "transitions, and tells apart a state allowing no action, a role the User lacks, a condition that refuses and a " +
    "self-approval; and it keeps each applied call id and its answer for a day.",
  component: component_backend,
  system: "frappe",
  service: "FrappeHead",
  calls: {
    readSite: {
      about:
        "The site as it stands: Frappe's version, the installed apps and their versions, the System Settings time zone, the " +
        "Capxul app's version and its Custom Fields, and the Company carrying the Organization's id, with its currency.",
      timeoutMs: 5_000,
      retries: { max: 2, backoff: "exponential" },
      p95Ms: 2_000,
      failures: [
        headUnavailable,
        headRefusedKey,
        { when: "The site has no Capxul app, or one older than the contract Capxul speaks (its method is missing)", error: error_WRONG_STATE },
        headThrottled,
        headUnusable,
      ],
    },
    upsertDocs: {
      about:
        "Writes documents in change order by `capxul_id` (insert, update, submit, cancel, amend), each with its version and " +
        "the last head change Capxul read, over which it writes; answers written, unchanged, conflict (a newer head change " +
        "Capxul has not read) or refused, with its head name.",
      timeoutMs: 15_000,
      retries: { max: 2, backoff: "exponential" },
      p95Ms: 3_000,
      failures: [headUnavailable, headRefusedKey, headThrottled, headUnusable],
    },
    listChanges: {
      about:
        "The head's own changes to the synced DocTypes after a change id, oldest first: DocType, head name, `capxul_id` (null " +
        "for a document born in the head), the version it was based on, its fields, docstatus, the head user and its time.",
      timeoutMs: 10_000,
      retries: { max: 2, backoff: "exponential" },
      p95Ms: 2_000,
      failures: [headUnavailable, headRefusedKey, headThrottled, headUnusable],
    },
    installApp: {
      about:
        "Asks the head's host to install an app the site's bench group has (Frappe Cloud's site API, with the team's " +
        "token); answers when the job is queued. The app appears in readSite once it is installed.",
      timeoutMs: 10_000,
      retries: { max: 0, backoff: "none" },
      p95Ms: 2_000,
      failures: [
        headUnavailable,
        headRefusedKey,
        { when: "The head's host cannot install apps for Capxul (a self-hosted bench): its owner runs `bench install-app` instead", error: error_WRONG_STATE },
        {
          when: "The host knows no such app, or not for the site's Frappe version, or the site's bench group lacks it (its owner adds it there first)",
          error: error_INVALID_INPUT,
        },
        headUnusable,
      ],
    },
    docRead: {
      about:
        "The document family's reads (list, get, doctypes, doctype), by call id, run on the head as the member's own " +
        "User (mailbox, member id and the roles their hats give now). Refusals (native, money, child, not permitted, a " +
        "bad name or field) come back as answers with a reason, never as failures.",
      timeoutMs: 5_000,
      retries: { max: 2, backoff: "exponential" },
      p95Ms: 2_000,
      failures: [
        headUnavailable,
        headRefusedKey,
        { when: "The site's Capxul app is older than the document family's methods (its method is missing)", error: error_WRONG_STATE },
        headThrottled,
        headUnusable,
      ],
    },
    docWrite: {
      about:
        "The document family's writes (insert, save, submit, cancel, amend, a Workflow action, delete) as `docRead` runs " +
        "them, idempotent by the call id: a retry answers what the first did, and completes a call Capxul logged " +
        "refused because the head never answered (organizations.doc-log).",
      timeoutMs: 10_000,
      retries: { max: 2, backoff: "exponential" },
      p95Ms: 2_500,
      failures: [
        headUnavailable,
        headRefusedKey,
        { when: "The site's Capxul app is older than the document family's methods (its method is missing)", error: error_WRONG_STATE },
        headThrottled,
        headUnusable,
      ],
    },
  },
  fake:
    "The devnet's stand-in head (devnet.head-stand-in): the supervisor serves it on loopback, speaking the Capxul app's " +
    "methods, and keeps its state in devnet's tables: sites (`head-sites`), documents by DocType and `capxul_id` " +
    "(`head-documents`) and its scripted edits as listChanges rows that ring `organizations.heads.ring` " +
    "(`head-changes`). It installs an app at once when it stands in for a Frappe Cloud site, and answers `installApp` " +
    "WRONG_STATE when self-hosted; it serves `docRead` and `docWrite` over its documents with Frappe's docstatus rules, " +
    "its fixture DocTypes' metas, role permissions and mandatory fields, their Workflows, the ledger hooks and the call " +
    "ids it applied (devnet.world-pass-worlds); it follows the world's clock as a follower, and has a fault switch " +
    "(down, key refused, conflict on the next write, refuse the next document, replay, drop-answer, clear). It runs none " +
    "of Frappe's other validations, reports or scheduled jobs. A head eval that needs real Frappe boots a bench with " +
    "ERPNext, Frappe HR, Frappe CRM and the Capxul app instead, which follows the world's clock through the app's hook " +
    "(devnet.head-follows-world): Frappe's now_datetime has its code replaced, imported through before_request, " +
    "before_job and an override of Scheduled Job Type, reading the world's clock event cached in Redis; the host-clock " +
    "reads that decide something are rebound; `bench --site <site> capxul follow` runs the due Scheduled Job Types at " +
    "each stop and enqueues them every world minute between; override_email_send hands the head's own email to the " +
    "supervisor's `POST /v1/mail`, held to MAIL_ALLOWED_RECIPIENTS on staging; a bench following a shared world does so " +
    "over HTTPS with a follower grant. It follows stateful, answering a world's `save` and `restore` with Frappe's own " +
    "backup and restore, so a season's start and reset bring its site back with the world (devnet.stateful-followers).",
  secrets: [],
  was: ["docs/vision/erp.md (sections 1, 5 and 7)"],
});
