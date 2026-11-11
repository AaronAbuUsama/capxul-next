// Moved out of the built book by the cut, 10 November 2026, from books/target/devnet/operations.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md. Seasons were dropped for now by Aaron's answer to devnet.seasons
// (aaron.seasons-dropped, cut.seasons); the code that follows is as it was when the book last held them.

// ── seasons: new, for aaron.seasons (decisions devnet.seasons, devnet.season-players, devnet.season-jumps,
// devnet.season-reset). A season's start, end and warps are real times; its world's are its clock's. ─────────

const OWNER_WHO =
  "Devnet only: the world's owner: on a local devnet anyone on the machine that runs it, with no sign-in; in a shared " +
  "world the holder of its owner grant.";
const ANYONE_WHO =
  "Devnet only: anyone in the world: on a local devnet anyone on the machine that runs it; in a shared world any grant, " +
  "between seasons too.";
const seasonJoiner = (what: string) => ({
  error: error_ROLE_PERMISSION_DENIED,
  given: W.sharedJoiner,
  when: `In a shared world you hold a joiner's grant: only the world's owner ${what} (devnet.season-players). Nothing changes.`,
});
const seasonOffWorld = {
  error: error_WRONG_ENVIRONMENT,
  given: W.offDevnet,
  when: "You are not on a local devnet or a shared world. Every other environment refuses it before any network call.",
};
const seasonPreview = (given: string) => [
  { error: error_CLI_USAGE, given, when: "A script ran it without `--confirm`, so it asked no one. Nothing changes." },
  { error: error_CANCELLED, given, when: "You answered no at its preview (exit 130). Nothing changes." },
];
const seasonEnded = (what: string) => ({
  error: error_WRONG_STATE,
  given: W.seasonEnded,
  when: `The season has ended (here s1): ${what}. The refusal names its state, and nothing changes.`,
});

export const operation_dev_season_create = defineOperation({
  id: "dev.season.create",
  title: "Plan a season of the world",
  about:
    "Plans a season, the way a shared world's time runs (aaron.seasons): the saved world it starts from, the rate its " +
    "clock runs at, the real time it ends and, if given, the real time it starts itself, the warps that move its world " +
    "on a schedule of real times, the people who play it, and the world its end resets to (its own starting world " +
    "unless another is named, typically the next season's). Like a game, it starts from a known world, runs at a rate, " +
    "jumps on a schedule and ends in a reset. Nothing in the world moves until it starts.",
  area: "devnet",
  command: "dev season create",
  priority: "normal",
  implementedBy: flow_devnet_seasons_create,
  who: OWNER_WHO,
  changes: "A planned season, which the world's supervisor keeps outside the world's snapshots. No world state changes.",
  acceptance: [
    {
      claim: "A season is planned with its starting world, rate, end, warps and players, and nothing in the world moves.",
      observes:
        "cli: from shared-world-owner, `dev season create s1 --snapshot person-with-funded-safe --rate 4 --end +2h --warp " +
        "+1h=30d --player dana@acme.test --json` prints s1 `planned` with `from` and `reset` person-with-funded-safe, " +
        "rate 4, `endAt` two real hours on, `startAt` null, one warp `w1` scheduled an hour on `by` 30d, and players " +
        "[dana@acme.test]. read: `dev season list` lists it; `dev time` shows the clock as before (frozen at the eval " +
        "epoch, rate 1, `season` null). world: no chain, Postgres or sink change.",
    },
    {
      claim: "Seasons follow one another: a season planned to start after another ends is kept beside it, and one whose window overlaps it is refused.",
      observes:
        "cli: from season-planned, `dev season create s2 --snapshot person-ready --start +3h --end +1d --json` prints s2 " +
        "`planned` with `startAt` three real hours on; `dev season create s3 --snapshot person-ready --start +1h --end +150m` " +
        "exits INVALID_INPUT naming s1, whose window ends two real hours on. read: `dev season list` lists s1, then s2, " +
        "and no s3.",
    },
  ],
  returns: flow_devnet_seasons_create.output,
  errors: [error_WRONG_ENVIRONMENT],
  refusals: [
    {
      error: error_INVALID_INPUT,
      given: W.empty,
      when:
        "A value is wrong, named in the refusal: the name is not lowercase letters, digits and hyphens up to 36 characters; " +
        "`--snapshot` or `--reset` names no world saved here (the refusal lists them); the rate is not 1 to 60; the end is " +
        "missing or not later than the start or now; a warp is unreadable or outside the window; the window overlaps " +
        "another season's; or a player holds no world grant here (a local devnet has none). Nothing is planned.",
    },
    {
      error: error_WRONG_STATE,
      given: W.seasonPlanned,
      when: "A season of this world already had that name (here s1), or a saved world is named `<name>-end`. Nothing is planned.",
    },
    seasonJoiner("plans a season"),
    seasonOffWorld,
  ],
  budget: budget("write"),
});

export const operation_dev_season_change = defineOperation({
  id: "dev.season.change",
  title: "Change a season's start, end, rate or reset",
  about:
    "Changes a season's own fields: a planned season's start, end, rate and reset, and a running season's end and reset " +
    "(a running season's clock takes its rate from `dev time set`). Its warps and players have their own commands. " +
    "Nothing in the world moves now: a new end moves when the season ends and resets, a new start when it starts, and " +
    "a new reset the world it resets to.",
  area: "devnet",
  command: "dev season change",
  priority: "normal",
  implementedBy: flow_devnet_seasons_change,
  who: OWNER_WHO,
  changes: "The season's start, end, rate or reset. No world state changes.",
  acceptance: [
    {
      claim: "A planned season's rate and start change, and it then starts by itself at that real time.",
      observes:
        "cli: from season-planned, `dev season change s1 --rate 2 --start +10s --json` prints s1 `planned`, rate 2, " +
        "`startAt` ten real seconds on. read: about thirty real seconds later `dev season show` shows s1 `running` with " +
        "`startedAt` at that instant, and `dev time` is running at rate 2 with `season` s1 under a new world epoch. " +
        "chain: the head's state is person-with-funded-safe's: Dana's Safe holds 1,000 USDC.",
    },
    {
      claim: "A running season's end and reset move and the world goes on as it was; its rate is the clock's to change.",
      observes:
        "cli: from season-running, `dev season change s1 --end +3h --reset person-ready --json` prints s1 `running` with " +
        "`endAt` three real hours on and `reset` person-ready; `dev season change s1 --rate 2` exits WRONG_STATE naming " +
        "`dev time set`. read: `dev time` is still running at rate 4 with `season` s1, its world epoch unchanged.",
    },
  ],
  returns: flow_devnet_seasons_change.output,
  errors: [error_WRONG_ENVIRONMENT],
  refusals: [
    {
      error: error_INVALID_INPUT,
      given: W.seasonPlanned,
      when:
        "It gives nothing to change, names a season this world has not had, or a value is wrong, named in the refusal: an " +
        "unreadable time, an end not later than now or the start, a window that overlaps another season's, a rate not 1 " +
        "to 60, or a `--reset` that names no saved world. Nothing changes.",
    },
    seasonEnded("an ended or cancelled season changes no more"),
    {
      error: error_WRONG_STATE,
      given: W.seasonRunning,
      when:
        "The season runs (here s1), so it takes no new start or rate: `dev time set` sets a running clock's rate, and the " +
        "refusal names it. Nothing changes.",
    },
    seasonJoiner("changes a season"),
    seasonOffWorld,
  ],
  budget: budget("write"),
});

export const operation_dev_season_start = defineOperation({
  id: "dev.season.start",
  title: "Start a season now",
  about:
    "Starts a planned season now, as its scheduled start would: the world becomes its starting world, at that world's " +
    "now under a new world epoch, and its clock runs at the season's rate until the season ends, jumping at each of its " +
    "scheduled warps. Its players may act in it from then on, and they are the only joiners who may. Whatever the world " +
    "held before is replaced, so it previews what it replaces and asks.",
  area: "devnet",
  command: "dev season start",
  priority: "normal",
  implementedBy: flow_devnet_seasons_start,
  who: OWNER_WHO,
  changes:
    "The whole world, replaced by the season's starting world (the chain, Postgres, Ponder's checkpoint, the devnet " +
    "tables and each stateful follower's own state), with the clock running at the season's rate under a new epoch; " +
    "the season running, its warps and end armed on the real clock, its players admitted by the world's gateway.",
  acceptance: [
    {
      claim: "Starting a season puts the world at its starting world and runs its clock at the season's rate.",
      observes:
        "cli: from season-planned, `dev season start s1 --confirm --json` prints s1 `running` with `startedAt` and its " +
        "`world`, and the clock running at rate 4 with `season` s1 under that new epoch. read: two `dev time` reads about " +
        "ten real seconds apart show now about 40 world seconds apart, both after person-with-funded-safe's now. chain: " +
        "the head's state is person-with-funded-safe's: Dana's Safe holds 1,000 USDC.",
    },
    {
      claim: "In a running season its players act, and a joiner who does not play it is refused.",
      observes:
        "cli: from season-running, with Dana's grant from her own CLI home, `balance --json` shows 995 USDC and `dev season " +
        "show --json` answers s1 with `playing` true; with Ana's grant (she has no session), `auth login ana@acme.test` " +
        "exits ROLE_PERMISSION_DENIED and `dev season show` answers s1 with `playing` false.",
    },
  ],
  returns: flow_devnet_seasons_start.output,
  errors: [error_CLI_USAGE, error_WRONG_ENVIRONMENT],
  refusals: [
    { error: error_INVALID_INPUT, given: W.seasonPlanned, when: "No season of this world has that name. Nothing changes." },
    {
      error: error_WRONG_STATE,
      given: W.seasonRunning,
      when:
        "The season is not planned (here s1 runs), another season runs, its end has passed, or its starting world was " +
        "saved with other backend code or without a stateful follower joined now. The refusal says which, and nothing changes.",
    },
    seasonJoiner("starts a season"),
    seasonOffWorld,
    ...seasonPreview(W.seasonPlanned),
  ],
  budget: budget("background"),
});

export const operation_dev_season_end = defineOperation({
  id: "dev.season.end",
  title: "End a season now and reset the world",
  about:
    "Ends a running season now, as its scheduled end would. Its world is kept as its last state, the saved world " +
    "`<name>-end`, and the world is reset to the season's reset world, frozen at that world's now, until the next season " +
    "starts. Its players are refused until a season they play runs; then they sign in again, and their money, mail and " +
    "everything they made are what that season's world holds. Only a running season ends: a planned one is taken " +
    "back with `dev season cancel`, so `end` always resets the world. It previews what it ends and asks.",
  area: "devnet",
  command: "dev season end",
  priority: "normal",
  implementedBy: flow_devnet_seasons_end,
  who: OWNER_WHO,
  changes:
    "The world saved as `<name>-end`, then replaced by the reset world (the chain, Postgres, " +
    "Ponder's checkpoint, the devnet tables and each stateful follower's own state), frozen under a new epoch; the season " +
    "ended, its remaining warps skipped, its players no longer admitted.",
  acceptance: [
    {
      claim: "Ending a running season keeps its last state as a world, then resets the world to its reset world.",
      observes:
        "cli: from season-running, `dev season end s1 --confirm --json` prints s1 `ended` with `endedAt`, w1 `skipped`, " +
        "`final` s1-end (its `season` s1, its now later than person-with-funded-safe's), and the clock frozen with `season` " +
        "null under a new epoch. read: `dev snapshot list` lists s1-end. chain: the head's state is person-with-funded-safe's " +
        "again: Dana's Safe holds 1,000 USDC.",
    },
    {
      claim: "While a season runs, only its end replaces its world: a restore is refused.",
      observes:
        "cli: from season-running, `dev snapshot restore person-ready` exits WRONG_STATE naming s1 and `dev season end`. " +
        "read: `dev time` is still running at rate 4 with `season` s1, its world epoch unchanged. chain: Dana's Safe " +
        "still holds 995 USDC.",
    },
    {
      claim: "Between seasons a player is refused, and can still see the season and the clock.",
      observes:
        "cli: from season-ended, with Dana's grant from her own CLI home, `balance` exits WRONG_STATE saying no season she " +
        "plays is running; `dev season show --json` answers s1 `ended` with `playing` true; `dev time` answers the clock " +
        "frozen at person-with-funded-safe's now.",
    },
    {
      claim: "When the next season starts a player signs in again and finds its world's money and mail, not the last season's.",
      observes:
        "cli: from season-ended, after the owner's `dev season create s2 --snapshot person-with-funded-safe --end +1h --player " +
        "dana@acme.test` and `dev season start s2 --confirm`, with Dana's grant from her own CLI home `balance` exits " +
        "NOT_AUTHENTICATED (her s1 session is unknown); after `auth login` and `auth verify` with the code `dev mail list " +
        "--to dana@acme.test` shows, `balance` shows 1,000 USDC and `payment list` holds no payment to Sam. read: `dev " +
        "mail list --to dana@acme.test` holds one sign-in code sent at or after s2's start, the one she used, and none of " +
        "s1's mail.",
    },
  ],
  returns: flow_devnet_seasons_end.output,
  errors: [error_CLI_USAGE, error_WRONG_ENVIRONMENT],
  refusals: [
    { error: error_INVALID_INPUT, given: W.seasonRunning, when: "No season of this world has that name. Nothing changes." },
    {
      error: error_WRONG_STATE,
      given: W.seasonPlanned,
      when:
        "The season has not started (here s1 is planned): a planned season is taken back with `dev season cancel`, and " +
        "the refusal names it. Nothing changes.",
    },
    seasonEnded("it cannot end again"),
    seasonJoiner("ends a season"),
    seasonOffWorld,
    ...seasonPreview(W.seasonRunning),
  ],
  budget: budget("background"),
});

export const operation_dev_season_cancel = defineOperation({
  id: "dev.season.cancel",
  title: "Cancel a planned season",
  about:
    "Takes back a planned season before it starts, as `payment cancel` takes back a scheduled payment: its start and its " +
    "warps never run, its name is not used again, and nothing in the world changes. A running season is ended with " +
    "`dev season end` instead, which resets the world, so a script that meant to drop a season that has since started " +
    "is refused rather than resetting it.",
  area: "devnet",
  command: "dev season cancel",
  priority: "normal",
  implementedBy: flow_devnet_seasons_cancel,
  who: OWNER_WHO,
  changes: "The season, cancelled, with its warps skipped. No world state changes.",
  acceptance: [
    {
      claim: "Cancelling a planned season leaves the world as it was, and the season never runs.",
      observes:
        "cli: from season-planned, `dev season cancel s1 --json` prints s1 `cancelled` with `endedAt` set, `startedAt` " +
        "and `final` null and w1 `skipped`; `dev season create s1 --snapshot person-ready --end +1h` then exits " +
        "WRONG_STATE (a season had that name). read: `dev season show` prints `season` null; `dev time` shows the clock as " +
        "before (frozen at the eval epoch, rate 1, `season` null) and `dev snapshot list` has no s1-end. world: no chain, " +
        "Postgres or sink change.",
    },
    {
      claim: "A planned season whose real end passes before it starts is cancelled the same way, by the supervisor.",
      observes:
        "cli: from shared-world-owner, `dev season create s2 --snapshot person-ready --end +10s --json` prints s2 `planned` " +
        "with `startAt` null; about twenty real seconds later `dev season list --json` prints s2 `cancelled`, its `note` " +
        "naming the end that came first, with `startedAt` and `final` null. read: `dev time` shows the clock as before. " +
        "world: no chain, Postgres or sink change.",
    },
  ],
  returns: flow_devnet_seasons_cancel.output,
  errors: [error_WRONG_ENVIRONMENT],
  refusals: [
    { error: error_INVALID_INPUT, given: W.seasonPlanned, when: "No season of this world has that name (here s9). Nothing changes." },
    {
      error: error_WRONG_STATE,
      given: W.seasonRunning,
      when:
        "The season is not planned (here s1 runs): `dev season end` ends a running season and resets the world, and the " +
        "refusal names it; an ended or cancelled season is refused the same way. Nothing changes.",
    },
    seasonJoiner("cancels a season"),
    seasonOffWorld,
  ],
  budget: budget("write"),
});

export const operation_dev_season_show = defineOperation({
  id: "dev.season.show",
  title: "Show the world's current season",
  about:
    "Shows the world's current season (the one running, else the next planned, else the last ended), whether you play " +
    "it, its next scheduled warp and the clock. Anyone in the world may read it, between seasons too: it is how a player " +
    "learns when the next season starts and when the world next jumps.",
  area: "devnet",
  command: "dev season show",
  priority: "normal",
  implementedBy: flow_devnet_seasons_show,
  who: ANYONE_WHO,
  changes: "Nothing.",
  acceptance: [
    {
      claim: "Anyone in the world sees the current season, its next warp and whether they play it.",
      observes:
        "cli: from season-planned, `dev season show --json` with Ana's grant prints s1 `planned` with `playing` false, " +
        "`next` w1 (an hour on, 30d) and the clock frozen at the eval epoch; with Dana's grant the same with `playing` " +
        "true. From shared-world-owner it prints `season` null and `next` null.",
    },
    {
      claim: "Between seasons the last ended season is current, with its last world; a cancelled one never is.",
      observes:
        "cli: from season-ended, `dev season show --json` with Dana's grant prints s1 `ended` with `final` s1-end, " +
        "`playing` true and `next` null; after the owner's `dev season create s2 --snapshot person-ready --start +1h --end " +
        "+2h` and `dev season cancel s2`, it prints s1 again. world: the reads change nothing.",
    },
  ],
  returns: flow_devnet_seasons_show.output,
  errors: [error_WRONG_ENVIRONMENT],
  refusals: [seasonOffWorld],
  budget: budget("read"),
});

export const operation_dev_season_list = defineOperation({
  id: "dev.season.list",
  title: "List the world's seasons",
  about:
    "Lists every season the world has had, a page at a time: the running one, the planned ones in the order they " +
    "start, then the ended and cancelled ones, newest first, each with its starting and reset worlds, rate, window, " +
    "players, warps (each with what it did) and the world its end kept. Anyone in the world may read it.",
  area: "devnet",
  command: "dev season list",
  priority: "normal",
  implementedBy: flow_devnet_seasons_list,
  who: ANYONE_WHO,
  changes: "Nothing.",
  acceptance: [
    {
      claim: "Every season is listed in its order, the planned by when they start and the ended with the world each kept.",
      observes:
        "cli: from season-ended, after the owner plans s3 (`--start +3h --end +1d`) and then s2 (`--start +1h --end +2h`), " +
        "both from person-with-funded-safe, `dev season list --json` with Ana's grant lists s2, s3, then s1 `ended` with " +
        "`final` s1-end, players [dana@acme.test] and w1 `skipped`.",
    },
    {
      claim: "The list is paged: each page gives the cursor of the next, and the last none.",
      observes:
        "cli: from season-ended, after the owner's `dev season create s2 --snapshot person-with-funded-safe --start +1h " +
        "--end +2h`, `dev season list --limit 1 --json` lists s2 with a `nextCursor`; `dev season list --after <it> " +
        "--json` lists s1 with `nextCursor` null; `dev season list --limit 0` exits INVALID_INPUT naming the range 1 to 100.",
    },
  ],
  returns: flow_devnet_seasons_list.output,
  errors: [error_WRONG_ENVIRONMENT],
  refusals: [
    {
      error: error_INVALID_INPUT,
      given: W.seasonEnded,
      when: "`--limit` is not a whole number from 1 to 100, or `--after` is a cursor this list did not give. Nothing is read.",
    },
    seasonOffWorld,
  ],
  budget: budget("read"),
});

export const operation_dev_season_warp_add = defineOperation({
  id: "dev.season.warp.add",
  title: "Schedule a warp in a season",
  about:
    "Schedules a warp of the world's clock at a real time, by a span (`30d`) or to a world date, once or, with " +
    "`--every`, once each real interval until the season ends. At its time the world's supervisor runs it as `dev time " +
    "warp` does: a barrier that stops at every due instant on the way, so a month's dated payments, notices and closes " +
    "happen on their own days. While it runs, players' calls are refused and the clock and season reads answer. A warp " +
    "in a planned season runs only once the season runs.",
  area: "devnet",
  command: "dev season warp add",
  priority: "normal",
  implementedBy: flow_devnet_seasons_warps_add,
  who: OWNER_WHO,
  changes: "The season's schedule. No world state changes until a warp runs.",
  acceptance: [
    {
      claim: "A scheduled warp runs at its real time and moves the world as far as it says, as a barrier.",
      observes:
        "cli: from season-running, `dev season warp add s1 30d --at +5s --json` prints s1 with w2 `scheduled` five real " +
        "seconds on. read: about thirty real seconds later `dev season show` lists w2 `done` with `ranAt` about five " +
        "seconds after the add and `reached` 30 world days after its `from`; `dev time` is running at rate 4 with `season` s1, " +
        "its now past `reached`. chain: a block is dated `reached`.",
    },
    {
      claim: "While a warp runs a player's calls are refused, and the clock and season reads answer.",
      observes:
        "cli: from season-running, an outside follower on the owner's grant (the SDK's `devnet.time.follow`) acknowledges " +
        "busy at the first stop of a warp added by `dev season warp add s1 1d --at +5s`; meanwhile, with Dana's grant, `balance` exits " +
        "WRONG_STATE naming the warp, while `dev time` and `dev season show` answer with w2 `running`. Once the follower " +
        "acknowledges idle, w2 ends `done` and Dana's `balance` shows 995 USDC.",
    },
    {
      claim: "`--every` schedules one warp each real interval until the season ends.",
      observes:
        "cli: from season-planned, `dev season warp add s1 7d --at +1h --every 10m --json` prints s1 with w2 to w7 " +
        "`scheduled` ten real minutes apart from an hour on, the last before s1's end two real hours on.",
    },
  ],
  returns: flow_devnet_seasons_warps_add.output,
  errors: [error_WRONG_ENVIRONMENT],
  refusals: [
    {
      error: error_INVALID_INPUT,
      given: W.seasonPlanned,
      when:
        "A value is wrong, named in the refusal: both or neither of a span and `--to`; an unreadable time or span; an " +
        "`--at` not later than now or outside the season's window; an `--every` under a real minute or making more than " +
        "500 warps; or a season this world has not had. Nothing changes.",
    },
    seasonEnded("its schedule takes no more warps"),
    seasonJoiner("schedules a warp"),
    seasonOffWorld,
  ],
  budget: budget("write"),
});

export const operation_dev_season_warp_remove = defineOperation({
  id: "dev.season.warp.remove",
  title: "Take a scheduled warp out of a season",
  about:
    "Takes a warp that has not run out of a season's schedule. It stays listed as removed and never runs. To move the " +
    "world now, the owner warps it with `dev time warp`.",
  area: "devnet",
  command: "dev season warp remove",
  priority: "normal",
  implementedBy: flow_devnet_seasons_warps_remove,
  who: OWNER_WHO,
  changes: "The warp, removed from the season's schedule. No world state changes.",
  acceptance: [
    {
      claim: "A removed warp never runs, and stays in the schedule as removed.",
      observes:
        "cli: from season-running, after `dev season warp add s1 30d --at +10s` adds w2, `dev season warp remove s1 " +
        "w2 --json` prints s1 with w2 `removed`. read: twenty real seconds later `dev season show` lists w2 `removed` with " +
        "`ranAt` null, and two `dev time` reads taken across that wait differ by about 80 world seconds, not 30 days.",
    },
    {
      claim: "Removing a planned season's only warp leaves it no next warp, and the season planned.",
      observes:
        "cli: from season-planned, `dev season warp remove s1 w1 --json` prints s1 `planned` with w1 `removed`; `dev " +
        "season show --json` prints `next` null. read: `dev time` shows the clock as before. world: no chain, Postgres " +
        "or sink change.",
    },
  ],
  returns: flow_devnet_seasons_warps_remove.output,
  errors: [error_WRONG_ENVIRONMENT],
  refusals: [
    { error: error_INVALID_INPUT, given: W.seasonPlanned, when: "The season or the warp does not exist (here no w9 in s1). Nothing changes." },
    seasonEnded("its schedule is closed; a warp that has run, failed or been skipped is refused the same way"),
    seasonJoiner("removes a warp"),
    seasonOffWorld,
  ],
  budget: budget("write"),
});

export const operation_dev_season_player_add = defineOperation({
  id: "dev.season.player.add",
  title: "Let a person play a season",
  about:
    "Adds a person who holds a world grant to a season's players. While the season runs, the world's gateway admits " +
    "them at once; they act as themselves, with their own dev signer, as anyone does in the world. A local devnet has " +
    "no grants, so no players: everyone on the machine is its owner.",
  area: "devnet",
  command: "dev season player add",
  priority: "normal",
  implementedBy: flow_devnet_seasons_players_add,
  who: OWNER_WHO,
  changes: "The season's players. No world state changes.",
  acceptance: [
    {
      claim: "A person added to a running season may act in it at once.",
      observes:
        "cli: from season-running, with Ana's grant `auth login ana@acme.test` exits ROLE_PERMISSION_DENIED; after the " +
        "owner's `dev season player add s1 ana@acme.test --json` (s1's players Dana and Ana), with Ana's grant `auth login " +
        "ana@acme.test` sends her a code that `dev mail list --to ana@acme.test` shows her, and `dev season show` answers `playing` true.",
    },
    {
      claim: "Adding a person who already plays changes nothing.",
      observes:
        "cli: from season-planned, `dev season player add s1 dana@acme.test --json` prints s1 with Dana among its " +
        "players once, and `dev season list --json` the same. world: no chain, Postgres or sink change.",
    },
  ],
  returns: flow_devnet_seasons_players_add.output,
  errors: [error_WRONG_ENVIRONMENT],
  refusals: [
    {
      error: error_INVALID_INPUT,
      given: W.seasonPlanned,
      when:
        "The email holds no world grant here (here nobody@outside.test; `capxul-devnet world grant` makes one, and a local " +
        "devnet has none), or the season does not exist. Nothing changes.",
    },
    seasonEnded("its players are fixed"),
    seasonJoiner("adds a player"),
    seasonOffWorld,
  ],
  budget: budget("write"),
});

export const operation_dev_season_player_remove = defineOperation({
  id: "dev.season.player.remove",
  title: "Stop a person playing a season",
  about:
    "Takes a person out of a season's players. While the season runs, the world's gateway refuses their next call; " +
    "what they made in the world stays in it, and their world grant stays for the seasons they still play.",
  area: "devnet",
  command: "dev season player remove",
  priority: "normal",
  implementedBy: flow_devnet_seasons_players_remove,
  who: OWNER_WHO,
  changes: "The season's players. No world state changes.",
  acceptance: [
    {
      claim: "A removed player is refused at once, and what they made stays in the world.",
      observes:
        "cli: from season-running, after the owner's `dev season player remove s1 dana@acme.test --json` (s1's players " +
        "none), with Dana's grant `balance` exits ROLE_PERMISSION_DENIED and `dev season show` answers `playing` false. " +
        "chain: Dana's Safe still holds 995 USDC.",
    },
    {
      claim: "A person taken out of a planned season is not admitted when it starts, and keeps their grant.",
      observes:
        "cli: from season-planned, after the owner's `dev season player remove s1 dana@acme.test` and `dev season start " +
        "s1 --confirm`, with Dana's grant `auth login dana@acme.test` exits ROLE_PERMISSION_DENIED, while `dev season " +
        "show --json` with the same grant still answers, s1 `running` and `playing` false.",
    },
  ],
  returns: flow_devnet_seasons_players_remove.output,
  errors: [error_WRONG_ENVIRONMENT],
  refusals: [
    { error: error_INVALID_INPUT, given: W.seasonRunning, when: "The email does not play the season (here ana@acme.test), or the season does not exist. Nothing changes." },
    seasonEnded("its players are fixed"),
    seasonJoiner("removes a player"),
    seasonOffWorld,
  ],
  budget: budget("write"),
});

/** The eleven `dev season` commands, booked for aaron.seasons (decision devnet.seasons). */
export const SEASON_OPERATIONS = [
  operation_dev_season_create, operation_dev_season_change, operation_dev_season_start, operation_dev_season_end,
  operation_dev_season_cancel, operation_dev_season_show, operation_dev_season_list, operation_dev_season_warp_add, operation_dev_season_warp_remove,
  operation_dev_season_player_add, operation_dev_season_player_remove,
] as const;

