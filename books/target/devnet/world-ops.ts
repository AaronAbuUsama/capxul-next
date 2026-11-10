// The world's operations: `world create|list|show|register`, the world's clock (`world clock set|freeze|resume|warp`), the world's snapshots
// (`world snapshot save|list|restore [--as <new world>]`) and the world's record (`record list|show|export`). Fourteen new operations booked under
// rules.new-operations; the decisions in ./world-decisions.ts name aaron.world-clock and aaron.one-door. They address the same supervisor as the frozen
// `dev time` and `dev snapshot` commands, by world name (devnet.world-first-class); a world name is lower-case letters and digits, no hyphen.

import { budget } from "../../../packages/book/src/index.ts";
import { error_CAPACITY_REACHED, error_CLI_USAGE, error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE } from "../shared/vocabulary.ts";
import { operation } from "../plugs/kit.ts";
import * as r from "./world-rpcs.ts";
import * as ex from "./world-examples.ts";

const W = { empty: "empty-devnet", town: "town-of-four-m3", frozen: "world-frozen", running: "world-running-fast", saved: "world-with-snapshot", hosted: "world-registered", member: "org-with-member", signedOut: "signed-out" } as const;
const out = { error: error_NOT_AUTHENTICATED, given: W.signedOut, when: "No one is signed in on this machine (a hosted world needs a grant)." } as const;
const notOwner = (what: string) => ({ error: error_ROLE_PERMISSION_DENIED, given: W.member, when: `A player or viewer, not an owner, tries to ${what}; nothing changes.` }) as const;
const noWorld = { error: error_INVALID_INPUT, given: W.empty, when: "No world has that name." } as const;
const OWN = "The world's owner: on a local devnet anyone on the machine; on a hosted world the holder of an organiser grant.";
const READ = "Anyone with a grant in the world; on a local devnet anyone on the machine.";

export const operation_world_create = operation({
  id: "world.create", title: "Make a whole world", area: "devnet", command: "world create", priority: "critical", implementedBy: r.rpc_devnet_worlds_create, examples: ex.examples_world_create,
  about: "Makes a world: a chain with the contracts, a service, a clock and a record, from a template or empty. `--profile core|full` (default `core`), `--kind local|simulated|staging|production` (default `simulated` on the hosted service, `local` on a laptop), `--clock frozen|running` and `--rate <1 to 60>`. A hosted world answers at `core-<world>.<base>` and its companies at `<company>-<world>.<base>`. Companies are made after with `org create --world`. As easy as making a company.",
  who: OWN, changes: "One world, creating; its creation process makes the chain, service, clock, record and stand-ins and the world becomes running.",
  acceptance: [
    { claim: "A new world runs with its clock and a record that begins with its birth.", observes: `cli: from \`${W.empty}\`, \`world create town1 --template empty --clock frozen --json\` prints creating; \`world show town1\` then prints running, clockMode frozen, epoch 1 and recordHead 1; \`record list --world town1\` lists one \`born\` entry.` },
    { claim: "A `full` world gives each company a site on its own address and a `core` world gives none.", observes: `cli: from \`${W.empty}\`, \`world create core1 --profile core\` then \`world show core1\` lists no company site; \`world create full1 --profile full --template town-of-four@m3\` then \`world show full1\` lists four sites at \`<company>-full1.<base>\`, each answering.` },
    { claim: "Production is never made without the platform owner's approval.", observes: `cli: \`world create live --kind production --profile full --json\` exits ROLE_PERMISSION_DENIED and makes nothing; with the owner's one-time approval it is accepted.` },
    { claim: "A world made from a template starts with the template's companies on their own addresses.", observes: `cli: \`world create town2 --template town-of-four@m3 --clock frozen\`; \`world show town2\` lists the four companies at \`<company>-town2.<base>\`, each answering; the born entry names no parent.` },
  ],
  returns: r.rpc_devnet_worlds_create.output, errors: [error_CLI_USAGE],
  refusals: [out, { error: error_INVALID_INPUT, given: W.empty, when: "The id has a hyphen or a capital, is longer than 12 characters, or is taken; or the template is not saved here." }, { error: error_CAPACITY_REACHED, given: W.empty, when: "The worlds machine has no room for another world of this profile." }, { error: error_ROLE_PERMISSION_DENIED, given: W.member, when: "Production was asked for without the platform owner's approval; nothing is made." }], budget: budget("background"),
});
export const operation_world_list = operation({
  id: "world.list", title: "List the worlds", area: "devnet", command: "world list", priority: "normal", implementedBy: r.rpc_devnet_worlds_list, examples: ex.examples_world_list,
  about: "The worlds on this machine and, with `--hosted`, the hosted service's: name, kind, clock, rate, companies, epoch.", who: READ, changes: "Nothing: it only reads.",
  acceptance: [{ claim: "Every world is listed with its clock and epoch.", observes: `cli: with two worlds made, \`world list --json\` lists both with their clock mode, rate and epoch.` }],
  returns: r.rpc_devnet_worlds_list.output, errors: [error_CLI_USAGE], refusals: [out], budget: budget("read"),
});
export const operation_world_show = operation({
  id: "world.show", title: "Show one world", area: "devnet", command: "world show", priority: "critical", implementedBy: r.rpc_devnet_worlds_show, examples: ex.examples_world_show,
  about: "A world's companies and their addresses, clock and rate, parent world and snapshot, and the head of its record.", who: READ, changes: "Nothing: it only reads.",
  acceptance: [{ claim: "A world restored into another names its parent.", observes: `cli: in \`${W.saved}\`, after \`world snapshot restore town1 m3 --as town3\`, \`world show town3 --json\` prints parentWorld town1, parentSnapshot m3 and parentSeq.` }],
  returns: r.rpc_devnet_worlds_show.output, errors: [error_CLI_USAGE], refusals: [out, noWorld], budget: budget("read"),
});
export const operation_world_register = operation({
  id: "world.register", title: "Register a local devnet's world with the hosted site service", area: "devnet", command: "world register", priority: "normal", implementedBy: r.rpc_devnet_worlds_register, examples: ex.examples_world_register,
  about: "Because every call goes from the service to a site, a local devnet registers: the hosted service issues a world id, a secret (shown once) and a name, and the world's companies' sites are made on the hosted bench and parked when idle. A core-only world is the offline fallback.",
  who: OWN, changes: "A registration row; the world is marked hosted.",
  acceptance: [{ claim: "A local world is registered once and its secret is shown once.", observes: `cli: \`world register town1 --name mine --json\` prints a world id and a secret; a second run prints WRONG_STATE; the secret is never in the record.` }],
  returns: r.rpc_devnet_worlds_register.output, errors: [error_CLI_USAGE], refusals: [out, notOwner("register the world"), { error: error_INVALID_INPUT, given: W.hosted, when: "The name is taken or has a hyphen." }],
});

const clockOp = (id: string, command: string, title: string, about: string, impl: unknown, out_: unknown, claim: { claim: string; observes: string }, extra: object[] = []) =>
  operation({
    id, title, area: "devnet", command, priority: "critical", implementedBy: impl as never, examples: ex[`examples_${id.replaceAll(".", "_")}` as keyof typeof ex], about, who: OWN, changes: "The world's clock; every follower, the company sites included, follows it.",
    acceptance: [claim], returns: out_ as never, errors: [error_CLI_USAGE], refusals: [out, noWorld, notOwner("move the clock"), ...extra] as never, budget: budget("write"),
  } as never);
export const operation_world_clock_set = clockOp("world.clock.set", "world clock set", "Run the world's clock at a rate", "Sets a running clock's rate, 1 to 60 world seconds per real second. The chain, the service and every company's site follow.", r.rpc_devnet_worlds_clock_set, r.rpc_devnet_worlds_clock_set.output,
  { claim: "A running world moves at its rate, and a rate outside 1 to 60 is refused.", observes: `cli: in \`${W.running}\`, \`world clock set town1 --rate 4\` then after 15 real minutes \`world show\` prints worldNow one world hour on; \`--rate 61\` exits INVALID_INPUT.` }, [{ error: error_INVALID_INPUT, given: W.running, when: "The rate is not between 1 and 60." }]);
export const operation_world_clock_freeze = clockOp("world.clock.freeze", "world clock freeze", "Freeze the world's clock", "Stops the clock at the world's now; the world then moves only by warp or step.", r.rpc_devnet_worlds_clock_freeze, r.rpc_devnet_worlds_clock_freeze.output,
  { claim: "A frozen world does not move until it is warped or resumed.", observes: `cli: \`world clock freeze town1\`; after a real minute \`world show\` prints the same worldNow; its sites' dates have not moved.` });
export const operation_world_clock_resume = clockOp("world.clock.resume", "world clock resume", "Resume the world's clock", "Starts a frozen clock again at the rate it had.", r.rpc_devnet_worlds_clock_resume, r.rpc_devnet_worlds_clock_resume.output,
  { claim: "A resumed world moves from where it stopped.", observes: `cli: in \`${W.frozen}\`, \`world clock resume town1\` then \`world show\` prints worldNow advancing at the rate.` });
export const operation_world_clock_warp = clockOp("world.clock.warp", "world clock warp", "Move the world's clock forward", "Moves the clock forward by a duration or to a date, stopping at every due instant, running due jobs and moving every follower, the sites included. Not backwards.", r.rpc_devnet_worlds_clock_warp, r.rpc_devnet_worlds_clock_warp.output,
  { claim: "A warp moves the chain and every site together and runs what fell due.", observes: `cli: in \`${W.frozen}\`, \`world clock warp town1 --by 7d\` prints worldNow a week on; a company's site shows its scheduled job ran for each day; \`--by -1d\` exits INVALID_INPUT.` }, [{ error: error_INVALID_INPUT, given: W.frozen, when: "A time before now." }]);

export const operation_world_snapshot_save = operation({
  id: "world.snapshot.save", title: "Save a snapshot of a whole world", area: "devnet", command: "world snapshot save", priority: "critical", implementedBy: r.rpc_devnet_worlds_snapshot_save, examples: ex.examples_world_snapshot_save,
  about: "Saves the world's chain, service state, every company's site, the clock and the place in the record under a name. `--template` marks it as one new worlds can be made from.", who: OWN, changes: "One snapshot; the world is unchanged.",
  acceptance: [{ claim: "A snapshot saves everything that makes the world and leaves it untouched.", observes: `cli: \`world snapshot save town1 m3 --json\` prints the epoch and recordSeq; the world's record gains no entry but the save; \`world snapshot list town1\` lists it.` }],
  returns: r.rpc_devnet_worlds_snapshot_save.output, errors: [error_CLI_USAGE], refusals: [out, noWorld, notOwner("save a snapshot"), { error: error_WRONG_STATE, given: W.saved, when: "A snapshot of that name exists and `--replace` was not asked." }], budget: budget("background"),
});
export const operation_world_snapshot_list = operation({
  id: "world.snapshot.list", title: "List a world's snapshots", area: "devnet", command: "world snapshot list", priority: "normal", implementedBy: r.rpc_devnet_worlds_snapshot_list, examples: ex.examples_world_snapshot_list,
  about: "A world's snapshots, newest first, with epoch, sequence, clock and whether each is a template.", who: READ, changes: "Nothing: it only reads.",
  acceptance: [{ claim: "Snapshots are listed newest first with where in the record each was taken.", observes: `cli: in \`${W.saved}\`, \`world snapshot list town1 --json\` lists them newest first.` }],
  returns: r.rpc_devnet_worlds_snapshot_list.output, errors: [error_CLI_USAGE], refusals: [out, noWorld], budget: budget("read"),
});
export const operation_world_snapshot_restore = operation({
  id: "world.snapshot.restore", title: "Restore a snapshot, in place or into a separate world", area: "devnet", command: "world snapshot restore", priority: "critical", implementedBy: r.rpc_devnet_worlds_snapshot_restore, examples: ex.examples_world_snapshot_restore,
  about: "In place (a new epoch, the abandoned branch kept in the record) or, with `--as <new world>`, into a separate world with the same chain id on a new chain instance, every address renamed, and a `born` entry naming the parent world, snapshot and sequence.", who: OWN, changes: "In place: the world returns to the snapshot with a higher epoch. With `--as`: a new world; the old one is untouched.",
  acceptance: [
    { claim: "An in-place restore returns the world to the snapshot and records it.", observes: `cli: in \`${W.saved}\`, after more commands, \`world snapshot restore town1 m3\`; the diff against the saved world is empty, epoch is one higher, the record has a \`restore\` entry and the earlier branch is listed as abandoned.` },
    { claim: "A restore into a separate world leaves the first world untouched and the two never see each other.", observes: `cli: \`world snapshot restore town1 m3 --as town3\`; both worlds list their companies on their own addresses; a command in town3 changes nothing in town1; the new born entry names town1, m3 and the sequence.` },
  ],
  returns: r.rpc_devnet_worlds_snapshot_restore.output, errors: [error_CLI_USAGE],
  refusals: [out, noWorld, notOwner("restore a snapshot"), { error: error_INVALID_INPUT, given: W.saved, when: "No snapshot of that name, or the new world's id is taken." }, { error: error_WRONG_STATE, given: W.saved, when: "The snapshot was saved with other backend code." }], budget: budget("background"),
});

export const operation_record_list = operation({
  id: "record.list", title: "List the world's record", area: "devnet", command: "record list", priority: "critical", implementedBy: r.rpc_devnet_records_list, examples: ex.examples_record_list,
  about: "The world's entries in order, filtered by who, kind, world-time range or trace. Every command is one wide entry: who, hats, world time, trace id, outcome, what it changed.", who: READ, changes: "Nothing: it only reads.",
  acceptance: [{ claim: "Every command a world ran is in its record, in order, with who ran it under which hat.", observes: `cli: after a run of commands by Hannah and an agent, \`record list --world town1 --json\` lists one entry per command with seq gap-free, who, hats, worldTime and outcome, refusals included.` }],
  returns: r.rpc_devnet_records_list.output, errors: [error_CLI_USAGE], refusals: [out, noWorld, { error: error_ROLE_PERMISSION_DENIED, given: W.member, when: "The caller has no grant in the world." }], budget: budget("read"),
});
export const operation_record_show = operation({
  id: "record.show", title: "Read one entry of the record in full", area: "devnet", command: "record show", priority: "normal", implementedBy: r.rpc_devnet_records_show, examples: ex.examples_record_show,
  about: "One entry with its redacted arguments, what it returned and changed, its pointers and its cause. No key, token, secret or password is ever in one.", who: READ, changes: "Nothing: it only reads.",
  acceptance: [{ claim: "An entry never holds a key, a token, a secret or a password.", observes: `cli: \`record show --world town1 --seq 12 --json\` for a command that signed prints a transaction hash and no key; a grep of the whole record for the test keys finds none.` }],
  returns: r.rpc_devnet_records_show.output, errors: [error_CLI_USAGE], refusals: [out, noWorld, { error: error_ROLE_PERMISSION_DENIED, given: W.member, when: "The caller has no grant in the world." }], budget: budget("read"),
});
export const operation_record_export = operation({
  id: "record.export", title: "Export the world's record as training data", area: "devnet", command: "record export", priority: "normal", implementedBy: r.rpc_devnet_records_export, examples: ex.examples_record_export,
  about: "Every entry as lines of JSON with the lineage first. The record is training data and a product of the system.", who: OWN, changes: "Nothing in the world; it writes a file on this machine.",
  acceptance: [{ claim: "An export carries the lineage and every entry once.", observes: `cli: \`record export --world town3 --out run.jsonl --json\` prints the line count and lineage naming town1; the file's first line is the lineage and the entries follow in order.` }],
  returns: r.rpc_devnet_records_export.output, errors: [error_CLI_USAGE], refusals: [out, noWorld, notOwner("export the record")], budget: budget("read"),
});
