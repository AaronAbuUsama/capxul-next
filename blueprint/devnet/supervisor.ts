import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import { component_devnet, concept_devnet } from "../shared/foundation.ts";

export const decision_devnet_slice_zero_supervisor = defineDecision({
  id: "devnet.slice-zero-supervisor",
  title: "One executable supervisor composes the real slice-zero world",
  question: "What owns process order and recovery composition without reviving the spike's JSON Core?",
  options: [
    { label: "supervised-real-stack", text: "A private local-world configuration fixes ports, database roles, bench compose project and optional bundler argv. Amp supervises foreground processes. Create alone migrates; up and restore never migrate. Fresh creation writes the real v4 deployment addresses, including Budgets, Agreements and AgentOwner, before Ponder starts; that static manifest is copied unchanged on recovery. Anvil starts before Ponder, then explicit indexer binding on create, then site service and paused Core. Recovery uses the devnet snapshot door and restricted backend store helpers. A separately supervised gateway fences public Core, RPC, bundler and bench ingress while private recovery endpoints remain reachable. Read-only world inspection joins live database/world, Core, chain, bench and pinned process identities; it is an observation, never a replacement for a completed same-run eval receipt." },
    { label: "spike", text: "Continue saving the skeleton's JSON state and call that the slice-zero run." },
  ],
  chosen: "supervised-real-stack",
  why: "Aaron named slice zero on real Postgres, Ponder, ERPNext and v4. Private ports are host-operator-only; no portal points to them. Clean stop receipts are required before copying Anvil state, and failed startup leaves ingress closed. The configuration pins the checkout commit; an already-running process from another commit cannot be reused as evidence for the current build. Stop remains available across version changes. Production-shaped bench recovery stops every writer while MariaDB and Redis remain up. World stop stops the writers, then the world's MariaDB and both Redis; the shared host Postgres stays up; recovery's pause starts the three first (Aaron, Space, 13 November). Bench processes run under init with process-group signal forwarding, so PID 1 cannot swallow shutdown signals. The optional bundler is supplied by Aaron, never simulated. The CLI delegates scoring to the eval runner using the mechanically computed slice-zero required IDs. The harness saves its running receipt before preparation provisions, pays or recovers; preparation must start from a fresh fixture and attach its reads to that run. A failed preparation skips the checks. Fixture setup is not proof of missing public journey operations or emitted success events. Public document checks inherit the selected Director EOA key and fenced public Core origin, with a private owner-only actors file naming that Director and a registered member's real personal Safe with no company hat. Signing keys never enter argv, Core directory rows or evidence, and a cookie never substitutes for a signed caller. Native bench execute emits strings verbatim and JSON for structured values; readback respects that transport. The final acceptance cookie is minted only after recovery; acceptance load verifies and replays rather than restoring again. Missing checks, bundler or receipts cannot become a pass.",
  source: "Wave 0 slice 0 integration brief, 12 November 2026; aaron.postgres-and-ponder; aaron.one-cli; devnet.snapshot-of-a-world; Core, recovery and provisioning owner interfaces",
  affects: [component_devnet, concept_devnet],
});

export const decision_devnet_selected_world_now = defineDecision({
  id: "devnet.selected-world-now",
  title: "Selected-world business time has one database authority",
  question: "What time may same-transaction concept consumers use before the running-clock authority is implemented?",
  options: [
    { label: "persisted-stopped-authority", text: "The backend devnet door worldNow(sql) returns the safe-integer nowMs from the single app.world.clock row only in stopped mode, with a valid rate from 1 to 60. Missing, malformed or running clocks fail closed. Consumers use this same transaction's authority for business timestamps, never a caller timestamp, host fallback or independent rate calculation. Creation installs the actual chain instant; native recovery installs the saved instant offline before any consumer resumes." },
    { label: "extrapolate", text: "Treat the unanchored stored running clock as enough information to invent elapsed time in each consumer." },
  ],
  chosen: "persisted-stopped-authority",
  why: "The selected supervisor implements stopped authority only. Its current clock has no realAt or stopAt, so extrapolation cannot satisfy the existing time protocol's running stops. Refusal preserves the frozen and restored world exactly without claiming the running protocol is implemented. Running support must first supply its authoritative anchor, due-stop barrier and recovery reanchoring through this same door; consumers do not acquire their own clocks. Real time still measures operational timeouts, spans and external authentication expiry, not business time.",
  source: "docs/design/time.md sections 3 and 7; selected supervisor clock callback; integration clock-door assignment, 12 November 2026",
  affects: [component_devnet, concept_devnet],
});

export const decision_devnet_one_world_clock = defineDecision({
  id: "devnet.one-world-clock",
  title: "Every component of a selected world takes its time from one door",
  question:
    "time.one-clock and aaron.world-clock already say a world has one clock that the chain, Core, every Frappe site and the bundler follow. " +
    "The selected supervisor implemented a stopped clock in clock.json and Postgres only: the bench took the clock after provisioning, Anvil dated " +
    "blocks by its own wall offset and Alto judged sponsorship windows by host Date.now. Which door installs the clock in each follower, which " +
    "Frappe subsystems run on which clock, and what fails when any component reads the host instead?",
  options: [
    { label: "one-door-every-follower", text:
      "(1) Authority. The supervisor's world clock {nowMs, clockMode, rate} is the only business time. One door writes clock.json, app.world.clock, " +
      "the bench's capxul-world-clocks.json entry for the world and the chain pin together. createWorld calls it before Ponder starts and before any " +
      "site exists; restore installs the saved instant offline before resume; every later move goes through it. No site, fixture or consumer writes a clock. " +
      "(2) Chain. The supervisor is the only miner (devnet.only-miner): after every Anvil start it sets the block timestamp interval to zero and the next " +
      "block timestamp to now, so every block, automined ones included, is dated at the world's now (time.blocks-at-now). " +
      "(3) Bundler. Alto's account and paymaster validity checks (v0.6 and v0.7, safe and unsafe validators) read the chain head's timestamp, which is the " +
      "world's now, through the devnet pnpm patch of @pimlico/alto 0.0.21; Alto's own operational timers stay real. A guard fails when the patched reads " +
      "are absent. " +
      "(4) Core. Business time is worldNow(sql); real time only for time.real-elapsed's measures and protections, each labelled. " +
      "(5) Frappe follows the same clock, subsystem by subsystem, as devnet.frappe-clock-subsystems rules. " +
      "(6) Checks. world inspect reads every follower (authority, database, chain head and next block, the bench entry and each site's capxul.clock.now, the " +
      "bundler's patched reads) and refuses on any disagreement. The time.no-direct-reads scan covers packages/*/src and *.sql with a committed allowlist " +
      "labelling each host read rebound, real-on-purpose or world. Each check has a negative control that makes it fail: no bench install at create, an " +
      "unpinned Anvil, a reverted Alto patch, an unlabelled host read." },
    { label: "start-at-wall-time", text: "Start every world's clock and chain at the host's time and leave followers reading the host. Any frozen clock, warp or restore to an old cut separates them again." },
    { label: "alto-date-preload", text: "Replace Date.now inside the Alto process with the world clock through a preload. It also freezes Alto's own timeouts and polling, which are real on purpose." },
    { label: "install-after-provisioning", text: "Keep writing the bench clock from the acceptance fixture after the site is provisioned. The site's first life is on host time; the first restore moves it 34.6 days and Frappe expires the fixture's session." },
  ],
  chosen: "one-door-every-follower",
  why:
    "The baseline run-20261113051714662-5d3784b9 failed all thirteen acceptance checks because Frappe deleted the hat-holder's session as Session Expired " +
    "at the frozen world instant: provisioning had stamped the site on host time, and restore moved it to the world's. Alto 0.0.21 compares validAfter " +
    "and validUntil with host Date.now (UnsafeValidator getValidationResult07) while EntryPoint uses block time, so on the seeded chain no dated " +
    "sponsorship passes both, and no flag disables the validAfter check. Anvil, unpinned, dates automined blocks by its own wall offset. Each is a second " +
    "clock the design forbade but nothing measured. One door at birth and restore makes the followers agree by construction, and the inspection and scan " +
    "make a regression fail instead of surfacing as an unrelated 401. A frozen Anvil with a zero interval mines any number of blocks in one second " +
    "(measured 13 November 2026), so pinning needs no tick. Ponder 0.18.6 finds its finalized block at start by bisecting from block 0 for one older " +
    "than its 180 s reorg window: on a frozen chain every block since birth shares the head's time, so after a restart it asked for block 23,946,692 " +
    "below the seeded genesis and never became ready (w2clock and scrz3, 13 November 2026). A pnpm patch bounds that search by the indexer's first " +
    "block; the reorg window itself stays, so a reorg fault within a run is still recoverable, and the patch guard covers it with Alto's.",
  source:
    "Baseline run-20261113051714662-5d3784b9 (Frappe Activity Log Session Expired at the frozen instant); @pimlico/alto 0.0.21 UnsafeValidator.js 181 and 275, " +
    "SafeValidator.js 111 and 322; clock audit thread T-01a1cfb4; Aaron, 13 November 2026: the fix is fundamental, not ad hoc",
  affects: [component_devnet, concept_devnet],
});

export const decision_devnet_frappe_clock_subsystems = defineDecision({
  id: "devnet.frappe-clock-subsystems",
  title: "Frappe sessions follow the world clock; infrastructure stays real",
  question:
    "Point (5) of devnet.site-follows-world keeps Frappe sessions, caches, locks, tokens and the job queue's own timestamps on real time. " +
    "time.real-elapsed puts every expiry a person is promised, a session included, on the world's now, and Frappe itself derives session lifetime " +
    "from the patched now while comparing session_end with the host. Which clock does each Frappe subsystem in a world use?",
  options: [
    { label: "sessions-on-world", text:
      "Supersedes point (5) of devnet.site-follows-world. Sessions are on the world's now: last_updated, the Sessions expiry threshold and the " +
      "session_end comparison read it, so one session is judged on one clock: a one-day world clock warp keeps it and a warp past its lifetime ends it " +
      "cleanly (devnet.time-is-right test 6, bound to world clock warp). A snapshot restore still invalidates every session by design " +
      "(devnet.world-evidence quiesce-template-bundle). The clock read fails closed: a missing or unreadable world entry raises instead of returning " +
      "the host's time. Every bench Python process installs the clock at interpreter start (a world-clock .pth in the bench venv), because Frappe " +
      "validates the session in init_request before any app is imported: a fresh web worker otherwise judges a world-stamped session on the host and " +
      "deletes it. Each site's capxul.clock.now reports whether its workers booted with the clock, and world inspect refuses one that did not. Redis TTLs, locks, caches, rate limits and the job queue's enqueue and timeout stamps are real on purpose: infrastructure " +
      "envelopes, never a business expiry, and nothing a person is promised is stored only as a Redis TTL. Scheduled jobs decide due-ness on the " +
      "world's now (points 2 and 6 of that decision). SQL NOW() or CURRENT_DATE compared with stored world dates is replaced by world time (its " +
      "point 3). Browser default dates on Desk and report filters are judged on every captured screen: a host date there fails the screen check." },
    { label: "keep-real-time-sessions", text: "Keep point (5): sessions on host time. Frappe already stamps last_updated with the patched now, so a session born on one clock is judged on the other and dies at the first restore or warp." },
    { label: "bench-beneath-clock", text: "Option C of devnet.site-follows-world: a clock beneath every bench process. It makes sessions agree too, but it is the heaviest path and stays the fallback if the session path cannot be made consistent." },
  ],
  chosen: "sessions-on-world",
  why:
    "The baseline run-20261113051714662-5d3784b9 lost its only hat-holder session as Session Expired at the frozen world instant between preparation " +
    "and the first read, after the site's clock moved 34.6 days at restore. A session is a promise to a person, which time.real-elapsed already puts on " +
    "now; point (5) contradicted it and Frappe's own code mixes the two. Infrastructure envelopes stay real because no product decision rests on them. " +
    "On world w2clock (13 November 2026) the bench clock installed at birth was not enough: after a backend restart a fresh admin sid read 200 once and " +
    "then 401 Session Expired on the second gunicorn worker, every time; with the start-up install the same sequence read 200 eight times out of eight.",
  source: "Baseline run-20261113051714662-5d3784b9; frappe/sessions.py get_session_data_from_cache; frappe/app.py init_request; w2clock session control and clock audit T-01a1cfb4, 13 November 2026",
  affects: [component_devnet, concept_devnet],
});

export const decision_devnet_bench_callback_startup = defineDecision({
  id: "devnet.bench-callback-startup",
  title: "Bench callback configuration precedes websocket startup",
  question: "When must the internal Frappe callback address become available to realtime consumers?",
  options: [
    { label: "configurator-barrier", text: "The shared bench configurator writes webserver_host=http://backend and webserver_port=8000 before dependent processes start. The supervisor does not rewrite these settings after startup. The same dependency barrier applies to create, up and recovery." },
    { label: "rewrite-after-start", text: "Write the callback after containers become healthy, leaving existing realtime consumers with their original module-static configuration." },
  ],
  chosen: "configurator-barrier",
  why: "Frappe realtime caches get_conf at module initialization. In solsup the listener's normal loopback Origin failed with fetch failed, while the same token and live websocket connected with the internal backend Origin; a fresh process authenticated against the current config. A healthy listening port did not establish a working callback. Configuring the existing dependency barrier fixes the source of truth without restarting a failed world, bypassing collection, or preparing chain state on up/restore.",
  source: "Retained solsup run-20261112121451347-3ccaf6fc listener controls, 12 November 2026; Frappe realtime/utils.js; devnet/processes.ts benchUp",
  affects: [component_devnet, concept_devnet],
});

export const decision_devnet_preparation_host_context = defineDecision({
  id: "devnet.preparation-host-context",
  title: "Receipt-first preparation retains its host supervision context",
  question: "How can the restricted preparation child recover its own world without importing operator credentials?",
  options: [
    { label: "explicit-host-marker", text: "The gate forwards inherited AMP_ORB to its harness/preparation child, in addition to its restricted runtime and selected fixture inputs. Runtime application children stay unchanged; no broad environment copy or Amp authentication credentials are forwarded." },
    { label: "application-only", text: "Run the supervisor preparation with only an application's runtime environment, losing its host service context." },
  ],
  chosen: "explicit-host-marker",
  why: "The solsock snapshot-save failed before bench pause: its preparation child resolved the live ingress service as not running. Read-only same-service controls reproduced this under the restricted environment; forwarding only AMP_ORB restored the actual active PID, while AMP_URL alone did not. The preparation process is the receipt-bound host supervisor, not an application child. Its existing recovery authority must address the same supervised services without gaining operator database or unrelated authentication keys.",
  source: "Retained solsock run-20261112123816458-aff2bc98 CLI error and paired read-only supervision controls, 12 November 2026",
  affects: [component_devnet, concept_devnet],
});

export const decision_devnet_preparation_host_user = defineDecision({
  id: "devnet.preparation-host-user",
  title: "Preparation launches supervised services as the operating-system caller",
  question: "Which execution identity may the restricted host preparation supply when resuming its own world?",
  options: [
    { label: "os-caller", text: "The gate supplies USER from the operating system's current user identity to its harness/preparation child, alongside the explicit host marker. Application runtime environments remain unchanged. Neither caller-supplied USER nor a broad operator environment determines the service account." },
    { label: "omit-user", text: "Leave execution identity out of the restricted preparation environment, allowing the service CLI to choose unknown." },
  ],
  chosen: "os-caller",
  why: "Solgate published its native snapshot but source resume failed before bash or Anvil ran: the new transient service had User=unknown and exited 217/USER. Two distinct disposable sleep-service controls reproduce that missing identity under the restricted environment and launch a real process when USER alone names the actual caller. The CLI reporting started and exiting zero is not wrapper readiness. The preparation process must retain the operator's actual host identity without importing authentication credentials or granting application children host supervision context.",
  source: "Retained solgate run-20261112131330936-216fd544 systemd/CLI evidence and isolated USER-only supervisor controls, 12 November 2026",
  affects: [component_devnet, concept_devnet],
});

export const decision_devnet_composed_catalogue = defineDecision({
  id: "devnet.composed-catalogue",
  title: "Composition records actual world lifecycle and snapshot catalogue facts",
  question: "How does the executable supervisor populate the transactional catalogue without mistaking financial record heads or schema creation for world history?",
  options: [
    { label: "world-targeted-facts", text: "Fresh creation alone migrates the catalogue and inserts its creating world after installing the actual chain clock. Successful composed up/stop records the corresponding lifecycle transaction. Snapshot save captures the catalogue cut after quiescence, before copying the database, and records snapshot metadata only after publication and successful resume. Restore captures the abandoned catalogue history after quiescence, reads the actual saved catalogue cut from the installed database, and rewrites offline before resume. Catalogue epoch/sequence/head never comes from the financial cut. Missing catalogue schema or rows refuses; up and restore never backfill retained worlds." },
    { label: "schema-only", text: "Create the catalogue tables but infer rows and command history when a reader asks for them." },
  ],
  chosen: "world-targeted-facts",
  why: "A database schema does not establish a born world, a completed stop, or a saved snapshot. Restricted worker transactions target the world's own database and close before template copying. A temporary recovery fence is not a user lifecycle stop. Failed process actions do not emit successful lifecycle records; a published snapshot whose resume or catalogue publication fails remains an explicitly failed operation, never repaired or credited automatically. Restore retains abandoned records from the actual drained source, not a disconnected fixture or a connection reopened on its fenced abandoned database.",
  source: "Integration composition ownership assignment, 12 November 2026; reviewed Recovery worldCatalogue doors; PR77 8144d0a fresh-create migration gap",
  affects: [component_devnet, concept_devnet],
});
