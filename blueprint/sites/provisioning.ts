import { Schema } from "effect";
import { budget, defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import { concept_sites } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_PROVIDER_ERROR, error_PROVIDER_RESPONSE_INVALID, error_ROLE_PERMISSION_DENIED } from "../shared/vocabulary.ts";
import { table_org_deployments } from "../organizations/data.ts";
import { integration_site_service } from "../plugs/integrations.ts";
import { BY, operation, rpc, WORLD } from "../plugs/kit.ts";

export const rpc_sites_provision = rpc({
  id: "sites.provision", title: "Provision the site for a company already born on chain", concept: concept_sites,
  about: "Slice zero's public provisioning stage after the chain fixture registers the company's trusted directory with Core. The caller presents an Access Bearer session. Core authenticates it on the canonical world clock and admits only the company setup's founder principal, once the setup has deployed its money and not failed, or a principal holding a current Seat in the company (sites.provision-principal). It then calls the private bench-local site service and releases delivery. The SDK and CLI hold no bench password, site-service token or Core admin secret. Repeating the same company finishes a failed creation without changing its identity. This is not the full org.create onboarding flow and does not mint a company or prove first-event delivery.",
  kind: "mutation", who: "The company setup's founder principal, or a person or agent with a current Seat in the company, authenticated by an Access Bearer session.",
  input: Schema.Struct({ org: Schema.String }),
  output: Schema.Struct({ org: Schema.String, safe: Schema.String, site: Schema.String, url: Schema.String, state: Schema.Literal("provisioned") }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, error_PROVIDER_ERROR, error_PROVIDER_RESPONSE_INVALID],
  reads: [table_org_deployments], calls: [integration_site_service.c.createSite], spans: ["rpc.sites.provision"],
});

export const operation_org_site_provision = operation({
  id: "org.site.provision", title: "Provision a company's site through Core", area: "organizations", command: "org site provision", priority: "critical",
  about: "The narrow site-creation stage used by slice zero after company birth and trusted Core registration. Requires --org and --confirm. It does not shell into bench, mint a company, or claim a ready site before delivery applies its first events.",
  who: "The founder of the company's deployed setup, or a person or agent with a current Seat in the company.", changes: "Creates or finishes the company's site and releases Core delivery.", implementedBy: rpc_sites_provision,
  acceptance: [
    { claim: "A founder provisions the registered company's site without bench credentials; a repeat preserves its identity.", observes: "cli: org site provision --org acme --confirm --json returns the registered Safe and acme-main.<base> with state provisioned; repeating it returns the same site and Safe. read: Frappe's Company and Safe bank account match Core. No private site-service token or bench password is present in the caller environment." },
    { claim: "A failed provisioning can be retried without releasing an incomplete site.", observes: "Stop the bench before provisioning: the command fails PROVIDER_ERROR and Core remains unreleased. Restart the bench and repeat: the same site is completed and delivery is released." },
  ],
  returns: rpc_sites_provision.output,
  refusals: [
    { error: error_NOT_AUTHENTICATED, given: WORLD.signedOut, when: "No Access Bearer session is presented, or it ended or expired." },
    { error: error_ROLE_PERMISSION_DENIED, given: WORLD.member, when: "The caller is neither the founder of the company's deployed, unfailed setup nor holds a current Seat in the company." },
    { error: error_INVALID_INPUT, given: WORLD.siteReady, when: "The company is not registered or its deterministic site has a different identity." },
  ], errors: [error_PROVIDER_ERROR], budget: budget("background"),
});

export const decision_sites_provisioning_boundary = defineDecision({
  id: "sites.provisioning-boundary", title: "A public provisioning stage calls a private bench-local service",
  question: "How does slice zero replace the spike CLI's privileged site scripts without claiming full onboarding?",
  options: [
    { label: "narrow-stage", text: "Keep chain birth as the v4 fixture; register its trusted directory in Core, then provision through the Bearer-authenticated public SDK/CLI stage. Only the private service executes bench with fixed argument arrays. Store immutable creation intent before acting; retry the same identity, reject a changed Safe, name or founder. Mark provisioned, not ready; first-event delivery remains Core's responsibility. No site-to-Core URL or OAuth callback is configured. SIGINT and SIGTERM stop new service ingress and drain accepted creation work before a clean exit; shutdown never terminates bench work early." },
    { label: "cli-shell", text: "Keep bench admin credentials and shell orchestration in the CLI." },
  ], chosen: "narrow-stage",
  why: "Aaron's aaron.one-door and aaron.frappe-native require one public caller surface and hosted sites. The slice-zero brief requires a narrow service now; replacing all company onboarding, funding and approvals is outside this provisioning stage. Immutable intent and direct argv execution prevent a retry from taking over another company's site or interpreting caller text as a shell command.",
  source: BY("slice-zero site provisioning brief, 12 November 2026; spikes/skeleton/core/src/cli.ts orgCreate"),
  affects: [concept_sites, rpc_sites_provision, operation_org_site_provision, integration_site_service],
});

export const decision_sites_provision_principal = defineDecision({
  id: "sites.provision-principal", title: "Provisioning admits an Access principal, not a wallet signature",
  question: "Who may provision a company's site now that people authenticate through Access sessions with no signer binding?",
  options: [
    { label: "founder-or-seat", text: "Core authenticates the raw Bearer with Access on the canonical world clock, on the same checked-out Sql. It admits the principal named founder by the company's setup once that setup has deployed its money and has not failed, or any principal Organizations finds holding a current Seat in the company. A removed founder loses the Seat and is refused after setup completes. The SDK and CLI send only the person's Access session; no wallet key, signature or bench credential." },
    { label: "eip191-founder", text: "Keep the origin-bound EIP-191 signature from the founder's EOA and the on-chain Safe-ownership walk. A human Access principal has a null signerAddress by schema, so this refuses every human founder on the selected stack and keeps a second identity system beside Access." },
    { label: "seat-only", text: "Require a current Seat. The founder's Seat is only born when the setup completes, so this refuses the founder for the whole window in which the site is provisioned." },
  ],
  chosen: "founder-or-seat",
  why: "Access is the one authentication for people (sites.document-principal); Organizations owns who the founder is and who holds a Seat (requireSeat, readSetupFounder). Provisioning happens after money deployment but before setup completion, so only the founder-or-Seat rule admits the founder at that moment without reviving the wallet path.",
  source: "Wave Zero integrator ruling, 13 November 2026; Access lane (authenticate, null human signerAddress); Organizations lane (org_setups.founder_principal_id, requireSeat, readSetupFounder in PR96).",
  affects: [concept_sites, rpc_sites_provision, operation_org_site_provision],
});
