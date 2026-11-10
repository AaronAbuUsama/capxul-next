// Where the worlds platform is, for the portal's Worlds page (top navigation): the ids of the operations, journeys and decisions that are the worlds design, in the order a reader should take them.
// A plain export, not a record. The page opens docs/design/worlds-platform.md first, then these lists (decision devnet.platform-placement).

export const WORLDS_PAGE = {
  document: "docs/design/worlds-platform.md",
  operations: [
    "world.create", "world.list", "world.show", "world.use", "world.current", "world.pause", "world.park", "world.resume", "world.destroy", "world.register", "world.approve",
    "world.clock.set", "world.clock.freeze", "world.clock.resume", "world.clock.warp", "world.snapshot.save", "world.snapshot.list", "world.snapshot.restore",
    "world.invite.create", "world.invite.list", "world.invite.revoke", "world.join", "world.grant.list", "world.grant.revoke", "world.viewer.link",
    "scenario.save", "scenario.list", "scenario.show", "scenario.check",
    "cohort.create", "cohort.list", "cohort.show", "cohort.close",
    "run.create", "run.list", "run.show", "run.start", "run.close", "run.seat.assign", "run.seat.drop", "run.check", "run.export", "run.accept", "run.archive", "run.redact",
    "env.reset", "env.step", "env.state", "env.close", "record.list", "record.show", "record.export",
  ],
  journeys: ["organiser_runs_a_cohort", "agent_plays_a_seat", "tester_plays_through_screens", "run_closes_and_is_accepted", "learner_uses_a_core_world", "world_parks_and_wakes", "run_a_world"],
  decisions: [
    "aaron.sign-in-is-core", "devnet.worlds-platform", "devnet.profiles", "devnet.connection", "devnet.identity-travels-with-key", "devnet.access", "devnet.agents-first", "devnet.scenario", "devnet.runs-and-cohorts",
    "devnet.world-capacity", "devnet.dataset", "devnet.reproducible", "devnet.consent-and-privacy", "devnet.env-interface", "devnet.production-is-a-world", "devnet.parking", "devnet.platform-placement",
    "devnet.world-first-class", "devnet.lean-world", "devnet.site-follows-world", "devnet.time-is-right", "devnet.world-registers-hosted", "devnet.viewer-grant", "devnet.first-template", "devnet.record-entry", "devnet.worlds-never-see-each-other",
  ],
  tables: ["worlds", "world-grants", "world-invitations", "world-members", "scenarios", "cohorts", "runs", "run-seats", "run-datasets", "command-records", "world-snapshots"],
} as const;
