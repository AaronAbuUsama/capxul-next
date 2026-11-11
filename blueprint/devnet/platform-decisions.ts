// The worlds platform's decisions, part one: what a world is as a hosted thing, its profiles, how a caller connects, how identity travels, who may be let in and the order of work (agents first).
// The coordinator's, on the owner's delegation of the book; the owner's words of 10 November 2026 are quoted where they apply. Each says what is measured, what is an estimate and the test that will settle an assumption.
// The numbers are in ./platform-decisions-data.ts (devnet.world-capacity). Read docs/design/worlds-platform.md first.

import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import * as f from "../shared/foundation.ts";
import { decision_aaron_sign_in_is_core } from "../shared/rulings.ts";
import { BY } from "../plugs/kit.ts";
import * as d from "./world-data.ts";
import * as o from "./world-ops.ts";
import * as p from "./platform-data.ts";
import * as life from "./platform-lifecycle.ts";
import * as acc from "./platform-access.ts";

const DOC = "docs/design/worlds-platform.md";
const OWNER =
  "The owner, 10 November 2026, dictated: \"What I'm not seeing on this portal is any plans or anything that we decided around the world being like a hosted thing that you can connect to, like via the devnet … that's a foundational piece of work that needs to be done before we do breadth … we need to be able to have these UIs at scale, and having that heavy infrastructure on every sandbox just doesn't make sense. Also, it's the way we're going to be using it. It should be easy for us to create a simulation, an environment, onboard people into that environment. If they've already got keys, just: here's a new environment. I'm thinking for our beta testers. We might have 100, 200 people that we're cycling through different scenarios and simulations to get training data with agents. So it needs to be conducive to that … this part is a core fundamental part of it. Also, as we progress into doing things like RL, we need clean data, we need RL environments. So this has got to serve as that. I really need this part of it to be specified well.\" ";
export const dec = (spec: { id: string; title: string; question: string; options: { label: string; text: string }[]; chosen: string; why: string; affects: readonly object[] }) =>
  defineDecision({ id: spec.id, title: spec.title, question: spec.question, options: spec.options, chosen: spec.chosen, why: spec.why, source: BY(DOC), affects: spec.affects as never });
export { OWNER };

const BASE = [f.system_capxul, f.concept_devnet];

export const decision_devnet_worlds_platform = dec({
  id: "devnet.worlds-platform",
  title: "A world is a hosted thing with an address, managed by commands",
  question: "What is a world as a platform: where does it live, how is it reached, and how is its life managed?",
  options: [
    { label: "hosted-world-with-address", text: "A world has a name, a kind (local, simulated, staging, production), a profile, a clock and a record. A simulated world lives on the worlds machine (a local one on a laptop). Its service answers at `core-<world>.worlds.capxul.com` and each company's site at `<company>-<world>.worlds.capxul.com` (one wildcard certificate for ever, no DNS or route change per world: docs/mission/sites-host/ingress.md; the service name `core` is a reserved company slug there). Worlds are listed, made, paused, parked, resumed and destroyed by commands. A parked world costs storage only and is restored on demand. `devnet.worlds-platform` reshapes the book's existing world records; it adds no parallel concept." },
    { label: "per-sandbox-stack", text: "Every sandbox runs its own chain, service, indexer and Frappe bench." },
  ],
  chosen: "hosted-world-with-address",
  why: OWNER + "A bench on every sandbox is the heavy infrastructure he rejects; one shared bench with worlds by address is the design of docs/mission/sites-host. Measured: a bench with four sites is 0.85 GiB, so it cannot be repeated per sandbox. ASSUMPTION: the gateway can route by the `core-` and `<company>-` prefixes at one origin; settled by the first shared-world eval (m3b-first-shared-world).",
  affects: [...BASE, d.table_worlds, d.machine_world, o.operation_world_create, o.operation_world_list, o.operation_world_show, life.operation_world_pause, life.operation_world_park, life.operation_world_resume, life.operation_world_destroy],
});

export const decision_devnet_profiles = dec({
  id: "devnet.profiles",
  title: "Two profiles, chosen at creation: core and full",
  question: "How does a world avoid carrying a heavy stack when nobody looks at its screens?",
  options: [
    { label: "core-and-full", text: "`core`: the chain, the lean service and the record; no company sites. Cheap and fast; for authority and money, for tests and for most machine-driven runs. `full`: also a Frappe site per company on the ONE shared bench; for business flows and for anything a person looks at. A sandbox never carries its own heavy stack: a developer's local devnet runs the Capxul part (core) and either registers with the hosted bench for sites (devnet.world-registers-hosted) or runs `core` with no network. The profile is chosen at `world create --profile` and does not change in place; a `core` world's state can be restored into a `full` world only by making the sites (a new world from a template, not a conversion)." },
    { label: "always-full", text: "Every world has sites." },
    { label: "core-only", text: "No sites in worlds; sites only on staging." },
  ],
  chosen: "core-and-full",
  why: OWNER + "Core worlds carry the chain and service (about 0.15 GiB with the lean service, an estimate); full worlds add about 0.1 GiB per busy company (an estimate) on a shared bench of 0.85 GiB (measured). ASSUMPTION: a `core` world needs no Frappe for authority and money paths; settled by running the scenarios' money evals on a core world (the first template eval).",
  affects: [...BASE, d.table_worlds, o.operation_world_create],
});

export const decision_devnet_connection = dec({
  id: "devnet.connection",
  title: "A connection is an address, the caller's key and a grant; one CLI, many worlds",
  question: "How does a person or agent work in one of many worlds from one CLI?",
  options: [
    { label: "address-key-grant", text: "A connection is three things: the world's service address, the caller's key (a reference in the CLI's home, never the key's value) and a grant in that world with a role. `world use <world>` signs a challenge with the key, the service checks the grant and issues a short session, and the CLI stores the connection. Every later command goes to that world's service. The world is chosen by `--world`, else `CAPXUL_WORLD`, else `world use`, in that order, and `world current` says which won. A local devnet is a world whose address is on the laptop (`--address http://127.0.0.1:<port>`). Requests are signed by the key; no bearer token is stored." },
    { label: "per-world-config-files", text: "Each world has its own config file and CLI profile." },
  ],
  chosen: "address-key-grant",
  why: "The owner (docs/mission/critical-path.md): the CLI is the one door (aaron.one-door). ASSUMPTION: Capxul Core's session rpc can accept a key-signed challenge for an address it has no email for; settled by the first agent join eval. The signing is the one place a transaction is approved: a pop-up later (aaron.sign-in-is-core) replaces how a person produces the signature, not what a connection is.",
  affects: [...BASE, life.operation_world_use, life.operation_world_current, p.table_world_grants],
});

export const decision_devnet_identity = dec({
  id: "devnet.identity-travels-with-key",
  title: "Identity travels with the key: joining gives an account, nothing else",
  question: "What does a key get in a world, and what is carried over from another?",
  options: [
    { label: "account-safe-nothing-else", text: "A person or agent has one key. Joining a world creates exactly: a grant (role, seat), Capxul Core's account for the key's address in that world (no email, no profile), the key's Safe at an address that follows from the key and the world (the key's address and the world id are the salt, so one key has a different Safe in every world), the consent record and a `join` entry; then the seat's hats in its company and its starting test funds, both from the scenario's seat through the same doors as anyone's. Nothing is carried from another world: no balance, no hat, no company membership, no session, no consent. A person's key and account are the same as an agent's, and the signer is the one place a transaction is approved." },
    { label: "carry-profile", text: "A global profile follows the key into every world." },
  ],
  chosen: "account-safe-nothing-else",
  why: OWNER + "\"If they've already got keys: here's a new environment\" is `world invite create` for the organiser and `world join` for the participant. ASSUMPTION: the Safe factory's salt can take the world id; settled by deriving the address in two worlds with the real contracts and comparing (the first join eval).",
  affects: [...BASE, acc.operation_world_join, acc.operation_world_invite_create, p.table_world_members],
});

export const decision_devnet_access = dec({
  id: "devnet.access",
  title: "Invitations, join links, three roles, revocation that survives a restore",
  question: "Who may be in a world and how are they let in and out?",
  options: [
    { label: "invite-grant-revoke", text: "Roles: organiser (sets the world up, moves it, invites, exports), player (holds a seat) and viewer (watches; never writes). An invitation is a link `capxul://join/<world>/<code>`: bound to one key when the organiser knows it (the key-holder case), or open for a number of uses; the code is shown once and stored as a hash; it expires (24 hours default) and never outlives its run. A grant is checked by the gateway on every call and on every company's site address. Revoking ends it at once, opens the seat and applies the run's drop-out policy; grants sit outside snapshots so a restore never re-admits a revoked key. A participant with no key runs `world join <link> --new-key`: a test key is made in the CLI's home and a recovery phrase is shown once; it holds test money only; it is never in any record or export. Consent is required to join (`--consent run|train`)." },
    { label: "email-grants", text: "Grants by email as in devnet.shared-world." },
  ],
  chosen: "invite-grant-revoke",
  why: OWNER + "devnet.shared-world's grants by email are replaced by grants by key because a tester in a hundred has a key and an agent has no email; that decision's owner, followers and 'grants outside the snapshots' stay. The `--new-key` path is for agent-side tooling and developers now; a person without a key playing through screens waits on Capxul Core's sign-in (aaron.sign-in-is-core).",
  affects: [...BASE, p.table_world_grants, p.table_world_invitations, acc.operation_world_invite_create, acc.operation_world_invite_list, acc.operation_world_invite_revoke, acc.operation_world_grant_list, acc.operation_world_grant_revoke],
});

export const decision_devnet_agents_first = dec({
  id: "devnet.agents-first",
  title: "Worlds are specified for people, built for agents first; screens wait on Core",
  question: "What is built first, given that people's sign-in and signing are Capxul Core's, designed later?",
  options: [
    { label: "agents-first", text: "Carries out aaron.sign-in-is-core. Every seat can be played by an agent now: agents hold keys and sign with them. The journeys of a human tester (join with a key, play a seat through the screens, watch) are specified and marked as waiting on Core's sign-in design. A viewer link and a human seat in a `full` world are not opened until it exists: `world viewer link` and a human `run seat assign` are refused CAPABILITY_UNAVAILABLE, and nothing is opened to the internet until sign-in is real (the worlds machine's firewall stays closed to all but the operator: docs/mission/sites-host/STATE.md; the spike's stand-in lets anyone become any test person). Nothing in this design may make the later pop-up (a window that shows what is being signed, signs a transaction and proves who the person is) harder: a person's key and account in a world are the same as an agent's, and the signer is the one place a transaction is approved. The sign-in is on the critical path before people use a world's screens; the milestone is not chosen." },
    { label: "stand-in-for-testers", text: "Open the screens to testers now through the stand-in sign-in or a link scheme, and replace it later." },
  ],
  chosen: "agents-first",
  why: decision_aaron_sign_in_is_core.why + " Options named earlier and now parked, for the Core design to weigh: key-signed one-time links minted from the CLI, passkeys, and a gate at the proxy.",
  affects: [...BASE, decision_aaron_sign_in_is_core, acc.operation_world_viewer_link, acc.operation_world_join],
});
