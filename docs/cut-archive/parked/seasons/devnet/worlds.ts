// Moved out of the built book by the cut, 10 November 2026, from books/target/devnet/worlds.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md. Seasons were dropped for now by Aaron's answer to devnet.seasons
// (aaron.seasons-dropped, cut.seasons); the code that follows is as it was when the book last held them.

// Plain text: the three catalogued eval worlds that the `dev season` commands built, and their names in `W`. They are catalog
// data, not records, so the index does not list them. `shared-world-owner`, which they were built from, stays in the catalog.

  // ── seasons: a shared world's seasons (aaron.seasons; devnet.seasons, devnet.season-worlds) ──
  // Last in the catalog: each names catalogued worlds (person-with-funded-safe, person-ready) as a season's start, so
  // every other world is built and saved before them.
  // Each is built by its steps on a fresh shared world every time an eval uses it, since its grants and seasons live
  // outside the snapshots, and a running season runs on real time, so these are the catalog's only worlds whose clock
  // runs. A player's command runs from that player's own CLI home, which the harness keeps outside the world's
  // snapshots as their own machine would be; the owner's runs from the eval machine's.
  {
    name: "season-planned",
    holds:
      "shared-world-owner with season s1 planned by the owner: from person-with-funded-safe (Dana ready with 1,000 USDC " +
      "in her Safe, Sam ready), reset to the same world, rate 4, ending two real hours after it was made, one warp w1 " +
      "of 30 days an hour after it was made, and Dana its one player. The world itself is unchanged: frozen at the eval " +
      "epoch at rate 1, no season running, so the gateway refuses Dana's and Ana's backend calls WRONG_STATE.",
    from: "shared-world-owner",
    steps: [anyone("capxul dev season create s1 --snapshot person-with-funded-safe --rate 4 --end +2h --warp +1h=30d --player dana@acme.test")],
    env: { CAPXUL_BOOTSTRAP_URL: "<the world's gateway on loopback>", CAPXUL_WORLD_GRANT: "<the owner's grant file>" },
    namedBy: ["devnet"],
  },
  {
    name: "season-running",
    holds:
      "season-planned after the owner started s1: the world is person-with-funded-safe's under a new epoch, its clock " +
      "running at rate 4 and naming s1, w1 still scheduled. Dana signed in from her own CLI home and paid Sam 5 USDC, " +
      "settled, so her Safe holds 995 USDC; her season's mail (the sign-in code, the payment's notices) is in the sink. " +
      "Ana holds a grant but does not play s1.",
    from: "season-planned",
    steps: [
      anyone("capxul dev season start s1 --confirm"),
      step(
        "dana@acme.test",
        "from her own CLI home, with her grant: capxul auth login dana@acme.test; capxul auth verify <the code `capxul dev mail list --to dana@acme.test` shows>",
      ),
      step("dana@acme.test", "capxul payment send sam@acme.test 5 --json; capxul dev approve --as dana@acme.test <its approval>; until it is settled"),
    ],
    env: { CAPXUL_BOOTSTRAP_URL: "<the world's gateway on loopback>", CAPXUL_WORLD_GRANT: "<the owner's grant file>" },
    namedBy: ["devnet"],
  },
  {
    name: "season-ended",
    holds:
      "season-running after the owner ended s1: s1 ended, its last state (Dana's 995 USDC and her payment to Sam) saved " +
      "as the world s1-end, and the world reset to person-with-funded-safe, frozen at its now under a new epoch, with no " +
      "season running. Dana's own CLI home still holds her s1 session, which this world does not know, and the sink " +
      "holds none of s1's mail.",
    from: "season-running",
    steps: [anyone("capxul dev season end s1 --confirm")],
    env: { CAPXUL_BOOTSTRAP_URL: "<the world's gateway on loopback>", CAPXUL_WORLD_GRANT: "<the owner's grant file>" },
    namedBy: ["devnet"],
  },

// in W:
//   seasonPlanned: "season-planned", seasonRunning: "season-running", seasonEnded: "season-ended",
