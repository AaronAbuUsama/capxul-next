// Moved out of the built book by the cut, 10 November 2026, from books/target/devnet/data.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { Schema } from "effect";
import { defineTable } from "../../../packages/book/src/index.ts";
import { concept_devnet } from "../shared/foundation.ts";

export const table_fde_host_agents = defineTable({
  id: "fde-host-agents",
  title: "FDE host agents: each stand-in hosted FDE, its key, state and fault switch",
  about:
    "The stand-in FDE host (the `fde-host` integration's devnet fake, served by the supervisor on loopback; " +
    "organizations.fde-host) keeps one row per hosted FDE it provisioned: the agent id (`fde:<orgId>`), the devnet key " +
    "it made for it, kept here and never returned to the backend but its address, its state (provisioned, running, " +
    "paused, retired), and its turns as scripted replies: a message's turn ends as it is posted, with the FDE's " +
    "scripted reply, so the first `turn` read finds it ended and an eval reads a fixed answer on a frozen clock, with " +
    "no stop to wait for. Each turn keeps the asker and the act-for token its `send` carried. `capxul-devnet fde run <org> " +
    "[--ask <askId>] -- <command>` runs a Capxul command as the FDE, signed with its key, as the hosted FDE's own tool " +
    "would: with `--ask`, under that ask's turn's act-for token, which the stand-in keeps after the turn ends so an eval " +
    "sees Capxul, not the host, stop honouring it; without, with no token, so the FDE acts as itself and every guard " +
    "refuses it (devnet.world-pass-worlds). `capxul-devnet fault fde-host <mode>` arms its switch: `down` (every call " +
    "is PROVIDER_ERROR), `hold` (new turns stay working until cleared, then end with their reply) or `clear`. It joins " +
    "the clock as a follower with no next due, idle always (a held turn counts as idle, as every armed hold does). " +
    DEVNET_ONLY,
  was: ["organizations.fde-host", "books/target/shared/rulings.ts (aaron.fde-hosted)"],
  concept: concept_devnet,
  tenancy: "global",
  fields: Schema.Struct({
    agent_id: S,
    org_id: S,
    /** The devnet key it made: a fixed devnet value derived from the agent id, so a rebuilt world makes the same one. */
    private_key: S,
    signer_address: S,
    state: Schema.Literals(["provisioned", "running", "paused", "retired"]),
    /** Turns asked, by turn id: ended with its reply at once, or working while `hold` is armed. */
    turns: Schema.Array(
      Schema.Struct({
        turn_id: S,
        status: Schema.Literals(["working", "ended", "failed"]),
        reply: Schema.NullOr(S),
        /** The ask the turn answers and its act-for token, as `send` carried them (devnet keys only). */
        ask_id: Schema.NullOr(S),
        act_for_token: Schema.NullOr(S),
      }),
    ),
    fault: Schema.Literals(["none", "down", "hold"]),
    created_at: Instant,
    updated_at: Instant,
  }),
  key: ["agent_id"],
  indexes: [{ name: "by_org", fields: ["org_id"], for: "`capxul-devnet fde run <org>`: the Organization's stand-in FDE." }],
  retention: "Kept for the world's life; a restore puts back the stand-in FDE the world had, with its key.",
});
