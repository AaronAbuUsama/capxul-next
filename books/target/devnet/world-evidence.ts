// What the spike's clock, snapshot, template and record sections, and the cost study, decided for worlds. The coordinator's decisions on Aaron's delegation of the book;
// none is on the owner's list. Measured figures are marked measured, estimates estimated. Evidence: spikes/skeleton/FINDINGS.md; docs/mission/world-cost.md.

import { defineDecision } from "../../../packages/book/src/index.ts";
import * as f from "../shared/foundation.ts";
import { BY } from "../plugs/kit.ts";

const SNAP = "spikes/skeleton/FINDINGS.md, Worlds and snapshots; The company template";
const dec = (spec: { id: string; title: string; question: string; options: { label: string; text: string }[]; chosen: string; why: string; evidence: string }) =>
  defineDecision({ ...spec, source: BY(spec.evidence), affects: [f.system_capxul, f.concept_devnet, f.component_site_service] as never });

export const decision_devnet_clock_follows_what = dec({
  id: "devnet.clock-follows-what",
  title: "What follows a world's clock, what does not, and what an advance costs",
  question: "In the spike, what followed the world's clock, what stayed on the host's, and how long does moving time take?",
  options: [
    {
      label: "measured-in-the-spike",
      text:
        "FOLLOWS: every Python call of now_datetime, nowdate, today, nowtime and now in any app on the site (posting dates, creation and modified, fiscal-period lookups, Accounting Period checks, naming, Auto Repeat, subscriptions, HR accruals); " +
        "what is due on the scheduler; the chain's block time, so a payment's reference date agrees with the ledger; Core's record. STAYS ON THE HOST'S TIME: direct host-clock calls (86 counted with tests included: frappe 43, erpnext 26, crm 12, hrms 5; the study's non-test count is 53), " +
        "database NOW() defaults, Redis (cache and rate-limit TTLs, queue timestamps), session lifetime, the scheduler's sleep alignment, the browser's JavaScript (the desk's default dates), file times and logs, the assertion's expiry. A world moved back leaves documents created later than 'now'. " +
        "DOES NOT: create a fiscal year (the site has 2026 only, so a world cannot pass 31 December). A rate is not built (ten lines on the site; the chain needs a timer driver). " +
        "A real chain cannot be moved, so a world with a moving clock is a devnet or a simulation and never shares a chain with a real company. The clock is per world: two worlds ran at different times on one bench (Behaviour 9). " +
        "COST, measured, four companies: a set 4 to 6 s; an advance of 10 days 33 to 41 s (11 stops per site, about 4,500 scheduled jobs in parallel), so a month is 90 to 120 s; three sites 21 days 52 s. The cost grows with the number of companies and the stops; `--step 7d` is the lever, and it must not skip a day a job fires on (devnet.site-follows-world 6).",
    },
  ],
  chosen: "measured-in-the-spike",
  why: "FINDINGS, The door, the recorder and the clock: The clock. The advance was proved by a weekly Auto Repeat made on 2 February that produced invoices dated 9, 16 and 23 February after a 21-day advance with nobody calling it. The coordinator's re-run of the clock checks is pending.",
  evidence: "spikes/skeleton/FINDINGS.md, The clock; docs/design/time-deep-dive.md",
});

export const decision_devnet_snapshot_of_a_world = dec({
  id: "devnet.snapshot-of-a-world",
  title: "A snapshot is of a whole world and is as sensitive as production",
  question: "What is a snapshot the unit of, what does a restore rewrite and not, and how is it protected?",
  options: [
    {
      label: "whole-world-sensitive",
      text:
        "The unit is the world: one anvil is one world and cannot be split by company. A snapshot is one folder: a manifest (world, real and world time, record position and head hash, each company's counts, checksums, what a restore rewrites and cannot), the whole chain state, Core's state with the record, and bench's backup of every site (database, files, site config). " +
        "A restore into a separate world rewrites the site name, `capxul_world`, the host name, Core's address on the site, the Social Login Key URLs, the clock (resumes at the saved world time) and enables the scheduler (bench's restore leaves it off); the encryption key is KEPT from the backup, or every stored password is unreadable. Org ids and Safe addresses on the chain are unchanged. " +
        "CANNOT be rewritten or is not in it: history in the data (posting dates stay), Redis (sessions end, queued jobs are lost), absolute URLs inside document bodies (none found), the test people's keys and the shared secret, and a real chain, which cannot be copied this way (anvil's state dump: local and simulated worlds only). " +
        "BECAUSE IT CARRIES EVERY SITE'S ENCRYPTION KEY and the whole database, it is as sensitive as production: kept on the machine of its world, encrypted at rest, restored only by the world's owner, never uploaded elsewhere unencrypted. Where it is stored and the encryption scheme are open and not on the owner's list (m3b-first-shared-world). The record is not rewound: a restore appends an entry with lineage, so two worlds grown from one snapshot share their record to that line.",
    },
  ],
  chosen: "whole-world-sensitive",
  why: "FINDINGS, Worlds and snapshots (Proved, Behaviour 9; measured save 9.4 s and 9.5 MB for four companies, restore into a new world with one company 36 s, in place for four 80 s). Refines devnet.restore-into-a-separate-world.",
  evidence: SNAP,
});

export const decision_devnet_company_template = dec({
  id: "devnet.company-template",
  title: "A new company is restored from a template, 47 s against 132 s",
  question: "How is a company made quickly, and what can a template not do?",
  options: [
    { label: "template-restore", text: "A template is a site made by the full script (every app, wizard, the Safe's bank account, sign-in key, features, names, privacy; a placeholder Company and Safe) and saved with bench's backup, 1.2 MB. `org create` restores it into an empty site and configures this company in: the Company is renamed (frappe.rename_doc worked), the placeholder Safe's Bank Account moved to the real address, the settings and sign-in key written. Measured: 47 s against 132 s for the full build (145 s earlier), 2.8 to 3.1 times faster; about 30 s is the restore, 15 s the configuration. It never restores over an existing site. LIMITS: the company abbreviation stays the template's (`CC`, so accounts end ` - CC`) and the Bank Account's document name keeps the placeholder. The template is rebuilt when an app is upgraded. A warm pool of empty sites, which would make it seconds, is not built." },
    { label: "full-build", text: "Always run the full script: 132 to 145 s." },
  ],
  chosen: "template-restore",
  why: "FINDINGS, The company template: a new company from a snapshot of an empty site. Refines devnet.first-template and sites.lifecycle. The abbreviation limit is the open edge: whether it matters to a customer is for the first customer-facing design.",
  evidence: SNAP,
});

export const decision_devnet_record_readers = dec({
  id: "devnet.record-readers",
  title: "Who reads the record, how long it is kept and what is redacted: open",
  question: "The record holds every result a command returned, documents included, so personal data. Who may read it and what is redacted?",
  options: [
    { label: "open-with-the-edges", text: "OPEN, not on the owner's list: it waits on the access design and the first real company. Known: schema 1 (table command-records); only secrets are redacted today, by name and by value, and a line still holding one is refused; the hash chain makes tampering show but is not anchored anywhere; the file per world versus a table is undecided (the book's table is the target, the file is the spike); whether a site or Core may write an entry themselves (a scheduled job, an event) and not only the CLI is open; the join to the chain's logs is the transaction hash. Until a decision: a record is readable only by the world's owner and by people with a grant in that world, and a real customer's world is never exported without the consent rule." },
  ],
  chosen: "open-with-the-edges",
  why: "FINDINGS, The door, the recorder and the clock: What the design must now decide, 3. Refines devnet.record-entry.",
  evidence: "spikes/skeleton/FINDINGS.md, The recorder; What the design must now decide",
});

export const decision_devnet_lean_world = dec({
  id: "devnet.lean-world",
  title: "The lean world: one small service and one database file per world, parked idle",
  question: "How is a simulated world made radically cheaper, and which part is kept real?",
  options: [
    {
      label: "lean-service-real-chain",
      text:
        "Design B of docs/mission/world-cost.md, built first and shaped so it can move to a Durable Object. (1) One small service per world with one database file (SQLite: a snapshot is a copy, a parked world costs disk). " +
        "(2) The indexer folded into the service: it reads the logs in block order into its own store with the spike's event_key idempotence, with no Ponder and no Postgres (about 300 to 500 MB estimated saved). " +
        "(3) No bundler in simulated worlds; the note's caveat is that skipping ERC-4337 loses the EntryPoint path where money moves, so it keeps one real bundler world as a canary. " +
        "(4) Idle worlds are parked and restored on demand: a core world resumes in about a second (estimated); a site restore took 33 s in the spike (measured). " +
        "(5) The real chain is kept per world: one anvil with the real contracts (11.6 MiB with the stand-in state, 5.5 MB for the real v4 state, both measured); substituting an EVM in the service is NOT taken now. " +
        "(6) The Capxul part on Cloudflare (a Durable Object per world, SQLite, alarms for the clock) is a later option, not taken now: Frappe stays on a machine and is the cost bound. " +
        "FIGURES, measured on this Mac: anvil 11.6 MiB, Node service 75 MB, bench 361 MiB, MariaDB 471 MiB, Redis 22 MiB, a company site 60 MB of database. ESTIMATED: a world 0.6 GiB today against 0.15 GiB lean, about 0.1 GiB per busy site, about 130 sites on a 16 GiB machine (about $84 a month), a Cloudflare world about $1 for 22 months. " +
        "TEST FIRST (a gap, under a day): replay the real deploy and the first 200 transactions of a scenario on anvil and on a substitute, comparing gas, logs and the final state.",
    },
    { label: "as-designed", text: "A: anvil, Postgres, Ponder, alto and Node per world, as designed: about 0.6 GiB a world, 8 busy worlds a machine." },
    { label: "durable-object", text: "C: the Capxul part as a Cloudflare Durable Object per world now: 6 to 9 weeks of work (estimated) and Frappe stays on the machine." },
  ],
  chosen: "lean-service-real-chain",
  why: "docs/mission/world-cost.md sections 1 to 6: 70% of a world's Capxul memory is plumbing around a chain it fully controls, and Frappe is the dominant cost either way (0.85 GiB fixed plus 0.1 GiB a site). Chain substitution waits on the differential replay, so the real chain stays.",
  evidence: "docs/mission/world-cost.md",
});
