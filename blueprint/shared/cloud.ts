// Deployment inventory, not a claim that the designed services are deployed.
import { defineComponent, defineDecision, defineEnvironment } from "../../packages/blueprint-engine/src/index.ts";
import * as f from "./foundation.ts";

export const component_sites_host = defineComponent({
  id: "sites-host", title: "AWS sites machine",
  runtime: "AWS Lightsail, eu-west-1, Ubuntu 24.04, 4 CPU / 16 GiB / 320 GB",
  exposes: ["http"], dependsOn: [],
  about: "Real as recorded 10 November 2026: worlds-host-ireland, stack capxul-worlds-host, static IP 34.249.131.57. Docker and Compose installed; /srv/capxul volumes and tls directories prepared. No product containers, bench, monitoring or backups running. Planned: one Frappe bench (web, workers, scheduler, socket server, MariaDB and Redis), plus each world's chain, Capxul service, clock and append-only record, and an HTTPS proxy. Stand-ins: test identity and external services, never real money. Needs Aaron: real access control and notified alarms before wider access; snapshots approval before real data. Cloud firewall and ufw admit operator /32 only on 22, 80, 443; a changed operator IP needs both updated.",
  was: ["docs/mission/sites-host/STATE.md", "docs/mission/sites-host/compose.md"],
});
export const component_sites_ingress = defineComponent({
  id: "sites-ingress", title: "Sites catch-all route, DNS and certificate",
  runtime: "Route 53 DNS; planned HTTPS proxy on sites-host", exposes: ["http"], dependsOn: [component_sites_host],
  about: "Real as recorded 10 November 2026: worlds.capxul.com delegated by Namecheap to Route 53 zone Z033083453DGJI3WUU2O (stack capxul-worlds-dns). Bare and wildcard A records, TTL 300, point directly to 34.249.131.57, not the controller. Public Let's Encrypt certificate covers bare and wildcard names, issued by DNS challenge on operator's Mac, copied to /srv/capxul/tls; expires 8 February 2027 at 11:06 UTC, renew by 9 January. No proxy serves it yet and renewal is manual, not automated. Planned catch-all preserves Host for Frappe selection: <company>-<world>.worlds.capxul.com; no per-company DNS, route or certificate. World id w plus digits, last hyphen separates world, label <=63 characters; registry is authority. Stand-in: no live ingress. Needs Aaron: notification email and access policy before public opening. Controller Traefik route, DNS resolver and verified private-origin TLS in ingress.md are an alternative draft, not deployed; never disable certificate verification.",
  was: ["docs/mission/sites-host/STATE.md", "docs/mission/sites-host/ingress.md"],
});
export const component_sites_backup = defineComponent({
  id: "sites-backup", title: "Sites backup and restore",
  runtime: "Planned controller nightly timer to private S3 daily/sites/", exposes: ["none"], dependsOn: [component_sites_host],
  about: "Real: existing hosting backup bucket uses SSE-S3, versioning, 30-day daily retention and 7-day noncurrent retention; sites-host is NOT enrolled and has no snapshots. Draft only: controller streams each paused world's MariaDB dumps, site files/config, chain, append-only record, named snapshots, registry and clock, common bench config and image receipt; hashes/manifest uploaded last. Resume in finally even on failure. Do not include rebuilt assets or registry images. Restore whole world using pinned receipt images, database users and dumps, site files, chain, record and clock before resume. A single company restores dump plus folder without rewinding shared record. Weekly isolated restore verifies hashes, database Company/tables, chain and clock, record integrity and optionally bench list-apps, writes recovery receipt and removes isolated resources. Stand-in: draft scripts, not recovery evidence; pause/copy consistency and integrity verifier still need proof. Needs Aaron: approve backup storage/restore-check spend, least-privilege controller access including AbortMultipartUpload, and notified failure alarms. No production RPO/RTO promised.",
  was: ["docs/mission/sites-host/backup.md", "docs/mission/sites-host/STATE.md"],
});
export const environment_worlds = defineEnvironment({
  id: "worlds", title: "Hosted simulated worlds",
  about: "Real: provisioned AWS host, DNS and unserved certificate only (10 November 2026). No deployed bench or product. Target is several isolated simulated worlds sharing one bench, each with its own chain, clock, companies and record. Stand-ins: test sign-in, mail and external channels; nothing real leaves a world. Operator-only firewall is essential while test sign-in permits impersonation. Needs Aaron: access control before wider exposure, notification email, backup/monitoring spending. Not the old Convex worker described in cloud.md, nor evidence that shared-world's older Postgres topology is installed.",
  runs: [
    { component: f.component_site_service, on: "Planned site lifecycle service on the shared bench host; not deployed. Creates, configures, parks, snapshots and removes company sites." },
    { component: component_sites_host, on: "Real machine only; planned shared bench and per-world services are not running." },
    { component: component_sites_ingress, on: "Real DNS and certificate; planned Host-preserving catch-all proxy not running." },
    { component: component_sites_backup, on: "Draft only; no nightly backup or verified restore yet." },
    { component: f.component_frappe_app, on: "Planned real Frappe/ERPNext/Capxul bench with a site per company; not installed." },
  ],
  config: ["CAPXUL_ENV", "SITE_URL"], secrets: [],
  deploy: "Follow sites-host/compose.md rehearsal before installing pinned images under /srv/capxul. Supply credentials outside the repository; empty secrets here is not a credential inventory. Keep operator-only access until real authentication; rehearse consistent world backup/restore before real data.",
  was: ["docs/mission/sites-host/README.md", "docs/mission/sites-host/STATE.md"],
});
export const environment_production = defineEnvironment({
  id: "production", title: "Production (not provisioned)",
  about: "Real: no new production deployment evidenced. Target: a second machine using the same pinned images as worlds, with real-time clock and real integrations, separate data and credentials, never simulated identities or test money. Stand-in: this is a deployment plan only, not a live environment. Needs Aaron: approve host/spend, domain, chain and provider accounts, access policy, secrets custody, retention, recovery objectives and go-live after restore rehearsal. Do not infer a production network or address from old staging.",
  runs: [
    { component: f.component_site_service, on: "Planned site lifecycle service on the separate production bench host, with real-time sites and isolated credentials; not deployed." },
    { component: component_sites_host, on: "Planned separate real-time machine, not worlds-host-ireland; no production host allocated." },
    { component: component_sites_ingress, on: "Planned production DNS and verified TLS; no domain/certificate allocated." },
    { component: component_sites_backup, on: "Planned separate backup scope and tested restore; retention/RPO/RTO need approval." },
    { component: f.component_frappe_app, on: "Planned real bench and company sites on second machine using tested images." },
  ],
  config: ["CAPXUL_ENV", "SITE_URL"], secrets: [],
  deploy: "Not deployable yet. Promote tested image digests only after access controls, real integration configuration, isolated restore rehearsal, monitoring and Aaron's go-live approval. Secrets must be supplied out of band; none are recorded here.",
  was: ["docs/mission/sites-host/README.md"],
});
export const decision_cloud_inventory = defineDecision({
  id: "cloud.inventory", title: "Record deployment facts separately from target topology",
  question: "How should AWS machines, ingress and recovery be represented without mistaking drafts for live services?",
  options: [
    { label: "components", text: "Use running-piece component records for host, ingress/DNS/TLS and backup, environment runs for placement, and explicit dated reality/stand-in/owner boundaries." },
    { label: "documents", text: "Keep infrastructure only in deployment prose outside the book." },
  ], chosen: "components",
  why: "Exit g1 includes deployment. Existing component and environment schemas suffice; machine is reserved for business state machines, not AWS instances. STATE.md supersedes draft controller ingress. cloud.md inventories the old system, not a deployed Frappe target. Production is deliberately planned, never fabricated. The Architecture page must expose these records' about and deploy text as well as the existing placement matrix so status and Aaron dependencies remain visible.",
  source: "m1-aws-records; docs/mission/sites-host/STATE.md (10 November 2026), README.md, ingress.md, backup.md; docs/mission/cloud.md",
  affects: [component_sites_host, component_sites_ingress, component_sites_backup, environment_worlds, environment_production, f.environment_staging],
});
