// Moved out of the built book by the cut, 10 November 2026, from books/target/shared/time.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md. Seasons were dropped for now by Aaron's answer to devnet.seasons
// (aaron.seasons-dropped, cut.seasons); the code that follows is as it was when the book last held them.

export const decision_time_seasons = defineDecision({
  id: "time.seasons",
  title: "A shared world's time runs in seasons; a world's epoch can change under anyone",
  question:
    "A shared world runs in seasons, like a game: each starts from a known world, runs at a rate, jumps on a schedule " +
    "and ends in a reset, after which the next starts. A season's schedule is set on real time, and its " +
    "start and its reset each replace the whole world. What must every concept, component and client hold to, so that " +
    "time still means one thing inside a world that runs in seasons?",
  options: [
    {
      label: "season-rules",
      text:
        "For aaron.seasons, four rules. (1) A season's schedule (its start, its jumps, its end) is on real time, as the rate is: it is how " +
        "the world's clock relates to real time, held by the time authority alone, and no product decision reads it; " +
        "inside the world every decision reads now, and a jump is a warp, so what falls due on the way runs at its own " +
        "instant (time.due-fires-once). (2) A season's start and its reset are restores, so the world's epoch changes " +
        "under everyone in it: a client treats a session the world no longer knows as ended when the backend refuses it (a " +
        "person signs in again; an agent's SDK signs its challenge again), takes now again from the next answer " +
        "(time.clients-take-server-now), and keeps nothing else across epochs that the " +
        "world must agree with; a " +
        "follower takes the new world from the `restore` event; and a component that keeps world state outside the " +
        "chain and Postgres (a real bench, the world's FDE namespace) saves and restores it with the world, or the " +
        "restore is refused. (3) Every channel stays in its world across seasons (time.world-channels): each is restored " +
        "with the reset world, and nothing a season sent leaves it or survives its reset except in the world its end " +
        "keeps. (4) Within a season, time only moves forward: the restores at its start and its end are the only moves " +
        "back (time.monotonic). The devnet's decisions say how: devnet.seasons, devnet.season-players, " +
        "devnet.season-jumps, devnet.season-reset and devnet.stateful-followers.",
    },
    { label: "world-time-schedule", text: "Set a season's schedule on the world's own clock: jump when the world reaches a date." },
  ],
  chosen: "season-rules",
  why:
    "A schedule on the world's own clock could never fire on a frozen world and would fire at the rate's pace on a " +
    "running one, so players could not plan their days around it; a real-time schedule relates the two clocks once, as " +
    "the rate does, and leaves every decision inside the world on now. A world replaced under its clients is new to the " +
    "rebuild: the 215 assumed a world lasted, so the rule is written once here, where every client and component " +
    "reads it, rather than rediscovered by each when a season resets.",
  source: SEASONS("books/target/shared/rulings.ts (aaron.seasons); books/target/devnet/decisions.ts (the season decisions); docs/design/time.md section 8"),
  affects: [f.system_capxul, f.environment_shared_world, f.component_devnet, ...CLIENTS, x.integration_devnet_control, x.integration_fde_host],
});

export const invariant_time_season_schedule = defineInvariant({
  id: "time.season-schedule",
  title: "A season starts, jumps and ends at its real times",
  about:
    "A season's schedule (devnet.seasons, devnet.season-jumps), checked on a shared world at rates 1 and 4 with jumps " +
    "a few real seconds apart, a jump that falls due while the owner's warp runs, a jump whose target has passed, a " +
    "stop held busy by a follower, and the supervisor restarted across a due jump: each event runs once, at or after " +
    "its real instant, and a jump moves the world exactly as far as its span or to its date.",
  statement:
    "A planned season with a start, unless cancelled first, starts once at or after that instant; each warp of a " +
    "running season runs once at or after its instant, as a barrier, or is recorded skipped, failed, cut or removed; " +
    "the season ends once at or after its real end, no warp of it run after.",
  over: [],
  check: "property",
});

export const invariant_time_season_reset = defineInvariant({
  id: "time.season-reset",
  title: "A season's end keeps its world and resets to the reset world, whole",
  about:
    "What a season's end promises (devnet.season-reset, devnet.stateful-followers): after the end, the harness diffs " +
    "the world against the season's reset world (the chain's block and state, every Postgres schema, the devnet " +
    "tables, Ponder's checkpoint, each stateful follower's own state) and the saved `<name>-end` against the world as " +
    "it stood when the end began; and from a player's own CLI home, once a season they play runs, their old session is " +
    "refused NOT_AUTHENTICATED and their money and mail are the new world's.",
  statement:
    "When a season ends, `<name>-end` holds the world as it stood when the end began, the world equals its reset world " +
    "(chain, Postgres, Ponder, every stateful follower) frozen at that world's now under a new epoch, and no session, " +
    "message or balance of the season remains in it.",
  over: [],
  check: "property",
});
