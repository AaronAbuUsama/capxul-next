// Moved out of the built book by the cut, 10 November 2026, from books/target/devnet/decisions.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md. Seasons were dropped for now by Aaron's answer to devnet.seasons
// (aaron.seasons-dropped, cut.seasons); the code that follows is as it was when the book last held them.

export const decision_devnet_seasons = defineDecision({
  id: "devnet.seasons",
  title: "A shared world runs in seasons, each a record the supervisor runs on real time",
  question:
    "aaron.seasons: a shared world runs in seasons, like a game. A season starts from a known world, runs its clock at a " +
    "rate, jumps time on a schedule and ends in a reset, after which the next starts; players join a season. It " +
    "supersedes devnet.shared-world, where a shared world ran open-ended and only its owner moved its clock. What is a " +
    "season, who keeps it, what are its commands, and how does it sit beside the clock's own controls?",
  options: [
    {
      label: "supervisor-record",
      text:
        "A season is a record the world's supervisor keeps on the world's host, outside the world's snapshots, beside " +
        "the grants, so no restore changes it: a name, never reused; `from`, the saved world it starts from; `reset`, the " +
        "saved world its end restores (its own `from` unless another is named, typically the next season's); a rate; a " +
        "real end and an optional real start; a schedule of warps, each by a span or to a world date at a real instant " +
        "(devnet.season-jumps); and its players, emails that hold world grants (devnet.season-players). Its life is " +
        "planned, then running and ended, or cancelled before it runs (`dev season cancel`, or by its real end coming " +
        "before it starts), which touches nothing in the world. Its start (`dev season start`, or at its real start) restores `from` under a new world " +
        "epoch and runs the clock at its rate; its end (`dev season end`, or at its real end) keeps the world as " +
        "`<name>-end` and restores `reset`, frozen, until the next season starts (devnet.season-reset). One season runs " +
        "at a time and planned windows never overlap; the clock names the season it runs (`season`). Its commands, under " +
        "`dev season`: create, change, start, end, cancel, show (the current season), list (paged), warp add|remove and player " +
        "add|remove. The owner's clock controls stay for an unscheduled move (`dev time warp`, `dev time set`, the SDK's " +
        "freeze and resume); a restore or a start-at during a season is refused. A local devnet may run seasons too, " +
        "with no players: everyone on its machine is its owner.",
    },
    { label: "owner-script", text: "No season record: the owner scripts restores, rates and warps with the clock's own commands and a cron on their machine." },
    { label: "season-mode", text: "A third clock mode, `season`, beside frozen and running, with the schedule held in the clock." },
  ],
  chosen: "supervisor-record",
  why:
    "A season's schedule must run when no one is connected: the supervisor runs every component and already holds the " +
    "clock and the worlds, so it is the one place that can jump the world at a real time and reset it at the end; an " +
    "owner's cron dies with their laptop and cannot refuse a restore in the middle of a season. Kept outside the " +
    "snapshots, as the grants are, a season survives the restores that start and end it. Its schedule is on real time " +
    "because players plan their days around it: it relates world time to real time as the rate does, and no product " +
    "decision reads it (time.seasons). A mode would put the real-time schedule into every clock event. A season's jump " +
    "is a warp, the same barrier, so the grammar's verb (G3 has no `jump`) reads it as `dev time warp` scheduled; start, " +
    "end and cancel are the lifecycle's verbs, as in `verify start`, `org payroll agreement end` and `payment cancel`. " +
    "A planned season is cancelled, not ended, as the 215 withdraw an offered agreement rather than end it and cancel " +
    "a scheduled payment: G3 gives each verb one meaning, so `end` always keeps the season's world and resets, and a " +
    "script that meant to drop a planned season that has since started is refused instead of resetting the world. A " +
    "planned season whose real end comes before it starts is cancelled by the supervisor, since it never ran. The list " +
    "is paged as every list is (G5, G9), since a world that runs a season a week gathers dozens a year. Its flags keep G5: the " +
    "starting world is `--snapshot`, the CLI's word for a saved world, since `--from` names only a budget; and a " +
    "scheduled warp takes its span or `--to <date>` as `dev time warp` does, since `--by` is a review date. For Aaron: the season's " +
    "eleven commands (operations beyond the 215, rules.new-operations), that its start, end and jumps are real times, that " +
    "seasons never overlap, and that only the people its owner names play one (devnet.season-players). The " +
    "recommendation stands until he answers.",
  source: SEASONS("aaron.seasons; devnet.shared-world; devnet.supervisor-owns-time-and-worlds; new-commands.md G2, G3; command-surface.md section 9"),
  affects: [...SEASON_OPS, ...SEASON_FLOWS, environment_shared_world, component_devnet, integration_devnet_control, concept_devnet],
});

export const decision_devnet_season_players = defineDecision({
  id: "devnet.season-players",
  title: "A season's players are grantees its owner names, admitted only while it runs",
  question:
    "devnet.shared-world let anyone its owner granted use the world at any time. Now a shared world runs in seasons, and " +
    "players join a season. Who may play, how is a player admitted, and what may a joiner do between seasons or in a " +
    "season they do not play?",
  options: [
    {
      label: "season-admission",
      text:
        "The grants stay as devnet.shared-world made them: the owner grant (moves the clock, saves and restores worlds, " +
        "runs the seasons, arms faults, scripts gates and prices, plays people with `dev approve`); a joiner's grant made " +
        "for an email (`capxul-devnet world grant <email>`), a file handed over outside the world that names its holder's " +
        "mailboxes and carries their dev signers' keys, never the seed; and a follower grant (`world grant --follower " +
        "<name>`) for a real bench or the world's FDE namespace. All stay on the host outside the snapshots, and `world " +
        "revoke` ends one at the gateway. A player is a joiner whose email the owner adds to a season (`--player`, `dev " +
        "season player add`). The gateway admits a joiner's call to the backend, and to the two mail reads scoped to its " +
        "mailboxes, only while a season they play runs and the world is not moving (devnet.season-jumps): between seasons " +
        "it refuses WRONG_STATE, naming the next season and its start; in a season they do not play, " +
        "ROLE_PERMISSION_DENIED. The supervisor's reads (`dev time`, the clock's watch, `dev season show` and `list`) " +
        "answer every grant at any time. A joiner may not move, follow, save or restore the clock, nor run a season " +
        "command but show and list (ROLE_PERMISSION_DENIED). Removing a player closes the gateway to them at once; what " +
        "they made stays in the world. In the world a player signs only as themselves, and their authority is their " +
        "hats', as anywhere. Shared, as before: one chain, backend, clock and rate, mail sink, stand-in WhatsApp, the " +
        "heads and the FDE namespace, and nothing leaves the world. A local devnet has no grants and so no players.",
    },
    { label: "any-grantee", text: "Any grantee plays every season, as devnet.shared-world had it." },
  ],
  chosen: "season-admission",
  why:
    "A game's players are its season's: someone who played the last season need not be in the next, and a season with " +
    "a known cast is one its owner can reason about. Admitting by season at the gateway keeps each grant one file, made " +
    "once, and lets the owner change a season's cast without handing out files again. Between seasons the world is the " +
    "reset world waiting for the next start, which restores its starting world anyway, so a joiner's writes there would " +
    "be lost; refusing them, while every grant can still read the season and the clock, tells a player when to come " +
    "back. The owner and follower grants, the keys and what is shared are devnet.shared-world's, which seasons do not " +
    "change. Who may play is part of devnet.seasons' question.",
  source: SEASONS("aaron.seasons; devnet.shared-world; devnet.devnet-only-rpcs; devnet.approve-as"),
  affects: [
    environment_shared_world, ops.operation_dev_season_player_add, ops.operation_dev_season_player_remove,
    ops.operation_dev_season_show, ops.operation_dev_season_list, flow_devnet_seasons_players_add,
    flow_devnet_seasons_players_remove, rpc_devnet_mail_list, rpc_devnet_mail_list_notices, integration_devnet_control, component_devnet,
  ],
});

export const decision_devnet_season_jumps = defineDecision({
  id: "devnet.season-jumps",
  title: "A season's jumps are warps the supervisor runs at real times, each a barrier",
  question:
    "A season jumps time on a schedule. What is a jump, when does it run, what happens to one that fails " +
    "or falls due while something else moves, and what do the people acting in the world see while it runs?",
  options: [
    {
      label: "scheduled-warps",
      text:
        "A jump is a warp (devnet.warp-barrier) scheduled at a real instant, by a span or to a world date: given with the " +
        "season or by `dev season warp add` (`--every` repeats it each real interval until the season's end, at most " +
        "500), and taken out before it runs by `dev season warp remove`. At its instant, if the season runs, the " +
        "supervisor warps: a barrier through every due instant on the way, so a month's dated payments settle, its " +
        "notices are sent and its periods close on their own days; the clock keeps its mode and rate. One move at a " +
        "time: a jump due while another move runs (the owner's warp; a running stop is not a move) runs when it ends, its " +
        "`ranAt` saying when. A target not later than now is `skipped`. A stop that does not settle within its limit " +
        "fails the jump as it fails a warp (`failed`, naming the stop and the busy followers): the clock stays at the " +
        "last settled stop and the season runs on. The season's end cuts a running jump at its next settled stop " +
        "(`cut`) and skips the rest. While the world moves (a jump, the owner's warp, a season's start or end), the " +
        "gateway refuses a joiner's backend call WRONG_STATE naming the move, and the supervisor's reads answer. A " +
        "supervisor that was down when jumps fell due runs each once, late and in order, when it returns, unless the " +
        "season's end has come too: then they are skipped and the season ends. A jump ends sessions as any warp does " +
        "(devnet.sessions-across-warps): one of 30 days or more ends every person's, so a player signs in again by the " +
        "code the sink holds, and one of a day or more every agent's, which its SDK renews by signing again.",
    },
    { label: "jump-verb", text: "A new verb, `jump`, for a season's scheduled move, apart from `dev time warp`." },
    { label: "hold-calls", text: "Hold a joiner's call at the gateway until the jump ends, instead of refusing it." },
  ],
  chosen: "scheduled-warps",
  why:
    "A season's jump must leave the world that time passing would have left, which the warp barrier promises and a " +
    "jump that moved the clock and caught up after would not. Being a warp, it is spelt as one: the grammar has no " +
    "`jump` (G3), and two words for one move would differ only in who started it. People acting during a barrier keep " +
    "it from settling (a round settles only when nothing was mined and no follower was busy), so a busy shared world " +
    "would fail its own jumps; refusing their calls for the seconds a month takes, with a code that says why, keeps the " +
    "barrier sound and tells the player. Holding the calls would leave a client waiting minutes for a year's jump, past " +
    "its timeout. Running missed jumps on return keeps the world where its schedule says, unless its end has come, after " +
    "which they would move a world about to be reset.",
  source: SEASONS("aaron.seasons; devnet.warp-barrier; devnet.running-stops (people act while the clock stands); new-commands.md G3"),
  affects: [
    ops.operation_dev_season_warp_add, ops.operation_dev_season_warp_remove, flow_devnet_seasons_warps_add,
    flow_devnet_seasons_warps_remove, flow_devnet_time_warp, integration_devnet_control, component_devnet, environment_shared_world,
  ],
});

export const decision_devnet_season_reset = defineDecision({
  id: "devnet.season-reset",
  title: "A season ends by keeping its last world and restoring its reset world",
  question:
    "A season ends in a reset before the next: its starting world again, or a new one for the next " +
    "season. What does the end keep, what does the reset restore, and what does a player find afterwards: their " +
    "sessions, their mail, their money?",
  options: [
    {
      label: "keep-then-restore",
      text:
        "At the end (`dev season end`, or at its real end) the supervisor closes the gateway to the season's players, " +
        "cuts a running jump and skips the rest, freezes the clock, saves the world as `<name>-end` (its last state, each " +
        "stateful follower saving its own: devnet.stateful-followers), then restores the season's reset world, frozen at " +
        "its now under a new world epoch, each stateful follower restoring its own, and leaves it so until the next " +
        "season starts. A planned season is not ended but cancelled (`dev season cancel`), which touches nothing. A start " +
        "restores the season's `from` the same way, then " +
        "runs. While a season runs, a restore or a start-at is WRONG_STATE: end the season first. Everything in the world " +
        "becomes the reset world's, so a player finds: their sessions gone, the world holding only those it was saved " +
        "with, so the CLI home on their own machine holds a token the world does not know, and once a season they play " +
        "runs their first command is NOT_AUTHENTICATED and they sign in again by the code the sink holds for them (an " +
        "agent signs its challenge again, if the world holds it); their mail the reset world's sink, the season's mail " +
        "kept only in `<name>-end`, which only the owner restores; their money the reset world's (every balance, Safe, " +
        "payment, escrow, budget and deposit: the chain, Postgres, Ponder and the stand-ins' tables come back together, " +
        "and nothing real ever moved, on the world's own Anvil with Bridge's stand-in); and their Organizations, " +
        "contacts, CRM, HR and head documents the reset world's too. Their grant and their CLI home stay; a saved `use " +
        "org` naming an Organization the new world lacks is refused until they choose again.",
    },
    { label: "carry-over", text: "Carry each player's account and money from one season into the next." },
    { label: "no-final", text: "Reset without keeping the season's last state." },
  ],
  chosen: "keep-then-restore",
  why:
    "A reset is a game's: everyone starts the next season from the same known world, so what a season earned cannot " +
    "carry, and carrying a player's money would be a second, invented ledger beside the chain's. Keeping the last state " +
    "as a world costs one save and lets the owner look back later, while the reset still happens on time. Closing the " +
    "gateway first means no one acts into a world that is being saved. Sessions, mail and money all follow from one " +
    "rule, that the reset world comes back whole, so a player can predict them; signing in again is what " +
    "devnet.sessions-across-warps already has a world's people do after a long warp. A restore in the middle of a season " +
    "would replace its world under its players, so the season's end is the one way out.",
  source: SEASONS("aaron.seasons; devnet.sessions-across-warps; devnet.own-schema (the devnet tables are in every snapshot); access sessions"),
  affects: [
    ops.operation_dev_season_end, ops.operation_dev_season_cancel, ops.operation_dev_season_start, flow_devnet_seasons_end,
    flow_devnet_seasons_cancel, flow_devnet_seasons_start,
    flow_devnet_snapshots_save, flow_devnet_snapshots_restore, ops.operation_dev_snapshot_restore, ops.operation_dev_time_start_at,
    table_mail_messages, integration_devnet_control,
    environment_shared_world,
  ],
});

export const decision_devnet_season_protocol = defineDecision({
  id: "devnet.season-protocol",
  title: "The seasons are requests of the devnet protocol, and devnet-control's calls",
  question:
    "The seasons are the supervisor's, so the `dev season` commands reach it through capxul.devnet/1, as `dev time` and " +
    "`dev snapshot` do. Which requests carry them, and how are they booked while the `devnet-control` integration, in " +
    "a shared file, does not list them yet?",
  options: [
    {
      label: "protocol",
      text:
        "Eleven requests of capxul.devnet/1: GET /v1/seasons (seasonList, paged by `after` and `limit`) and " +
        "/v1/seasons/current (seasonCurrent), which answer every grant; POST /v1/seasons (seasonCreate), " +
        "/v1/seasons/<name>/change (seasonChange), /start and /end (seasonStart and seasonEnd, each taking `check` to " +
        "answer what it would do and change nothing), /cancel (seasonCancel), /warps and " +
        "/warps/<id>/remove (seasonWarpAdd, seasonWarpRemove), and /players and /players/<email>/remove (seasonPlayerAdd, " +
        "seasonPlayerRemove), which answer only the owner's grant. Their failures are INVALID_INPUT, WRONG_STATE and " +
        "ROLE_PERMISSION_DENIED as each season flow says, beside the protocol's own (WRONG_ENVIRONMENT, PROVIDER_ERROR). " +
        "The clock read and each clock event carry `season`; the events gain `save`, and `snapshot` names the world on " +
        "a `save` or `restore`. Start and end are barriers the size of a restore (p95 10 s); the rest are clock calls. " +
        "devnet-control lists them as its calls, each season flow names its call, and the supervisor's answers are the " +
        "calls' failures; a flow's own errors are only what the SDK refuses before any call.",
    },
    { label: "rpcs", text: "Backend rpcs over a devnet table of seasons." },
  ],
  chosen: "protocol",
  why:
    "A season lives outside the world's Postgres, which every restore replaces, and its schedule is the supervisor's to " +
    "run, so backend rpcs could neither keep it nor jump the world; the protocol is also how people building on Capxul " +
    "already drive the clock, so a program can run seasons as the CLI does. A check mode lets a preview say exactly what " +
    "will happen, its refusals included, before anyone answers yes. While shared/external.ts did not yet list the calls, " +
    "each season flow kept `calls` empty and listed the supervisor's answers in its own errors, so every refusal stayed " +
    "an eval; the surface pass's build added the eleven calls on 9 November 2026, and the flows now name them.",
  source: SEASONS("devnet.time-protocol; devnet.supervisor-steps; books/target/shared/external.ts (devnet-control); CONVENTIONS.md rule 9"),
  affects: [...SEASON_FLOWS, integration_devnet_control, component_devnet],
});

export const decision_devnet_season_worlds = defineDecision({
  id: "devnet.season-worlds",
  title: "Four worlds for seasons, built by their steps each time they are used",
  question:
    "The season commands' claims and refusals need a shared world with an owner, players and a season in each state. " +
    "Grants and seasons live on the host outside the snapshots, and a running season runs on real time. How are these " +
    "worlds built?",
  options: [
    {
      label: "built-each-time",
      text:
        "shared-world-owner (shared-world-joiner run as the owner, with Dana granted too), season-planned (s1 from " +
        "person-with-funded-safe at rate 4, ending two real hours on, w1 a 30-day warp an hour on, Dana its player), " +
        "season-running (s1 started; Dana signed in from her own CLI home and paid Sam 5 USDC) and season-ended (s1 " +
        "ended: s1-end saved, the world reset). Each is built by its steps on a fresh shared world on the eval machine " +
        "every time an eval uses it, since a restore brings back neither its grants nor its seasons, and a season's real " +
        "times are right only just after they are made. The shared world runs with the eval machine's seed, so each " +
        "person's dev signer is the one their catalogued Safe was set up with, and serves a copy of the eval machine's " +
        "store, made fresh with the world and thrown away with it, so person-with-funded-safe and every catalogued world " +
        "is saved in it and nothing a season saves there reaches another eval (an `s1-end` left in the store would refuse " +
        "the next `dev season create s1`, WRONG_STATE). A player's command runs from that player's " +
        "own CLI home, which the harness keeps outside the snapshots as their machine would be; the owner's from the eval " +
        "machine's. These are the catalog's only worlds whose clock runs, so their claims say 'about' where real seconds " +
        "count.",
    },
    { label: "frozen-only", text: "Build the season worlds frozen and have every season command run on a frozen clock in the evals." },
  ],
  chosen: "built-each-time",
  why:
    "devnet.deterministic-worlds' frozen epoch makes each time in a world a function of its steps; a season is the " +
    "clock running on a real schedule, so its worlds cannot be frozen without testing something else. Building them " +
    "each time keeps them true: a season planned in a saved world would have its real times in the past by the time an " +
    "eval restored it. Player homes outside the snapshots are what make a reset's NOT_AUTHENTICATED observable: a home " +
    "restored with the world would hold a session the reset world knows.",
  source: SEASONS("devnet.deterministic-worlds; devnet.shared-world (shared-world-joiner); books/target/devnet/worlds.ts"),
  affects: [concept_devnet, ...SEASON_OPS],
});

export const decision_devnet_season_claims = defineDecision({
  id: "devnet.season-claims",
  title: "Every season command proves more than one behaviour",
  question:
    "After the seasons design and its reviews, five season commands had one acceptance claim each: `dev season cancel`, " +
    "`show`, `warp remove`, `player add` and `player remove`. Every other new command of the surface pass has two or " +
    "more. Which behaviours the records already book do they also prove?",
  options: [
    {
      label: "booked-behaviours",
      text:
        "One more claim each, read off its flow and devnet.seasons, from a catalogued season world: a planned season " +
        "whose real end passes before it starts is cancelled by the supervisor, its note saying so; between seasons the " +
        "last ended season is current and a cancelled one never is; removing a planned season's only warp leaves `next` " +
        "null; adding a player who already plays changes nothing; and a player taken out of a planned season is not " +
        "admitted when it starts, while their grant still reads `dev season show`.",
    },
    { label: "leave", text: "Leave them at one claim; their refusals are evals already." },
  ],
  chosen: "booked-behaviours",
  why:
    "A command with one claim proves one path: each of these has a second that its flow already books and an eval " +
    "would otherwise miss, the supervisor's own cancel above all, which no command triggers. Each claim starts from a " +
    "season world built just before it is used (devnet.season-worlds), so its real times hold, and none adds a flag, " +
    "an answer or a refusal.",
  source:
    "Claude, surface pass build, 9 November 2026; evidence: books/target/devnet/flows.ts (the season flows' abouts); " +
    "devnet.seasons; devnet.season-players; devnet.season-worlds",
  affects: [
    ops.operation_dev_season_cancel, ops.operation_dev_season_show, ops.operation_dev_season_warp_remove,
    ops.operation_dev_season_player_add, ops.operation_dev_season_player_remove,
  ],
});
