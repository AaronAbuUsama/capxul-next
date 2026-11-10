// Moved out of the built book by the cut, 10 November 2026, from books/target/shared/external.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md. Seasons were dropped for now by Aaron's answer to devnet.seasons
// (aaron.seasons-dropped, cut.seasons); the code that follows is as it was when the book last held them.

// Plain text: the helpers and the eleven `calls` of the `devnet-control` integration that served the season commands. They sat inside
// integration_devnet_control (which stays, trimmed), so they are kept here as they were and are not a record of their own.

/** A season call that names no season, or gives a time, world or player the supervisor cannot use (decision devnet.seasons). */
const seasonInput = (when: string) => ({ when, error: error_INVALID_INPUT }) as const;
/** A season call on a season in the wrong state for it (decision devnet.seasons). */
const seasonState = (when: string) => ({ when, error: error_WRONG_STATE }) as const;
/** A season's start or end restores a world, so it is sized like snapshotRestore (decision devnet.season-protocol). */
const SEASON_BARRIER = { timeoutMs: 60_000, ...CONTROL, p95Ms: 10_000 } as const;

// calls: { ... }, after timeWatch, snapshot and follower calls
    seasonList: {
      about:
        "GET /v1/seasons?after=&limit=: a page of every season of this world, the running one first, then the planned by " +
        "start, then the ended and cancelled, newest first, and the next cursor. Any grant may read it.",
      ...CLOCK_CALL,
      failures: [...controlFailures, seasonInput("The cursor is not one this list gave")],
    },
    seasonCurrent: {
      about:
        "GET /v1/seasons/current: the season running, else the next planned, else the last ended, else none; whether " +
        "the caller plays it, its next scheduled warp, and the clock. Any grant may read it, between seasons too.",
      ...CLOCK_CALL,
      failures: [...controlFailures],
    },
    seasonCreate: {
      about:
        "POST /v1/seasons: keeps a planned season, its starting and reset worlds, rate, real window, warps and players; " +
        "nothing in the world moves.",
      ...CLOCK_CALL,
      failures: [
        ...controlFailures,
        seasonInput(
          "A starting or reset world that is not saved here (the refusal lists them), an end not later than the start or now, a start not later than now, a warp outside the window, a window that overlaps another planned or running season (naming it), or a player who holds no world grant here",
        ),
        seasonState("A season has had that name, or `<name>-end` is a saved world"),
        ownerOnly,
      ],
    },
    seasonChange: {
      about: "POST /v1/seasons/<name>/change: a season's start, end, rate or reset world.",
      ...CLOCK_CALL,
      failures: [
        ...controlFailures,
        seasonInput("No season has that name, the end is not later than now or the start, the window overlaps another season's, or the reset names no saved world"),
        seasonState("The season has ended or was cancelled, or it runs and the change gives a start or a rate"),
        ownerOnly,
      ],
    },
    seasonStart: {
      about:
        "POST /v1/seasons/<name>/start: with `check`, answers what starting would do and changes nothing; without it, " +
        "restores the season's starting world (every stateful follower restoring its own), runs the clock at its rate, " +
        "arms its warps and end on the real clock and admits its players.",
      ...SEASON_BARRIER,
      failures: [
        ...controlFailures,
        seasonInput("No season has that name"),
        seasonState(
          "The season is running, ended or cancelled, another season runs, its end has passed, or its starting world was saved with other backend code or lacks a stateful follower joined now; the refusal names which",
        ),
        ownerOnly,
      ],
    },
    seasonEnd: {
      about:
        "POST /v1/seasons/<name>/end: with `check`, answers what ending would do and changes nothing; without it, stops " +
        "admitting its players, cuts a warp in progress at its next settled stop, freezes the clock, saves `<name>-end` and " +
        "restores the season's reset world, frozen, under a new world epoch.",
      ...SEASON_BARRIER,
      failures: [
        ...controlFailures,
        seasonInput("No season has that name"),
        seasonState("The season is not running; a planned one's refusal names `dev season cancel`"),
        ownerOnly,
      ],
    },
    seasonCancel: {
      about: "POST /v1/seasons/<name>/cancel: takes back a planned season before it runs; nothing in the world changes.",
      ...CLOCK_CALL,
      failures: [
        ...controlFailures,
        seasonInput("No season has that name"),
        seasonState("The season is not planned; a running one's refusal names `dev season end`"),
        ownerOnly,
      ],
    },
    seasonWarpAdd: {
      about:
        "POST /v1/seasons/<name>/warps: schedules a warp of the world's clock, by a span or to a world date, at a real " +
        "instant, or one each `every` until the season's end, at most 500.",
      ...CLOCK_CALL,
      failures: [
        ...controlFailures,
        seasonInput("No season has that name, or the real instant is not later than now or outside the season's window"),
        seasonState("The season has ended or was cancelled"),
        ownerOnly,
      ],
    },
    seasonWarpRemove: {
      about: "POST /v1/seasons/<name>/warps/<warp>/remove: takes a scheduled warp out before it runs; it stays in the schedule as removed.",
      ...CLOCK_CALL,
      failures: [
        ...controlFailures,
        seasonInput("No season or warp has that name"),
        seasonState("The warp has run, failed, been skipped or removed, or the season has ended or was cancelled"),
        ownerOnly,
      ],
    },
    seasonPlayerAdd: {
      about: "POST /v1/seasons/<name>/players: lets a person who holds a world grant play the season; while it runs, the gateway admits them at once.",
      ...CLOCK_CALL,
      failures: [
        ...controlFailures,
        seasonInput("No season has that name, or the email holds no world grant here (the refusal names `capxul-devnet world grant`)"),
        seasonState("The season has ended or was cancelled"),
        ownerOnly,
      ],
    },
    seasonPlayerRemove: {
      about: "POST /v1/seasons/<name>/players/<email>/remove: stops a person playing the season; while it runs, the gateway refuses their next call.",
      ...CLOCK_CALL,
      failures: [
        ...controlFailures,
        seasonInput("No season has that name, or the email does not play it"),
        seasonState("The season has ended or was cancelled"),
        ownerOnly,
      ],
    },
