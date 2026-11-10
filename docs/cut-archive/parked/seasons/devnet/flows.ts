// Moved out of the built book by the cut, 10 November 2026, from books/target/devnet/flows.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md. Seasons were dropped for now by Aaron's answer to devnet.seasons
// (aaron.seasons-dropped, cut.seasons); the code that follows is as it was when the book last held them.

// ── seasons: the `dev season` commands (aaron.seasons; decision devnet.seasons) ─────────────────

/**
 * Where a season is in its life (decision devnet.seasons): made and waiting (`planned`), running in the world, over
 * after it ran, its last world kept (`ended`), or taken back before it ran, by `dev season cancel` or by its real end
 * coming first (`cancelled`), which touches nothing in the world.
 */
export const SeasonState = Schema.Literals(["planned", "running", "ended", "cancelled"]);
/**
 * Where one of a season's scheduled warps is: due at its real instant, running, done, cut short at a settled stop by
 * the season's end, failed at a stop that did not settle, skipped (its target was not later than now when it came due,
 * the season ended or was cancelled before it came due, or the season's end was overdue too) or removed before it ran (decision
 * devnet.season-jumps).
 */
export const SeasonWarpState = Schema.Literals(["scheduled", "running", "done", "cut", "failed", "skipped", "removed"]);
/** One warp of a season's schedule: a warp of the world's clock that the supervisor runs at a real instant. */
export const SeasonWarp = Schema.Struct({
  /** `w1`, `w2`, … in the order they were added to the season. */
  id: S,
  /** The real instant it comes due. */
  at: Instant,
  /** How far it warps, as `dev time warp` takes it (`30d`), or null when it warps to `to`. */
  by: Schema.NullOr(S),
  /** The world instant it warps to, or null when it warps by `by`. */
  to: Schema.NullOr(Instant),
  state: SeasonWarpState,
  /** The real instant it began, or null while scheduled or removed. */
  ranAt: Schema.NullOr(Instant),
  /** The world's now when it began and where it stood when it ended, or null until it runs. */
  from: Schema.NullOr(Instant),
  reached: Schema.NullOr(Instant),
  /** The stops it made, or null until it runs. */
  stops: Schema.NullOr(Schema.Int),
  /** For a cut, failed or skipped warp: why, with the stop and the busy followers; else null. */
  note: Schema.NullOr(S),
});
/**
 * A season, as the supervisor keeps it on the world's host outside the world's snapshots, beside the grants (decision
 * devnet.seasons). Its start, end and warps are real instants; the world's own times are its clock's.
 */
export const Season = Schema.Struct({
  /** Lowercase letters, digits and hyphens, up to 36 characters, so that `<name>-end` is a world's name. Never reused. */
  name: S,
  state: SeasonState,
  /** The saved world it starts from. */
  from: S,
  /** The saved world its end restores: its own `from` unless it was given another. */
  reset: S,
  /** The world seconds per real second its clock runs at from its start (decision devnet.clock-rate). */
  rate: ClockRate,
  /** The real instant it starts itself, or null when its owner starts it with `dev season start`. */
  startAt: Schema.NullOr(Instant),
  /** The real instant it ends itself. */
  endAt: Instant,
  /** The real instants it started and ended (or was cancelled), or null until they happen. */
  startedAt: Schema.NullOr(Instant),
  endedAt: Schema.NullOr(Instant),
  /** The world epoch its start began (the clock's `world`), or null until it starts. */
  world: Schema.NullOr(S),
  /** The emails of the people who play it, each holding a world grant (decision devnet.season-players). */
  players: Schema.Array(S),
  warps: Schema.Array(SeasonWarp),
  /** The saved world that keeps its last state, `<name>-end`, once a running season ended; else null. */
  final: Schema.NullOr(S),
  /** A scheduled start that could not happen, and why (the season stays planned, or is cancelled when its end came first); else null. */
  note: Schema.NullOr(S),
});

const SEASON_RULE = "lowercase letters, digits and hyphens, up to 36 characters";
const WHEN =
  "A real time is an ISO 8601 instant with its zone, or `+<span>` (`+2h`, `+28d`), which the supervisor resolves against " +
  "its own real clock as it answers.";
/*
 * Each season flow calls its request of the `devnet-control` integration (decision devnet.season-protocol); the
 * supervisor's answers (INVALID_INPUT, WRONG_STATE, ROLE_PERMISSION_DENIED) are those calls' failures, and a flow's own
 * errors are only what the SDK refuses before any call.
 */
const OWNER_ONLY =
  "Only the world's owner may: on a local devnet anyone on the machine, in a shared world the holder of its owner grant; " +
  "a joiner's grant is ROLE_PERMISSION_DENIED (decision devnet.season-players).";

export const flow_devnet_seasons_create = defineFlow({
  id: "devnet.seasons.create",
  title: "Plan a season: its starting world, rate, end, warps and players",
  about:
    "`dev season create <name> --snapshot <world> --end <when> [--start <when>] [--rate <n>] [--reset <world>] [--player " +
    `<email>]… [--warp <when>=<span|date>]…\`. The SDK refuses a name that is not ${SEASON_RULE}, a rate that is not ` +
    `${RATE_RULE}, an unreadable time and a \`--warp\` without both parts (INVALID_INPUT) before any call. ${WHEN} The ` +
    "supervisor refuses a `--snapshot` or `--reset` that names no world saved here (INVALID_INPUT, listing them), an end " +
    "not later than the start (or now), a start not later than now, a warp outside the season's window, a window that " +
    "overlaps another planned or running season (naming it) and a player who holds no world grant here (a local devnet " +
    "has none) (INVALID_INPUT); a name any season has had, or one whose `<name>-end` is a saved world (WRONG_STATE). " +
    "Then it keeps the season, planned: nothing in the world moves. Its reset is its own `from` unless `--reset` names " +
    "another world, the next season's start. " + OWNER_ONLY,
  component: component_core_sdk,
  sdk: "devnet.seasons.create",
  input: Schema.Struct({
    name: S,
    from: S,
    end: S,
    start: Schema.optionalKey(S),
    rate: Schema.optionalKey(ClockRate),
    reset: Schema.optionalKey(S),
    players: Schema.Array(S),
    warps: Schema.Array(Schema.Struct({ at: S, by: Schema.optionalKey(S), to: Schema.optionalKey(S) })),
  }),
  output: Season,
  steps: [
    { name: "season", local: "build", about: `The name (${SEASON_RULE}), the rate (${RATE_RULE}), the times and each \`--warp\` split into its real instant and its span or date.` },
    { name: "create", local: "cache", about: "The supervisor's season create (POST /v1/seasons): checks the worlds, the window and the players, then keeps the season, planned." },
  ],
  errors: [error_INVALID_INPUT],
  calls: [control.seasonCreate],
  spans: [],
  budget: budget("write"),
});

export const flow_devnet_seasons_change = defineFlow({
  id: "devnet.seasons.change",
  title: "Change a season's start, end, rate or reset",
  about:
    "`dev season change <name> [--start <when>] [--end <when>] [--rate <n>] [--reset <world>]`. A change that gives " +
    "nothing, an unreadable time or a rate that is not " + RATE_RULE + " is INVALID_INPUT before any call (G6). " + WHEN +
    " The supervisor refuses a name no season has, an end not later than now (or the start), a window that overlaps " +
    "another season's and a `--reset` that names no saved world (INVALID_INPUT); an ended or cancelled season, and " +
    "`--start` or `--rate` once it runs (WRONG_STATE: a running season's clock takes its rate from `dev time set`). Moving the end " +
    "of a running season moves when it ends and resets; a scheduled warp left after the new end is skipped when the " +
    "season ends. It answers the season. " + OWNER_ONLY,
  component: component_core_sdk,
  sdk: "devnet.seasons.change",
  input: Schema.Struct({
    name: S,
    start: Schema.optionalKey(S),
    end: Schema.optionalKey(S),
    rate: Schema.optionalKey(ClockRate),
    reset: Schema.optionalKey(S),
  }),
  output: Season,
  steps: [
    { name: "fields", local: "build", about: "At least one field, each readable; nothing given is INVALID_INPUT." },
    { name: "change", local: "cache", about: "The supervisor's season change (POST /v1/seasons/<name>/change)." },
  ],
  errors: [error_INVALID_INPUT],
  calls: [control.seasonChange],
  spans: [],
  budget: budget("write"),
});

const PREVIEW =
  "It previews what it will do and asks, since nothing undoes it (G5): a person who answers no ends it CANCELLED with " +
  "nothing changed, and a script passes `--confirm`, without which it is CLI_USAGE (vocabulary.declined-preview-cancelled).";

export const flow_devnet_seasons_start = defineFlow({
  id: "devnet.seasons.start",
  title: "Start a season now: its starting world, running at its rate",
  about:
    "`dev season start <name> [--confirm]`. The supervisor first checks the start without making it (a name no season " +
    "has is INVALID_INPUT; a season running, ended or cancelled, another season running, its end already past, or its starting world " +
    "saved with other backend code or without a stateful follower joined now is WRONG_STATE, naming which) and answers " +
    "what it will do: replace the world with `from`, at that world's now, run at the season's rate until its end, with " +
    "its warps and players. " + PREVIEW + " Then it starts the season as it would at a scheduled start: it restores " +
    "`from` (the clock frozen at its now while it works, every stateful follower restoring its own state, a new world " +
    "epoch), sets the clock's rate to the season's, lets it run, arms the season's warps and end on its real clock, and " +
    "has the world's gateway admit the season's players (decision devnet.season-reset). It answers the season and the " +
    "clock, which names the season. " + OWNER_ONLY,
  component: component_core_sdk,
  sdk: "devnet.seasons.start",
  input: Schema.Struct({ name: S, confirm: B }),
  output: Schema.Struct({ season: Season, clock: Clock, tookMs: N }),
  steps: [
    { name: "check", local: "cache", about: "The supervisor's season start with `check` (POST /v1/seasons/<name>/start): refusals first, then what it would do; nothing changes." },
    { name: "preview", local: "prompt", about: "What starting replaces and runs; no is CANCELLED, a script without `--confirm` CLI_USAGE." },
    { name: "start", local: "cache", about: "The supervisor's season start: restore `from`, set the rate, run, arm the warps and the end, admit the players." },
  ],
  errors: [error_CANCELLED],
  calls: [control.seasonStart],
  spans: [],
  budget: budget("background"),
});

export const flow_devnet_seasons_end = defineFlow({
  id: "devnet.seasons.end",
  title: "End a season now: keep its last state, then reset the world",
  about:
    "`dev season end <name> [--confirm]`. The supervisor first checks the end without making it (a name no season has " +
    "is INVALID_INPUT; a season that is not running is WRONG_STATE, and a planned one's refusal names `dev season " +
    "cancel`, so `end` always resets the world) and answers what it will do. " + PREVIEW + " The end does what the " +
    "season's scheduled end does (decision " +
    "devnet.season-reset): the world's gateway stops admitting its players; a warp in progress stops at its next settled " +
    "stop (`cut`) and the warps still scheduled are skipped; the clock freezes; the world is saved as `<name>-end`, its " +
    "last state, every stateful follower saving its own; then the season's reset world is restored, frozen at its now " +
    "under a new world epoch, every stateful follower restoring its own state, and stays so until the next season " +
    "starts. It answers the season, its last world and the clock. " + OWNER_ONLY,
  component: component_core_sdk,
  sdk: "devnet.seasons.end",
  input: Schema.Struct({ name: S, confirm: B }),
  output: Schema.Struct({ season: Season, final: Snapshot, clock: Clock, tookMs: N }),
  steps: [
    { name: "check", local: "cache", about: "The supervisor's season end with `check` (POST /v1/seasons/<name>/end): refusals first, then what it would do; nothing changes." },
    { name: "preview", local: "prompt", about: "What ending saves and resets; no is CANCELLED, a script without `--confirm` CLI_USAGE." },
    { name: "end", local: "cache", about: "The supervisor's season end: close the gateway to its players, stop its warps, freeze, save `<name>-end`, restore the reset world." },
  ],
  errors: [error_CANCELLED],
  calls: [control.seasonEnd],
  spans: [],
  budget: budget("background"),
});

export const flow_devnet_seasons_cancel = defineFlow({
  id: "devnet.seasons.cancel",
  title: "Cancel a planned season before it runs",
  about:
    "`dev season cancel <name>`. The supervisor refuses a name no season has (INVALID_INPUT) and a season that is not " +
    "planned (WRONG_STATE): a running one's refusal names `dev season end`, which ends and resets, so a script that " +
    "meant to drop a planned season that has since started is refused rather than resetting the world. It cancels the " +
    "season: its start and its warps never run (its warps `skipped`), its name is never used again, and nothing in the " +
    "world changes, so, as `payment cancel` takes back a scheduled payment, it does not preview. A planned season " +
    "whose real end comes before it starts is cancelled the same way, its `note` saying so (decision devnet.seasons). " +
    "It answers the season. " + OWNER_ONLY,
  component: component_core_sdk,
  sdk: "devnet.seasons.cancel",
  input: Schema.Struct({ name: S }),
  output: Season,
  steps: [{ name: "cancel", local: "cache", about: "The supervisor's season cancel (POST /v1/seasons/<name>/cancel)." }],
  errors: [],
  calls: [control.seasonCancel],
  spans: [],
  budget: budget("write"),
});

export const flow_devnet_seasons_show = defineFlow({
  id: "devnet.seasons.show",
  title: "Show the world's current season, its next warp and whether you play it",
  about:
    "`dev season show`. The current season is the one running, else the next planned (by its start; one its owner " +
    "starts by hand after any with a start), else the last ended, else none; a cancelled season never ran, so it is never " +
    "current. It answers that season, whether the " +
    "caller plays it (a joiner's grant names an email among its players; the owner and anyone on a local devnet play " +
    "every season), its next scheduled warp and the clock. Any grant may read it, between seasons too, so a player " +
    "can see when the next season starts and the world will jump (decision devnet.season-players). It changes nothing.",
  component: component_core_sdk,
  sdk: "devnet.seasons.show",
  input: Schema.Struct({}),
  output: Schema.Struct({ season: Schema.NullOr(Season), playing: B, next: Schema.NullOr(SeasonWarp), clock: Clock }),
  steps: [{ name: "read", local: "cache", about: "The supervisor's current season (GET /v1/seasons/current), with the clock." }],
  errors: [],
  calls: [control.seasonCurrent],
  spans: [],
  budget: budget("read"),
});

export const flow_devnet_seasons_list = defineFlow({
  id: "devnet.seasons.list",
  title: "List every season of this world: running, planned, ended",
  about:
    "`dev season list [--after <cursor>] [--limit <n>]`. Every season this world has had, the running one first, then " +
    "the planned by start (those its owner starts by hand last), then the ended and cancelled, newest first by when they " +
    "ended; each with its starting and reset worlds, rate, window, players, warps (each with its outcome) and last " +
    "world. It is paged as every list is (G5, G9): `--limit` from 1 to 100, 20 unless given, and `--after` the cursor " +
    "a page gave; a limit out of range is INVALID_INPUT before any call, and a cursor the list did not give is the " +
    "supervisor's INVALID_INPUT. Any grant may read it, and it changes nothing.",
  component: component_core_sdk,
  sdk: "devnet.seasons.list",
  input: Schema.Struct({ after: Schema.optionalKey(S), limit: Schema.optionalKey(Schema.Int) }),
  output: Schema.Struct({ seasons: Schema.Array(Season), nextCursor: Schema.NullOr(S) }),
  steps: [
    { name: "page", local: "build", about: "`--limit` from 1 to 100 (20 unless given); out of range is INVALID_INPUT." },
    { name: "list", local: "cache", about: "The supervisor's seasons (GET /v1/seasons?after=&limit=), a page and the next cursor." },
  ],
  errors: [error_INVALID_INPUT],
  calls: [control.seasonList],
  spans: [],
  budget: budget("read"),
});

export const flow_devnet_seasons_warps_add = defineFlow({
  id: "devnet.seasons.warps.add",
  title: "Schedule a warp in a season: at a real time, by a span or to a world date",
  about:
    "`dev season warp add <season> (<span> | --to <date>) --at <when> [--every <span>]`, the span or date as `dev time " +
    "warp` takes them. Both or neither of a span and `--to`, an unreadable time or span, and `--every` under one real minute are INVALID_INPUT before any call. " +
    WHEN + " The supervisor refuses a season no one has made and an `--at` not later than now or outside the season's " +
    "window (INVALID_INPUT); an ended or cancelled season (WRONG_STATE). It adds the warp, `w<n>`, or with `--every` one warp at " +
    "`--at` and one each `--every` of real time after it until the season's end, at most 500. At its real instant the " +
    "supervisor warps the world as `dev time warp` does: a barrier through every due instant on the way, the clock " +
    "keeping its mode and rate (decision devnet.season-jumps). It answers the season. " + OWNER_ONLY,
  component: component_core_sdk,
  sdk: "devnet.seasons.warps.add",
  input: Schema.Struct({ season: S, at: S, by: Schema.optionalKey(S), to: Schema.optionalKey(S), every: Schema.optionalKey(S) }),
  output: Season,
  steps: [
    { name: "warp", local: "build", about: "The real instant, one of the span and the date, and the repeat; both or neither of a span and `--to` is INVALID_INPUT." },
    { name: "add", local: "cache", about: "The supervisor's warp add (POST /v1/seasons/<season>/warps)." },
  ],
  errors: [error_INVALID_INPUT],
  calls: [control.seasonWarpAdd],
  spans: [],
  budget: budget("write"),
});

export const flow_devnet_seasons_warps_remove = defineFlow({
  id: "devnet.seasons.warps.remove",
  title: "Take a scheduled warp out of a season before it runs",
  about:
    "`dev season warp remove <season> <warp>`. The supervisor refuses a season or warp that does not exist " +
    "(INVALID_INPUT), and a warp that has already run, failed, been skipped or removed, or a season that has ended or was cancelled " +
    "(WRONG_STATE). The warp stays in the season's schedule as `removed` and never runs. It answers the season. " +
    OWNER_ONLY,
  component: component_core_sdk,
  sdk: "devnet.seasons.warps.remove",
  input: Schema.Struct({ season: S, warp: S }),
  output: Season,
  steps: [{ name: "remove", local: "cache", about: "The supervisor's warp remove (POST /v1/seasons/<season>/warps/<warp>/remove)." }],
  errors: [],
  calls: [control.seasonWarpRemove],
  spans: [],
  budget: budget("write"),
});

export const flow_devnet_seasons_players_add = defineFlow({
  id: "devnet.seasons.players.add",
  title: "Let a person play a season",
  about:
    "`dev season player add <season> <email>`. The supervisor refuses a season no one has made, and an email that holds " +
    "no world grant here (INVALID_INPUT, naming `capxul-devnet world grant`, which makes one; a local devnet has none); " +
    "an ended or cancelled season (WRONG_STATE). Adding a player who already plays changes nothing. While the season runs, the " +
    "world's gateway admits the player's grant at once (decision devnet.season-players). It answers the season. " +
    OWNER_ONLY,
  component: component_core_sdk,
  sdk: "devnet.seasons.players.add",
  input: Schema.Struct({ season: S, email: S }),
  output: Season,
  steps: [{ name: "add", local: "cache", about: "The supervisor's player add (POST /v1/seasons/<season>/players)." }],
  errors: [],
  calls: [control.seasonPlayerAdd],
  spans: [],
  budget: budget("write"),
});

export const flow_devnet_seasons_players_remove = defineFlow({
  id: "devnet.seasons.players.remove",
  title: "Stop a person playing a season",
  about:
    "`dev season player remove <season> <email>`. The supervisor refuses a season no one has made and an email that " +
    "does not play it (INVALID_INPUT); an ended or cancelled season (WRONG_STATE). While the season runs, the world's gateway refuses " +
    "the person's next call (ROLE_PERMISSION_DENIED); what they made in the world stays in it. Their world grant stays, " +
    "for the seasons they still play. It answers the season. " + OWNER_ONLY,
  component: component_core_sdk,
  sdk: "devnet.seasons.players.remove",
  input: Schema.Struct({ season: S, email: S }),
  output: Season,
  steps: [{ name: "remove", local: "cache", about: "The supervisor's player remove (POST /v1/seasons/<season>/players/<email>/remove)." }],
  errors: [],
  calls: [control.seasonPlayerRemove],
  spans: [],
  budget: budget("write"),
});

