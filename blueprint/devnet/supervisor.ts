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
  why: "Aaron named slice zero on real Postgres, Ponder, ERPNext and v4. Private ports are host-operator-only; no portal points to them. Clean stop receipts are required before copying Anvil state, and failed startup leaves ingress closed. A component wrapper records a clean receipt only for a stop it was asked for: the service manager signals the whole control group at once, so a child exit 0 is judged after a short settle in which the wrapper's own signal handler marks the stop as asked, and an exit nobody asked for is unclean even at 0, because the service restarts the wrapper. The child normally receives the stop signal itself, so the wrapper adds its own SIGINT only to a child still running after a grace just inside the service manager's 90 s stop timeout; an earlier second signal ran stop handlers twice or killed a child mid-teardown (2 of 25 native site-service stops unclean before, 0 of 30 after). The configuration pins the checkout commit; an already-running process from another commit cannot be reused as evidence for the current build. Stop remains available across version changes. Production-shaped bench recovery stops every writer while MariaDB and Redis remain up. Bench processes run under init with process-group signal forwarding, so PID 1 cannot swallow shutdown signals. The optional bundler is supplied by Aaron, never simulated. The CLI delegates scoring to the eval runner using the mechanically computed slice-zero required IDs. The harness saves its running receipt before preparation provisions, pays or recovers; preparation must start from a fresh fixture and attach its reads to that run. A failed preparation skips the checks. Fixture setup is not proof of missing public journey operations or emitted success events. Public document checks inherit the selected Director EOA key and fenced public Core origin, with a private owner-only actors file naming that Director and a registered member's real personal Safe with no company hat. Signing keys never enter argv, Core directory rows or evidence, and a cookie never substitutes for a signed caller. Native bench execute emits strings verbatim and JSON for structured values; readback respects that transport. The final acceptance cookie is minted only after recovery; acceptance load verifies and replays rather than restoring again. Missing checks, bundler or receipts cannot become a pass.",
  source: "Wave 0 slice 0 integration brief, 12 November 2026; native stop-race loops with the real wrapper as an Amp service, 13 November 2026; aaron.postgres-and-ponder; aaron.one-cli; devnet.snapshot-of-a-world; Core, recovery and provisioning owner interfaces",
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
