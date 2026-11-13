// The world's decisions: the coordinator's, on Aaron's delegation, accepting the eight recommendations of docs/mission/worlds.md (section 7). The owner's words
// they rest on, quoted in that file: a world is "all companies connected to one chain, with one clock and one record. Not one company." Rulings they serve:
// aaron.world-clock (everything in a world follows its one clock), aaron.one-door and aaron.seasons. Where the note says a thing is untested it is marked here.

import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import * as f from "../shared/foundation.ts";
import { BY } from "../plugs/kit.ts";
import { integration_devnet_control } from "../shared/external.ts";
import { integration_site_service } from "../plugs/integrations.ts";
import * as d from "./world-data.ts";
import { table_record_entries } from "./record-entry.ts";

export const decision_devnet_telemetry_contract = defineDecision({
  id: "devnet.telemetry-contract", title: "Named execution spans and a validated record wire format",
  question: "How do telemetry declarations and actual command entries stay checkable?",
  options: [{ label: "explicit", text: "Every reachable rpc and SDK flow names an execution span, rpc.<id> or sdk.<id>, retaining existing finer-grained spans. Events remain the explicit emits and driven transition events, including an empty set for reads; do not invent analytics events. The record-entries table books the spike's nested v1 wire fields separately from command-records' future searchable projection. Validate every serialized append, including restore lineage, against it after redaction." }],
  chosen: "explicit",
  why: "docs/mission/worlds.md section 6 calls the record training data. m1-telemetry requires zero silent operations and real entries conforming to the book, not an assertion that a flattened future projection is already emitted. Execution spans cover the whole named implementation, excluding separately declared waits from system budgets.",
  source: BY("docs/mission/worlds.md section 6; m1-telemetry"),
  affects: [table_record_entries, d.table_command_records],
});

export const decision_devnet_catalogue_storage = defineDecision({
  id: "devnet.catalogue-storage", title: "The supervisor owns its catalogue in the world's Postgres database",
  question: "Where do the declared worlds, world-snapshots and command-records tables live alongside Core's narrower recovery tables?",
  options: [{ label: "additive-world-catalogue", text: "The devnet package migrates app.worlds, app.world_snapshots and app.command_records only during fresh creation, after Core's migration. SQL names replace the blueprint's hyphens with underscores. The existing restricted capxul_worker role writes the catalogue through the supervisor; capxul_core can read it but cannot write it. Core's app.world, app.world_record and per-company app.records remain independent and are not substituted for these tables. Every catalogue operation names its world. Commands are appended in a transaction serialized per world; sequence is gap-free per epoch, prev is SHA-256 of the preceding row's canonical JSONB excluding branch_abandoned, and that flag alone may change when retaining an abandoned branch. Snapshot and world mutations commit with their command entry. A transition's authoritative world_transitioned event is stored under that entry's changes.events, with trace_id and the declared props, in the same transaction. Runtime publication reads committed events, never guesses one from an exit code. Restore never reruns either migration. A clone keeps parent provenance and begins creating with a born entry, then starts only after runtime recovery succeeds; an in-place restore preserves the complete hash-checked abandoned command branch and advances the epoch. The restored catalogue supplies its own exact epoch/sequence/head; Core's financial record cut is never substituted. Provenance serializes that computed public digest with a 0x prefix so the shared credential sanitizer preserves it; actual known key values remain redacted." }],
  chosen: "additive-world-catalogue",
  why: "Aaron's Postgres/Ponder ruling puts the world's durable state together. The slice-zero audit requires the exact declared fields, keys and indexes, not a passing proof of Core's smaller lifecycle record. A separate devnet-owned migration avoids making unrelated Core tables or permissions part of this change. Runtime writes use the existing worker role rather than an admin connection. In-place restore retains newer snapshot metadata alongside the abandoned command history, because their immutable host-local bundles remain available; a conflicting saved snapshot row refuses the entire import.",
  source: BY("aaron.postgres-and-ponder; slice-zero devnet binding audit, 12 November 2026"),
  affects: [d.table_worlds, d.table_world_snapshots, d.table_command_records],
});
import * as r from "./world-rpcs.ts";
import * as o from "./world-ops.ts";
import * as w from "./world-processes.ts";

export const decision_devnet_local_world_view = defineDecision({
  id: "devnet.local-world-view", title: "A local world view reports stored facts and configured company addresses",
  question: "Which authority supplies a stopped world's public view and complete company inventory?",
  options: [{ label: "selected-world-facts", text: "world show [ID] --config FILE reads only the database selected by the private config; an explicit ID or --world must match. It does not compose services, acquire the mutation lock, migrate or require running processes. The WorldView fields and current-epoch recordHead come from the actual world catalogue, not config defaults or Core's financial record sequence. Companies come through Organizations' complete typed world-inventory door on an actual capxul_worker connection, including released companies and core-only companies with no site. A tenant-filtered inventory is not a complete world view. A company's non-null stored site hostname is projected to the existing supervisor route http://<hostname>:<publicBench>; a null site yields url:null. This is the configured native address, not DNS, listener or HTTP readiness and not a shareable Amp portal. Neither config.sites nor financial records may invent company identity, name or site. Reads return only declared WorldView fields and refuse absent catalogue or inventory evidence without migration or backfill." }],
  chosen: "selected-world-facts",
  why: "The world-show contract promises lineage, clock, company addresses and record head while the chain is stopped. Catalogue facts and a complete Organizations-owned inventory preserve that promise without turning a read into startup or presenting partial tenant visibility and configured URLs as live readiness.",
  source: BY("aaron.one-cli; devnet.world-first-class; devnet.catalogue-storage"),
  affects: [o.operation_world_show, r.rpc_devnet_worlds_show],
});

export const decision_devnet_local_catalogue_reads = defineDecision({
  id: "devnet.local-catalogue-reads", title: "Local record and snapshot reads do not start a world",
  question: "How do local catalogue reads remain available while the chain is stopped?",
  options: [{ label: "restricted-offline-read", text: "The main CLI accepts record list|show|export --config FILE [--world ID] and world snapshot list [ID] --config FILE. The private local config selects exactly one world's database; an explicit world must match it. Reads use capxul_core, never migration credentials, and neither compose services nor take the mutation lock. Missing schema or world rows refuse without migration, backfill or financial-record substitution. List and show project the declared EntryView/SnapshotView wire fields; internal storage paths and credentials are not in those views. Record filters use inclusive world-time milliseconds, abandoned branches are opt-in for list, and show defaults to the current catalogue epoch unless --epoch is explicit. Export uses the catalogue's single-statement history snapshot, preserves all epochs and abandoned records, and creates --out as a new owner-private file without overwriting an existing file. Reads never append synthetic command entries." }],
  chosen: "restricted-offline-read",
  why: "The existing query contracts promise reads while the chain is stopped, a stable public view and a lineage-first training export. Requiring a private config keeps selection local without inventing a global registry; mutation locks and current-build startup checks must not turn reads into lifecycle operations.",
  source: BY("aaron.one-cli; devnet.record-home; devnet.catalogue-storage"),
  affects: [o.operation_record_list, o.operation_record_show, o.operation_record_export, o.operation_world_snapshot_list, r.rpc_devnet_records_list, r.rpc_devnet_records_show, r.rpc_devnet_records_export, r.rpc_devnet_worlds_snapshot_list],
});

const NOTE = "docs/mission/worlds.md, section 7";
const dec = (spec: { id: string; title: string; question: string; options: { label: string; text: string }[]; chosen: string; why: string; affects: readonly object[] }) =>
  defineDecision({ id: spec.id, title: spec.title, question: spec.question, options: spec.options, chosen: spec.chosen, why: spec.why, source: BY(NOTE), affects: spec.affects as never });
const WORLD_OPS = [o.operation_world_create, o.operation_world_list, o.operation_world_show, o.operation_world_register, o.operation_world_clock_set, o.operation_world_clock_freeze, o.operation_world_clock_resume, o.operation_world_clock_warp, o.operation_world_snapshot_save, o.operation_world_snapshot_list, o.operation_world_snapshot_restore];
const RECORD_OPS = [o.operation_record_list, o.operation_record_show, o.operation_record_export];

export const decision_devnet_site_clock_follower = dec({
  id: "devnet.site-clock-follower",
  title: "A persistent supervisor adapter puts sites inside the clock barrier",
  question: "How do hosted sites follow during a warp and between clock commands?",
  options: [{ label: "push-follower", text: "A supervisor-owned adapter joins timeFollow as stateful sites:<world>; it pushes setClock on every version and relays site idle and earliest next due to the authority." }],
  chosen: "push-follower",
  why:
    "F-1.2: a final clock write cannot implement devnet.warp-barrier. World creation starts the adapter before running; clock rpcs ensure it is attached, reusing its identity rather than joining twice. " +
    "It lives beyond the rpc and reconnects after supervisor restart. Every due stop, including intermediate warp stops, reaches every site before the adapter acknowledges idle; it aggregates the earliest site due and reports new due instants immediately. " +
    "Sites run due jobs to quiescence at the held instant, then acknowledge the matching epoch/version. A missing site or acknowledgement fails the barrier with its name; the authority retains its last settled stop under devnet.warp-barrier, never treats delivery failure as success. " +
    "setClock carries world, epoch, version, now, realAt, realNow, mode, rate and stopAt. Duplicate versions return the same acknowledgement; older versions are rejected. While running, sites use the capped formula, minute offset calibration and monotonic reads of devnet.follow-at-a-rate. " +
    "All traffic is initiated by the supervisor: it polls the site's due/idle result, so the hosted bench needs no inbound route to a laptop. The adapter handles save/restore as a stateful follower; restore changes epoch before resuming, and a new site receives the current clock before serving. " +
    "Core-only worlds have no site follower. This reconciles plugs.surface-gap-audit with the existing follower and warp contracts; rate and barrier delivery remain unproved design, not spike evidence.",
  affects: [integration_devnet_control, integration_site_service, w.workflow_devnet_worlds_create, r.rpc_devnet_worlds_clock_set, r.rpc_devnet_worlds_clock_freeze, r.rpc_devnet_worlds_clock_resume, r.rpc_devnet_worlds_clock_warp],
});

export const decision_devnet_world_first_class = dec({
  id: "devnet.world-first-class",
  title: "A world is a chain, its companies, one clock and one record, and is first-class",
  question: "What is a world, and what happens to the eval 'worlds' the book already names?",
  options: [
    { label: "world-is-chain-companies-clock-record", text: "A world is one chain with every company on it, sharing one clock and one record; never one company. A company (an Organization) lives in exactly one world, named at `org create --world`. The clock, the record and snapshots belong to the world. Kinds: a local devnet (one developer, one machine), and simulated worlds, each with its own companies and clock speed (real time or faster, or stepped). `world create|list|show|register`, the world's clock verbs and `world snapshot save|list|restore [--as]` are operations at full resolution. The book's 139 named eval 'worlds' are templates (a snapshot meant to be copied, or the `from` plus `steps` that build one): the word is changed in the stage 3 records and text, and the ids and every refusal's `given` are kept as they are, because renaming them would churn hundreds of links. Only the world verbs address it by name (devnet.one-world-command-surface); the old dev command surface is retired." },
    { label: "one-company-world", text: "Keep 'world' as the book used it, a named snapshot an eval starts from." },
  ],
  chosen: "world-is-chain-companies-clock-record",
  why: "The owner: all companies connected to one chain, with one clock and one record, not one company (quoted in docs/mission/worlds.md, section 1). The book used the word for a named snapshot (139 of them, worlds.ts) and for a stack (the supervisor is singular); the research note proposes templates for the first and the supervisor per world for the second, accepted here. Chosen not to rename ids: `given` strings such as org-with-site stay.",
  affects: [f.system_capxul, f.concept_devnet, d.table_worlds, d.machine_world, ...WORLD_OPS, integration_devnet_control],
});

export const decision_devnet_org_create_names_world = dec({
  id: "devnet.org-create-names-its-world",
  title: "`org create` names its world",
  question: "How does a company come to live in a world?",
  options: [{ label: "named-at-create", text: "`org create <name> --world <world>` makes the company in that world: its on-chain part on that world's chain, its site on that world's bench at `<company>-<world>.<base>`, on that world's clock. A company is in exactly one world for its life; restoring a snapshot into a separate world makes new companies in the new world with their own addresses and keys, never moves one. Without `--world` a local devnet's one world is meant. org.create is a frozen operation: its claims are unchanged; the flag is the target's own to design." }],
  chosen: "named-at-create",
  why: "The owner's definition puts a company in a world. The cut's decision cut.principle left org create alone; this adds the flag as design, not a change of behaviour.",
  affects: [f.system_capxul, f.concept_organizations, f.concept_sites, d.table_worlds],
});

export const decision_devnet_site_clock = dec({
  id: "devnet.clock-rate-and-stepping",
  title: "The rate stays 1 to 60; long histories run frozen and stepped",
  question: "How fast can a world's clock run, and how does a 22-month history run?",
  options: [{ label: "one-to-sixty-and-stepping", text: "The clock's rate stays 1 to 60 world seconds per real second (devnet.clock-rate), the bound the owner has not ruled on. A fast world does days, not years: at rate 60 the 669 days of the old company histories take 11 days. Years run frozen and stepped, where speed is commands per minute, not clock rate: about 14 minutes for Bit Connect and 78 for Quillmesh when scripted at about 1 s a command (an estimate from the spike's 0.1 to 0.7 s steps), and hours when an agent decides." }],
  chosen: "one-to-sixty-and-stepping",
  why: "docs/mission/worlds.md, sections 5 and 7, decision 2. The scripted 1 s a command and the agent's 10 s a decision are proposals, not measurements.",
  affects: [f.system_capxul, f.concept_devnet, r.rpc_devnet_worlds_clock_set, r.rpc_devnet_worlds_clock_freeze, r.rpc_devnet_worlds_clock_warp, o.operation_world_clock_set, o.operation_world_clock_warp],
});

export const decision_devnet_restore_as = dec({
  id: "devnet.restore-into-a-separate-world",
  title: "Restoring into a separate world keeps the chain id, with a new chain instance",
  question: "What does `world snapshot restore --as` keep and rename?",
  options: [{ label: "same-chain-id-new-instance", text: "It keeps the chain id and each site's encryption key and uses a new chain instance. It renames every site's address, the world name and secret in each site's config, the sign-in addresses, the org-to-site map, ports and token, mail addresses, database names and the record's world id. Grants stay outside the snapshot. The new record's `born` entry names the parent world, the snapshot and the sequence. An in-place restore appends `restore`, bumps the epoch and keeps the abandoned branch, flagged. Measured by the spike (Behaviour 9, FINDINGS, Worlds and snapshots): one company into a new world 36 s, a whole world in place 80 s; the new world's clock resumed at the saved time while the old stayed on host time, and a payment made in one is not in the other." }],
  chosen: "same-chain-id-new-instance",
  why: "docs/mission/worlds.md, section 6, 4, and section 7, decision 5.",
  affects: [f.system_capxul, f.concept_devnet, r.rpc_devnet_worlds_snapshot_restore, o.operation_world_snapshot_restore, integration_devnet_control, integration_site_service],
});

export const decision_devnet_record_entry = dec({
  id: "devnet.record-entry",
  title: "The world's record holds one wide entry for everything, and never a key",
  question: "What does the record hold, and what never?",
  options: [{ label: "wide-entry", text: "One entry per command, tool call and reply, gap-free per world and epoch: the world id, epoch and sequence; world time and real time with the clock's mode and rate; who (person or agent, hats worn, run id, model and policy version); the surface; the command with redacted arguments; the result or refusal code; what it returned and changed; pointers (document name and hash, transaction hash, block); and the cause. Agent tool calls and replies are always recorded; hidden reasoning only when the run is flagged. Never a key, seed, grant, bearer or session token, sign-in code, Frappe password, HMAC secret or encryption key, and no real customer's personal data without consent. The record is training data and a product of the system, not a debugging aid. The door's calls (sites.door) are entries of it; door-calls is only the idempotency row." }],
  chosen: "wide-entry",
  why: "docs/mission/worlds.md, section 6, 5, accepted as decision 6; docs/mission/critical-path.md, Priorities: everything is recorded. The entry's schema is the spike's schema 1 (table command-records). Open, not on the owner's list: who may read it and the consent rule for a real customer's world (devnet.record-readers).",
  affects: [f.system_capxul, f.concept_devnet, d.table_command_records, ...RECORD_OPS, r.rpc_devnet_records_list, r.rpc_devnet_records_show, r.rpc_devnet_records_export],
});

export const decision_devnet_viewer_grant = dec({
  id: "devnet.viewer-grant",
  title: "A viewer grant opens any company's site in a world, read-only",
  question: "How does a person watch a running world?",
  options: [{ label: "viewer-grant", text: "A grant in a world with the role viewer lets a person open any company's site in it read-only through a one-time link the service asks the site to mint (plugs.sessions.link). The grant is the supervisor's, outside the snapshot; it guards the service API and now each company's site address too. A person with only this grant cannot save anything." }],
  chosen: "viewer-grant",
  why: "docs/mission/worlds.md, section 7, decision 7: it must be visible (critical-path.md, Priorities), and the shared world's gateway guarded only the service API.",
  affects: [f.system_capxul, f.concept_devnet, f.concept_plugs],
});

export const decision_devnet_first_template = dec({
  id: "devnet.first-template",
  title: "The first template is the four old companies at month three, with date shifts",
  question: "Which template is built first?",
  options: [{ label: "town-of-four-m3", text: "`town-of-four@m3`: Bit Connect, Quillmesh, Kobina Ridge and Tamu Orchards at month three of their generated histories, each company's facts seeded through the door (an invoice, a payment through the signer) dated by the clock and checked against its month-end answer key. Tamu starts nine months later than the others, so each company has a date shift. Build order: the clock-follow spike and the record entry schema, the world registry and per-world supervisor with an empty template, separate-world restore, a template from a snapshot, then the seed adapter for Bit Connect months 1 to 3 (docs/mission/worlds.md, section 7). Built in the spike: the clock, the record, separate-world restore and the company template (47 s against 132 s for a full build). Not built, and assumed: the seed adapter and the registry with a per-world supervisor." }],
  chosen: "town-of-four-m3",
  why: "docs/mission/worlds.md, sections 5 and 7, decision 8. Counts from the note: Bit Connect 3,015 facts, Quillmesh 6,275, Kobina Ridge 2,404, Tamu Orchards 4,445 (measured by running the old generators offline).",
  affects: [f.system_capxul, f.concept_devnet, d.table_world_snapshots, o.operation_world_create],
});

export const decision_devnet_worlds_isolated = dec({
  id: "devnet.worlds-never-see-each-other",
  title: "Worlds never see each other",
  question: "How are worlds kept apart on one machine?",
  options: [{ label: "per-world-everything", text: "A database, a chain, a mail sink and a secret per world; the hostname carries the world; the service refuses a site not in its world; one supervisor per world and a small registry. A cross-world test is an eval. Several worlds on one machine is a gap the old devnet had (its supervisor was singular, fixed ports); it is closed here by design, and the spike ran two worlds at different times side by side on one bench and one machine (Behaviour 9), each with its own chain, Core, clock and record. Size estimates, not measured: a world about 0.6 GiB, a company about 0.1 GiB, about 12 idle worlds on a 16 GiB machine and 6 to 8 busy ones." }],
  chosen: "per-world-everything",
  why: "docs/mission/worlds.md, section 6, 2, 3 and 6. The spike has one shared secret and one chain at 127.0.0.1:8545 (INTERFACE.md), so isolation is new work.",
  affects: [f.system_capxul, f.concept_devnet, w.workflow_devnet_worlds_create, d.table_worlds, d.table_world_registrations],
});

export const decision_devnet_world_registers = dec({
  id: "devnet.world-registers-hosted",
  title: "A local devnet registers as a world with the hosted site service",
  question: "How does a developer's laptop keep companies with real sites?",
  options: [{ label: "register-and-park", text: "`world register` issues a world id, a secret (shown once) and a name; the world's companies' sites are created on the hosted bench; idle sites are parked after 30 minutes (an assumption, measured by the first hosted-world eval) and woken by the next call; a core-only world with no sites is the offline fallback. The consequence of plugs.service-calls-site: the hosted bench never has to reach the laptop." }],
  chosen: "register-and-park",
  why: "The owner, 10 November, relayed by the coordinator: one hosted bench shared by everything, including local devnets, whose service the bench cannot reach.",
  affects: [f.system_capxul, f.concept_devnet, f.concept_sites, r.rpc_devnet_worlds_register, o.operation_world_register, w.workflow_devnet_worlds_park_idle, d.table_world_registrations, integration_site_service],
});

export const decision_devnet_one_world_command_surface = dec({
 id: "devnet.one-world-command-surface", title: "One world command surface, no dev aliases",
 question: "Keep dev time and dev snapshot beside world commands?",
 options: [{ label: "world-only", text: "dev.time is reached by world show; dev.time.warp by world clock warp; dev.time.start-at by world create --start-at, before anything runs. dev.snapshot.save, dev.snapshot.list and dev.snapshot.restore are reached by world snapshot save, list and restore. The target-only dev.time.set is retired in favour of world clock set. SDK supervisor helpers remain SDK-only. Original records: docs/cut-archive/devnet/operations.ts." }, { label: "dev-only", text: "Keep the implicit single-world dev commands instead of the named world surface." }],
 chosen: "world-only",
 why: "aaron.world-clock and devnet.world-first-class put time and snapshots on named worlds. Two spellings drift. Classify the six frozen capabilities as reached, not dropped; no CLI aliases. Keep start-at as a creation-only option, including dates before host time; later backwards movement stays INVALID_INPUT. Restore still covers chain, backend, indexer, faults and stateful followers. Keep environment isolation, name validation and version-mismatch refusal. Rate changes preserve frozen mode; resume alone starts it. Hosted grants still guard access. Historical decisions describe the prior surface, not aliases.",
 affects: [f.concept_devnet, ...WORLD_OPS, r.rpc_devnet_worlds_create, r.rpc_devnet_worlds_clock_set],
});
