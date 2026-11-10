// The two outside systems the plugs and the sites talk to: the Frappe site itself (through the Capxul app on it) and the site
// service that creates and runs sites. `frappe-site` replaces the old `frappe-head`, which was written for an optional outside
// head with its own API key and a sync of Capxul's own tables; a site is Capxul's now (aaron.frappe-native, aaron.one-door).
// Both are reached only from the backend (component:backend); the CLI and SDK reach the site through the backend, never directly.

import { defineIntegration } from "../../../packages/book/src/index.ts";
import { component_backend } from "../shared/foundation.ts";
import { error_FEATURE_NOT_AVAILABLE, error_INVALID_INPUT, error_PROVIDER_ERROR, error_PROVIDER_RESPONSE_INVALID, error_WRONG_STATE, error_ROLE_PERMISSION_DENIED } from "../shared/vocabulary.ts";

const SPIKE = "spikes/skeleton/FINDINGS.md";
const down = { when: "The site does not answer (the bench is stopped or restarting)", error: error_PROVIDER_ERROR } as const;
const badSig = { when: "The site answers 401: the signed body did not verify (a wrong or rotated secret)", error: error_PROVIDER_ERROR } as const;
const unusable = { when: "The site answers something that is not the documented shape", error: error_PROVIDER_RESPONSE_INVALID } as const;

export const integration_frappe_site = defineIntegration({
  id: "frappe-site",
  title: "An Organization's hosted Frappe site, through the Capxul app on it",
  about:
    "The site Capxul hosts for an Organization (ERPNext, Frappe HR, Frappe CRM and the WhatsApp app, renamed to Capxul), reached over HTTPS at its " +
    "own hostname through whitelisted methods of the Capxul app (component:frappe-app), behind the Effect service `FrappeSite`. Every call carries " +
    "`X-Capxul-Signature`, an HMAC-SHA-256 of the raw body under the site's own secret; a call without a valid signature is refused with 401. Capxul " +
    "always calls with data; the site calls Capxul only to ask for a payment to be prepared and to sign in. Nothing the site holds is copied into " +
    "Capxul's tables: Frappe owns its documents. `applyEvent` is how the chain reaches the books and the roles. `doorCall` and `doorReport` run " +
    "the person's own call: the app sets the session user to the Frappe user that person's hat created, so Frappe's permissions decide, and money " +
    "documents never post on their own (plugs.held-payment). No call reports usage outward; the site's own telemetry is off (sites.privacy). " +
    "Assumption, not yet tested: the doorCall and doorReport methods; the spike proved applyEvent, the sign-in and the held payment, and the " +
    "door's design awaits the spike's door section.",
  component: component_backend,
  system: "frappe",
  service: "FrappeSite",
  calls: {
    applyEvent: {
      about: "One outbox event, in order, to `capxul.api.chain_event`. Answers {applied, last_seq}; a repeated key answers applied:false and changes nothing; a seq ahead is 409 with {expected}. A hat event took 0.1 to 0.4 s (FINDINGS).",
      timeoutMs: 10_000,
      retries: { max: 3, backoff: "exponential" },
      p95Ms: 2_000,
      failures: [down, badSig, unusable, { when: "The handler raises: the site answers 500 and keeps the cursor where it was", error: error_PROVIDER_ERROR }],
    },
    readSite: {
      about: "The site as it stands: its Capxul app version, installed apps, Company, Capxul Feature rows and hat-role map version. Reads only.",
      timeoutMs: 5_000,
      retries: { max: 2, backoff: "exponential" },
      p95Ms: 2_000,
      failures: [down, badSig, unusable, { when: "The site has no Capxul app, or one older than the contract (its method is missing)", error: error_WRONG_STATE }],
    },
    doorCall: {
      about: "One document verb as the calling person, to `capxul.door.run`, idempotent by call_id. Frappe's permissions decide; a part that is off answers 403; a submit of a Safe Payment Entry is answered held.",
      timeoutMs: 15_000,
      retries: { max: 2, backoff: "exponential" },
      p95Ms: 3_000,
      failures: [
        down, badSig, unusable,
        { when: "The part that owns the DocType is switched off for this company (403 from the site's request guard)", error: error_FEATURE_NOT_AVAILABLE },
        { when: "Frappe refuses the person: a role they lack, a workflow that does not allow the action, a validation", error: error_ROLE_PERMISSION_DENIED },
        { when: "The DocType, the document or a field does not exist", error: error_INVALID_INPUT },
      ],
    },
    doorReport: {
      about: "List or run a report (General Ledger, Accounts Receivable, Salary Register) as the calling person, to `capxul.door.report`. Reads only; an off part is refused.",
      timeoutMs: 30_000,
      retries: { max: 1, backoff: "fixed" },
      p95Ms: 8_000,
      failures: [
        down, badSig, unusable,
        { when: "The report's part is switched off for this company", error: error_FEATURE_NOT_AVAILABLE },
        { when: "No such report, or a filter it does not take", error: error_INVALID_INPUT },
      ],
    },
  },
  fake:
    "No stand-in is needed: the fake is the real thing. The devnet runs a real Frappe bench in a container (the spike's `frappe/bin/up.sh`) with the Capxul app " +
    "installed, and each world's sites follow the world's clock (devnet.site-follows-world). What it cannot imitate is a customer's network and a real " +
    "outage of the machine; the `org-with-site-down` world stops the bench to imitate the second.",
  secrets: ["SITE_HMAC_SECRET"],
  was: [`${SPIKE} (INTERFACE.md: Core to Frappe, one endpoint; Frappe half)`],
});

export const integration_site_service = defineIntegration({
  id: "site-service",
  title: "The site service: creates, changes, saves and restores sites",
  about:
    "The service on the bench's machine (component:site-service), behind the Effect service `SiteService`, reached over HTTP with its own token. It does " +
    "what the spike's scripts do: `new-site.sh` (site, apps, Company, the Safe's bank account, the sign-in key, the names), `feature.sh` (switch a part on " +
    "or off), and, for a world, set and advance the clock the site reads and save and restore the site's database and files. Creating a site for an slug " +
    "that already has one is safe to repeat (7 s in the spike). Every call is idempotent by a request key. Assumptions not yet tested: dropping a site, the " +
    "clock and the snapshot calls (the spike's clock and snapshot sections were being written when this record was); creation measured 143 s cold on a laptop.",
  component: component_backend,
  system: "site-service",
  service: "SiteService",
  calls: {
    createSite: {
      about: "Create the Organization's site on its world's bench: apps, Company, the Safe's bank account, names, privacy settings, the hat-role map. Answers the hostname.",
      timeoutMs: 300_000,
      retries: { max: 1, backoff: "fixed" },
      p95Ms: 200_000,
      failures: [
        { when: "The service or the bench is down", error: error_PROVIDER_ERROR },
        { when: "The slug is taken by another Organization", error: error_INVALID_INPUT },
        { when: "The service answers something that is not its documented shape", error: error_PROVIDER_RESPONSE_INVALID },
      ],
    },
    configureSignIn: {
      about: "Write the site's Social Login Key for Capxul's provider (client id and secret, both addresses, sign-up denied) and show the login button.",
      timeoutMs: 30_000,
      retries: { max: 2, backoff: "exponential" },
      p95Ms: 10_000,
      failures: [{ when: "The service or the site is down", error: error_PROVIDER_ERROR }],
    },
    switchFeature: {
      about: "Make a feature reachable or not: set its Capxul Feature row, re-save every user, clear caches. Off keeps every record. 4.5 to 6 s in the spike.",
      timeoutMs: 60_000,
      retries: { max: 2, backoff: "exponential" },
      p95Ms: 10_000,
      failures: [
        { when: "The service or the site is down", error: error_PROVIDER_ERROR },
        { when: "The switch would break a dependency (WhatsApp needs CRM)", error: error_WRONG_STATE },
      ],
    },
    setClock: {
      about: "Set the clock the site reads to the world's now and rate; the world owns the clock and the site follows it. Assumption, not yet tested.",
      timeoutMs: 20_000,
      retries: { max: 2, backoff: "fixed" },
      p95Ms: 5_000,
      failures: [{ when: "The service or the site is down", error: error_PROVIDER_ERROR }],
    },
    saveSnapshot: {
      about: "Save the site's database and files under a snapshot name, as one part of a world's snapshot. Assumption, not yet tested.",
      timeoutMs: 300_000,
      retries: { max: 0, backoff: "none" },
      p95Ms: 60_000,
      failures: [{ when: "The service is down, or the disk is full", error: error_PROVIDER_ERROR }],
    },
    restoreSnapshot: {
      about: "Restore a site from a snapshot, in place or into a separate world under a new slug. Assumption, not yet tested.",
      timeoutMs: 300_000,
      retries: { max: 0, backoff: "none" },
      p95Ms: 90_000,
      failures: [{ when: "The service is down", error: error_PROVIDER_ERROR }, { when: "The snapshot names no site of this Organization", error: error_INVALID_INPUT }],
    },
    dropSite: {
      about: "Remove a site from the bench. Used by tests and by a world's teardown; never by a customer's command. Assumption, not yet tested.",
      timeoutMs: 120_000,
      retries: { max: 0, backoff: "none" },
      p95Ms: 30_000,
      failures: [{ when: "The service is down", error: error_PROVIDER_ERROR }],
    },
  },
  fake:
    "A local run of the real service on the developer's bench container: the same script, on a bench with a short app list. What it cannot imitate is " +
    "the production machine's disk and memory; creation was measured on a laptop only (docs/mission/cloud.md).",
  secrets: ["SITE_SERVICE_TOKEN"],
  was: [`${SPIKE} (Frappe half: Numbers measured; INTERFACE.md: Creating an org)`],
});
