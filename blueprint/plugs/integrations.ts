// The two outside systems the plugs and the sites talk to: the Frappe site itself (through the Capxul app on it) and the site
// service that creates and runs sites. `frappe-site` replaces the old `frappe-head`, which was written for an optional outside
// head with its own API key and a sync of Capxul's own tables; a site is Capxul's now (aaron.frappe-native, aaron.one-door).
// Both are reached only from the backend (component:backend); the CLI and SDK reach the site through the backend, never directly.

import { defineIntegration } from "../../packages/blueprint-engine/src/index.ts";
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
    "always calls: every call goes from the service to the site and the site never needs to reach the service (plugs.service-calls-site; precedent: the old head design, 'Capxul always calls; the head only rings a doorbell'). Nothing the site holds is copied into " +
    "Capxul's tables: Frappe owns its documents. `applyEvent` is how the chain reaches the books and the roles. `doorCall` and `doorReport` run " +
    "the person's own call: the app sets the session user to the Frappe user that person's hat created, so Frappe's permissions decide, and money " +
    "documents never post on their own (plugs.held-payment). A person's call also carries `X-Capxul-Assertion`: the service signs {user, site, expiry 60 s, nonce}; the site checks the signature, the site name, the expiry (host time, on purpose) " +
    "and that the User is enabled and wears at least one hat, then runs as that User; nothing is stored for the person (plugs.door-assertion). No call reports usage outward; the site's own telemetry is off (sites.privacy). " +
    "Proved by the spike: applyEvent, the sign-in, the held payment and the door (doorCall, doorReport). Not tried, assumptions with a named test: collectPaymentRequests and answerPaymentRequest (the site's outbox, proved by m3-site-stops-calling) and mintViewLink (the viewer eval).",
  component: component_backend,
  system: "frappe",
  service: "FrappeSite",
  calls: {
    applyEvent: {
      about: "POST capxul.api.chain_event: {applied,duplicate,last_seq}; applied repeats set duplicate:true. Parked repeats retain parked:true and error, never a successful duplicate. Hat grants return map_version. A seq ahead is 409 with {expected}.",
      timeoutMs: 10_000,
      retries: { max: 3, backoff: "exponential" },
      p95Ms: 2_000,
      failures: [down, badSig, unusable, { when: "The handler raises: the site answers 500 and keeps the cursor where it was", error: error_PROVIDER_ERROR }],
    },
    retryParkedEvent: {
      about: "POST capxul.api.retry_parked_event {org,event_key}. Reruns the saved event under the cursor lock without changing its sequence or data. Only successful real application and fallback-bank reconciliation repair it; failure remains parked. The delivery cursor never rewinds.",
      timeoutMs: 10_000,
      retries: { max: 3, backoff: "exponential" },
      p95Ms: 2_000,
      failures: [down, badSig, unusable],
    },
    collectPaymentRequests: {
      about: "POST capxul.api.collect_payment_requests {org,after:0,limit:100}: {requests,cursor}. Immutable prepare bodies carry request_id, trace_id, idempotency_key and a locked integer cursor. Collect on connect and hints; advance after durable prepare and answer, never on read.",
      timeoutMs: 30_000,
      retries: { max: 3, backoff: "exponential" },
      p95Ms: 5_000,
      failures: [down, badSig, unusable],
    },
    answerPaymentRequest: {
      about: "POST capxul.api.answer_payment_request {org,request_id,approval_id,approval_url,requested_by,awaiting?} or {org,request_id,error:{code,message}}: {request_id,status,duplicate}. Exact retries succeed; conflicts refuse. Preserves settled state and newer drafts. Carries X-Capxul-Trace.",
      timeoutMs: 10_000,
      retries: { max: 3, backoff: "exponential" },
      p95Ms: 2_000,
      failures: [down, badSig, unusable],
    },
    paymentRequestListener: {
      about: "POST capxul.api.payment_request_listener {org}: {authorization,namespace,event,expires_at}. A 60-second site-bound token authenticates only Socket.IO's get_user_info callback as a role-free Website User. Its private room gets capxul_payment_request {org,cursor} after commit.",
      timeoutMs: 10_000,
      retries: { max: 3, backoff: "exponential" },
      p95Ms: 2_000,
      failures: [down, badSig, unusable],
    },
    mintViewLink: {
      about: "Ask the site to mint a one-time sign-in link for a person who only watches (a viewer grant), read-only, expiring. Answers the link; the site never calls the service.",
      timeoutMs: 10_000,
      retries: { max: 2, backoff: "exponential" },
      p95Ms: 2_000,
      failures: [down, badSig, unusable, { when: "The person has no viewer or site user for this Organization", error: error_ROLE_PERMISSION_DENIED }],
    },
    readHatMap: {
      about: "POST capxul.service.read_hat_map: {map_version,hats,available_roles} from release data and native Roles. Verify admitted hash, exact map and availability or refuse PROVIDER_RESPONSE_INVALID. No numeric-hat admission, departments, job/scope or people.",
      timeoutMs: 5_000,
      retries: { max: 2, backoff: "exponential" },
      p95Ms: 2_000,
      failures: [down, badSig, unusable],
    },
    readSite: {
      about: "POST capxul.service.read_site: Capxul app version, installed apps, Company, feature rows, map_version and sign_in:{mode:'assertion',configured,oauth}. Observe the actual assertion hook and legacy OAuth row, never infer sign-in from provisioning. Reads only.",
      timeoutMs: 5_000,
      retries: { max: 2, backoff: "exponential" },
      p95Ms: 2_000,
      failures: [down, badSig, unusable, { when: "The site has no Capxul app, or one older than the contract (its method is missing)", error: error_WRONG_STATE }],
    },
    resolveAccount: {
      about: "POST capxul.product_door.account {org,reference} as the asserted person. Resolve name/number to one enabled ledger Account in the site's Company, with permission-filtered lookup and document read check. Normal document envelope; canonical Account.name, no chart cache or caller-chosen Company.",
      timeoutMs: 15_000,
      retries: { max: 2, backoff: "exponential" },
      p95Ms: 3_000,
      failures: [down, badSig, unusable,
        { when: "The person cannot read the Account", error: error_ROLE_PERMISSION_DENIED },
        { when: "The reference names no unique enabled ledger Account in this Company", error: error_INVALID_INPUT },
      ],
    },
    doorCall: {
      about: "POST capxul.product_door.run as the asserted person, idempotent by call_id. Native permissions apply; an off part is 403. Safe submit returns an asynchronous request receipt; Core resolves its saved answer to held. Message: {ok:true,data} or {ok:false,error:{code,message}}.",
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
      about: "POST capxul.product_door.report as the asserted person. Run General Ledger, Accounts Receivable or Salary Register. Reads only; an off part is refused. Message: {ok:true,data:{columns,rows}} or {ok:false,error:{code,message}}.",
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
    "outage of the machine; the `org-with-site-down` template stops the bench to imitate the second.",
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
    "that already has one is safe to repeat (7 s in the spike). Every call is idempotent by a request key. Proved by the spike: creation (143 s cold, 47 s from a company template, 7 s to repeat), the feature switch, the clock, snapshots and dropping a site. " +
    "Not tried, assumptions with a named test: registering a world and parking idle sites (m3b-first-shared-world). " +
    "Explicit restore rebases saved approval links while paused (plugs.answer-origin): a nonempty browser_core_url replaces only scheme and authority in Capxul Payment Request.approval_url, its nonempty answer_json, and Payment Entry.capxul_approval_url together. Paths, queries, fragments, approval identities, statuses and accounting stay unchanged. Empty leaves links unchanged. The site never calls Core; only the recovery adapter resumes the scheduler.",
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
    registerWorld: {
      about: "A local devnet registers itself as a world with the hosted service: a world id, a secret and a name are issued, and its sites are created on the hosted bench. Assumption, not yet tested: m3b-first-shared-world.",
      timeoutMs: 30_000,
      retries: { max: 2, backoff: "exponential" },
      p95Ms: 5_000,
      failures: [{ when: "The service is down", error: error_PROVIDER_ERROR }, { when: "The name or id is taken, or has a hyphen", error: error_INVALID_INPUT }],
    },
    parkSites: {
      about: "Park a world's idle sites (no call for the stated time, 30 minutes assumed): the bench stops serving them and keeps their data; a later call wakes them. Assumption, not yet tested: m3b-first-shared-world.",
      timeoutMs: 60_000,
      retries: { max: 1, backoff: "fixed" },
      p95Ms: 20_000,
      failures: [{ when: "The service is down", error: error_PROVIDER_ERROR }],
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
      about: "Push epoch/version and the capped rate clock to every site at every stop; return idle and next due after jobs finish. Idempotent by world/epoch/version; reject stale versions. devnet.site-clock-follower specifies the persistent adapter. Rate and barrier following are designed, not yet proved.",
      timeoutMs: 20_000,
      retries: { max: 2, backoff: "fixed" },
      p95Ms: 5_000,
      failures: [{ when: "The service or the site is down", error: error_PROVIDER_ERROR }],
    },
    saveSnapshot: {
      about: "Save the site's database, files and site config under a snapshot name, one part of a world's snapshot. Proved by the spike; the copy holds the site's encryption key, so it is sensitive.",
      timeoutMs: 300_000,
      retries: { max: 0, backoff: "none" },
      p95Ms: 60_000,
      failures: [{ when: "The service is down, or the disk is full", error: error_PROVIDER_ERROR }],
    },
    restoreSnapshot: {
      about: "Restore in place or into a separate world under a new slug, rewriting name, config, clock and saved approval origins together while paused (plugs.answer-origin). Keep approval identity, statuses and accounting. Proved by the spike: 33 s a site; link migration has a restore regression.",
      timeoutMs: 300_000,
      retries: { max: 0, backoff: "none" },
      p95Ms: 90_000,
      failures: [{ when: "The service is down", error: error_PROVIDER_ERROR }, { when: "The snapshot names no site of this Organization", error: error_INVALID_INPUT }],
    },
  },
  fake:
    "A local run of the real service on the developer's bench container: the same script, on a bench with a short app list. What it cannot imitate is " +
    "the production machine's disk and memory; creation was measured on a laptop only (docs/mission/cloud.md).",
  secrets: ["SITE_SERVICE_TOKEN"],
  was: [`${SPIKE} (Frappe half: Numbers measured; INTERFACE.md: Creating an org)`],
});
