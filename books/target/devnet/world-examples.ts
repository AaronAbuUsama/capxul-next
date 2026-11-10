// The examples of the devnet's world operations (`world ...`, `record ...`): the world named `town` holds Northwind
// Trading, early 2026. Times in these shapes are epoch milliseconds. Commands use only what the records state.

import { error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE } from "../shared/vocabulary.ts";
import { CHAIN_ID, NORTHWIND, ok, refused } from "../shared/examples.ts";

const ms = (iso: string) => Date.parse(iso);

const town = (over: Record<string, unknown> = {}) => ({
  worldId: "town",
  name: "town",
  kind: "local",
  state: "running",
  clockMode: "frozen",
  rate: 1,
  worldNow: ms("2026-02-10T09:00:00Z"),
  epoch: 1,
  chainId: CHAIN_ID,
  hosted: false,
  parentWorld: null,
  parentSnapshot: null,
  parentSeq: null,
  companies: [{ orgId: NORTHWIND.orgId, name: NORTHWIND.name, url: "http://northwind-town.capxul.test" }],
  recordHead: 42,
  ...over,
});

const snapshot = (over: Record<string, unknown> = {}) => ({
  name: "m3",
  worldId: "town",
  epoch: 1,
  recordSeq: 42,
  clockMode: "frozen",
  rate: 1,
  worldNow: ms("2026-02-10T09:00:00Z"),
  template: false,
  createdAt: ms("2026-02-10T09:05:00Z"),
  sites: 1,
  ...over,
});

const entry = (seq: number, over: Record<string, unknown> = {}) => ({
  worldId: "town",
  epoch: 1,
  seq,
  kind: "command",
  worldTime: ms("2026-02-10T09:00:00Z"),
  realTime: ms("2026-02-10T09:00:03Z"),
  who: "hannah.okafor@northwind.test",
  hats: ["admin"],
  surface: "cli",
  traceId: "trace-" + String(seq).padStart(4, "0"),
  command: "payment send",
  outcome: "ok",
  code: null,
  causeSeq: null,
  branchAbandoned: false,
  ...over,
});

const clockAnswer = (mode: string, rate: number, now: string) => ({ worldId: "town", clockMode: mode, rate, worldNow: ms(now) });
const SIGNED_OUT = (input: string) => refused("Signed out", input, error_NOT_AUTHENTICATED);
const NO_WORLD = (input: string) => refused("No world has that name", input, error_INVALID_INPUT, { field: "world", name: "tow" });
const NOT_OWNER = (input: string) => refused("Priya is a player in the world, not its owner", input, error_ROLE_PERMISSION_DENIED);

export const examples_world_create = [
  ok("Make the world town with a frozen clock", "capxul world create town --template empty --clock frozen --json", { worldId: "town", state: "creating" }),
  refused("The world name has a hyphen", "capxul world create town-1 --template empty --clock frozen --json", error_INVALID_INPUT, { field: "id", value: "town-1" }),
  SIGNED_OUT("capxul world create town --template empty --clock frozen --json"),
];

export const examples_world_list = [
  ok("The worlds on this machine", "capxul world list --json", { worlds: [town(), town({ worldId: "town2", name: "town2", epoch: 1, parentWorld: "town", parentSnapshot: "m3", parentSeq: 42, recordHead: 1, companies: [] })] }),
  SIGNED_OUT("capxul world list --hosted --json"),
];

export const examples_world_show = [
  ok("Show town", "capxul world show town --json", town()),
  NO_WORLD("capxul world show tow --json"),
];

export const examples_world_register = [
  ok("Register town with the hosted site service", "capxul world register town --name northwind-town --json", { worldId: "town", name: "northwind-town", secret: "wsec_4f1c9a7e2b6d" }),
  refused("The name is already taken", "capxul world register town --name northwind-town --json", error_INVALID_INPUT, { field: "name", reason: "taken" }),
  NOT_OWNER("capxul world register town --name northwind-town --json"),
];

export const examples_world_clock_set = [
  ok("Run the world at four world seconds per real second", "capxul world clock set town --rate 4 --json", clockAnswer("running", 4, "2026-02-10T09:00:00Z")),
  refused("A rate outside 1 to 60", "capxul world clock set town --rate 61 --json", error_INVALID_INPUT, { field: "rate", range: "1 to 60" }),
  NOT_OWNER("capxul world clock set town --rate 4 --json"),
];

export const examples_world_clock_freeze = [
  ok("Freeze the world's clock", "capxul world clock freeze town --json", clockAnswer("frozen", 4, "2026-02-10T10:00:00Z")),
  NO_WORLD("capxul world clock freeze tow --json"),
];

export const examples_world_clock_resume = [
  ok("Resume the world's clock at the rate it had", "capxul world clock resume town --json", clockAnswer("running", 4, "2026-02-10T10:00:00Z")),
  NOT_OWNER("capxul world clock resume town --json"),
];

export const examples_world_clock_warp = [
  ok("Warp a week, to the next payroll run", "capxul world clock warp town --by 7d --json", clockAnswer("frozen", 1, "2026-02-17T09:00:00Z")),
  refused("A time before now", "capxul world clock warp town --by -1d --json", error_INVALID_INPUT, { field: "by", value: "-1d" }),
];

export const examples_world_snapshot_save = [
  ok("Save the world as m3", "capxul world snapshot save town m3 --json", snapshot()),
  refused("A snapshot named m3 exists and --replace was not given", "capxul world snapshot save town m3 --json", error_WRONG_STATE, { name: "m3" }),
  NOT_OWNER("capxul world snapshot save town m4 --json"),
];

export const examples_world_snapshot_list = [
  ok("Town's snapshots, newest first", "capxul world snapshot list town --json", { snapshots: [snapshot(), snapshot({ name: "m2", recordSeq: 30, createdAt: ms("2026-02-10T08:40:00Z") })] }),
  NO_WORLD("capxul world snapshot list tow --json"),
];

export const examples_world_snapshot_restore = [
  ok("Restore m3 into a separate world town2", "capxul world snapshot restore town m3 --as town2 --json", town({ worldId: "town2", name: "town2", parentWorld: "town", parentSnapshot: "m3", parentSeq: 42, recordHead: 1 })),
  refused("No snapshot of that name", "capxul world snapshot restore town m9 --json", error_INVALID_INPUT, { field: "snapshot", name: "m9" }),
  refused("The snapshot was saved with other backend code", "capxul world snapshot restore town m3 --json", error_WRONG_STATE, { saved: "a3f9c1e", running: "b81d20f" }),
];

export const examples_record_list = [
  ok("What Hannah and the ledger-agent ran in town", "capxul record list --world town --json", {
    entries: [
      entry(41),
      entry(42, { who: "ledger-agent", hats: ["agent"], surface: "agent", command: "payment list", traceId: "trace-0042" }),
    ],
  }),
  refused("No grant in the world", "capxul record list --world town --json", error_ROLE_PERMISSION_DENIED),
];

export const examples_record_show = [
  ok("One entry in full", "capxul record show --world town --seq 41 --json", {
    entry: entry(41),
    args: '{"to":"accounts@brightside.test","amount":"1200"}',
    returned: '{"status":"awaiting_approval"}',
    changed: '{"payments":1}',
    pointers: '{"approval":"approval_00000000-0000-4000-8000-000000000041"}',
  }),
  NO_WORLD("capxul record show --world tow --seq 41 --json"),
];

export const examples_record_export = [
  ok("Export town2's record, whose lineage names town", "capxul record export --world town2 --out run.jsonl --json", { lines: 43, bytes: 18420, lineage: { parentWorld: "town", parentSnapshot: "m3", parentSeq: 42 } }),
  NOT_OWNER("capxul record export --world town --out run.jsonl --json"),
];

