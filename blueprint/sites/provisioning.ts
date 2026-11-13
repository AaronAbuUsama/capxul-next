import { Schema } from "effect";
import { budget, defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import { concept_sites } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_PROVIDER_ERROR, error_PROVIDER_RESPONSE_INVALID, error_ROLE_PERMISSION_DENIED } from "../shared/vocabulary.ts";
import { table_org_deployments } from "../organizations/data.ts";
import { integration_site_service } from "../plugs/integrations.ts";
import { BY, operation, rpc, WORLD } from "../plugs/kit.ts";

export const rpc_sites_provision = rpc({
  id: "sites.provision", title: "Provision the site for a company already born on chain", concept: concept_sites,
  about: "Slice zero's public provisioning stage after the chain fixture registers the company's trusted directory with Core. The caller signs an origin-bound request expiring within 60 seconds. Core verifies the registered founder and ownership of the founder Safe and company Safe, calls the private bench-local site service, then releases delivery. The SDK and CLI hold no bench password, site-service token or Core admin secret. Repeating the same company finishes a failed creation without changing its identity. This is not the full org.create onboarding flow and does not mint a company or prove first-event delivery.",
  kind: "mutation", who: "The registered founder, whose key owns the founder Safe that owns the company Safe.",
  input: Schema.Struct({ org: Schema.String }),
  output: Schema.Struct({ org: Schema.String, safe: Schema.String, site: Schema.String, url: Schema.String, state: Schema.Literal("provisioned") }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, error_PROVIDER_ERROR, error_PROVIDER_RESPONSE_INVALID],
  reads: [table_org_deployments], calls: [integration_site_service.c.createSite], spans: ["rpc.sites.provision"],
});

export const operation_org_site_provision = operation({
  id: "org.site.provision", title: "Provision a company's site through Core", area: "organizations", command: "org site provision", priority: "critical",
  about: "The narrow site-creation stage used by slice zero after company birth and trusted Core registration. Requires --org and --confirm. It does not shell into bench, mint a company, or claim a ready site before delivery applies its first events.",
  who: "The registered founder.", changes: "Creates or finishes the company's site and releases Core delivery.", implementedBy: rpc_sites_provision,
  acceptance: [
    { claim: "A founder provisions the registered company's site without bench credentials; a repeat preserves its identity.", observes: "cli: org site provision --org acme --confirm --json returns the registered Safe and acme-main.<base> with state provisioned; repeating it returns the same site and Safe. read: Frappe's Company and Safe bank account match Core. No private site-service token or bench password is present in the caller environment." },
    { claim: "A failed provisioning can be retried without releasing an incomplete site.", observes: "Stop the bench before provisioning: the command fails PROVIDER_ERROR and Core remains unreleased. Restart the bench and repeat: the same site is completed and delivery is released." },
  ],
  returns: rpc_sites_provision.output,
  refusals: [
    { error: error_NOT_AUTHENTICATED, given: WORLD.signedOut, when: "The request is unsigned, expired or altered." },
    { error: error_ROLE_PERMISSION_DENIED, given: WORLD.member, when: "The caller is not the registered founder or does not own the founder Safe which owns the company Safe." },
    { error: error_INVALID_INPUT, given: WORLD.siteReady, when: "The company is not registered or its deterministic site has a different identity." },
  ], errors: [error_PROVIDER_ERROR], budget: budget("background"),
});

export const decision_sites_provisioning_boundary = defineDecision({
  id: "sites.provisioning-boundary", title: "A public provisioning stage calls a private bench-local service",
  question: "How does slice zero replace the spike CLI's privileged site scripts without claiming full onboarding?",
  options: [
    { label: "narrow-stage", text: "Keep chain birth as the v4 fixture; register its trusted directory in Core, then provision through the signed public SDK/CLI stage. Only the private service executes bench with fixed argument arrays. Store immutable creation intent before acting; retry the same identity, reject a changed Safe, name or founder. Mark provisioned, not ready; first-event delivery remains Core's responsibility. No site-to-Core URL or OAuth callback is configured. SIGINT and SIGTERM stop new service ingress and drain accepted creation work before a clean exit; shutdown never terminates bench work early." },
    { label: "cli-shell", text: "Keep bench admin credentials and shell orchestration in the CLI." },
  ], chosen: "narrow-stage",
  why: "Aaron's aaron.one-door and aaron.frappe-native require one public caller surface and hosted sites. The slice-zero brief requires a narrow service now; replacing all company onboarding, funding and approvals is outside this provisioning stage. Immutable intent and direct argv execution prevent a retry from taking over another company's site or interpreting caller text as a shell command.",
  source: BY("slice-zero site provisioning brief, 12 November 2026; spikes/skeleton/core/src/cli.ts orgCreate"),
  affects: [concept_sites, rpc_sites_provision, operation_org_site_provision, integration_site_service],
});

export const decision_sites_provisioning_long_wait = defineDecision({
  id: "sites.provisioning-long-wait", title: "Provisioning waits up to 30 minutes for the site, not Node fetch's 300 s",
  question: "How long do Core's call to the site service and the caller's call to Core wait for one site creation?",
  options: [
    { label: "thirty-minutes", text: "Both calls hold the request open for the whole creation, bounded by one 30-minute budget and an idle limit of the same length, so a slow bench finishes rather than leaving a half-reported creation. Node callers use a request that has no 300 s header limit (`longFetch` in `@capxul/sdk/node`). A failure with no declared code (a transport or runtime error) is logged in Core with the request's trace, the error's name and its cause's code, never its message, address or headers." },
    { label: "five-minutes", text: "Keep 300 s. A creation that takes longer fails PROVIDER_ERROR while the site service goes on to finish it, and the caller must repeat the same company to see the result." },
    { label: "answer-early-and-poll", text: "Answer /sites/create at once with a creation state the caller polls. No request is held open, but it adds a durable job state and a poll protocol to the service and the SDK." },
  ], chosen: "thirty-minutes",
  why: "Node's fetch (undici 7.30.1) has a default headersTimeout of 300 s, which ends a request before its 30-minute AbortSignal. Measured on 13 November 2026: creation took 4 min 08 s on a healthy orb and 5 min 20 s on a loaded one; two runs failed at 301 s, once at Core's call to the site service and once at the CLI's call to Core, while the site service finished the site 19 s later. A repeat recovers, but every full acceptance attempt on a loaded orb failed here. Holding the request open is the smallest change that matches the existing 30-minute budget; polling stays open for when creation moves off the request path. The call's p95 (200 s) is unchanged here, although measured creations exceed it.",
  source: BY("Runtime lane reports on worlds w2clock and w3clock, 13 November 2026; packages/sdk/src/shared/long-fetch.ts"),
  affects: [concept_sites, rpc_sites_provision, operation_org_site_provision, integration_site_service],
});
