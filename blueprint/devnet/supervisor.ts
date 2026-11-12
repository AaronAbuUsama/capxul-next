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
  why: "Aaron named slice zero on real Postgres, Ponder, ERPNext and v4. Private ports are host-operator-only; no portal points to them. Clean stop receipts are required before copying Anvil state, and failed startup leaves ingress closed. The configuration pins the checkout commit; an already-running process from another commit cannot be reused as evidence for the current build. Stop remains available across version changes. Production-shaped bench recovery stops every writer while MariaDB and Redis remain up. Bench processes run under init with process-group signal forwarding, so PID 1 cannot swallow shutdown signals. The optional bundler is supplied by Aaron, never simulated. The CLI delegates scoring to the eval runner using the mechanically computed slice-zero required IDs. The harness saves its running receipt before preparation provisions, pays or recovers; preparation must start from a fresh fixture and attach its reads to that run. A failed preparation skips the checks. Fixture setup is not proof of missing public journey operations or emitted success events. The final acceptance cookie is minted only after recovery; acceptance load verifies and replays rather than restoring again. Missing checks, bundler or receipts cannot become a pass.",
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
