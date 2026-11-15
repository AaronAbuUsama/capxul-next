// What is a command, a refusal or an event is known by its place and its shape (docs/design/blueprint.md, part 13,
// "Amended", point 2; roadmap item 3.10). One constructor per kind, each branding what it makes: `verb(...)`
// replaces `declare` and `declareOutcomes`, outcomes an option of it; `refusal(...)` is a tagged error carrying its
// exit code on its own declaration, so the per-thing `exitCode` map goes; `event(...)` is a tagged class. A verb's
// file declares exactly one verb and no refusal or event; a thing's refusals.ts holds only refusals, its events.ts
// only events; shared refusals stay in src/common/refusals.ts, also refusals. Written first, by the ✍️ author of 3.10,
// before it is built: each test fails today. Run with `pnpm test`.
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import * as Arr from "effect/Array";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
import * as Str from "effect/String";
import { operations, refusalsOf, type Operation } from "../src/index.ts";
import { field, kindOf, toolkit } from "./format-door.ts";

const SRC = new URL("../src/", import.meta.url);
const THINGS = new URL("things/", SRC);

/** Every file under src/things/, by its path from there. */
const files = Arr.filter(readdirSync(THINGS, { recursive: true, encoding: "utf8" }), (path) =>
  Str.endsWith(".ts")(path),
);

/** The names a file exports for the generated indexes, never as declarations (the toolkit's RESERVED). */
const RESERVED = ["promises", "server", "stateless", "subjects", "refusals"];

/** The values a file exports, by name, less the reserved ones. */
const exported = async (url: URL): Promise<ReadonlyArray<readonly [string, unknown]>> => {
  const module: { readonly [name: string]: unknown } = { ...(await import(url.href)) };
  return Arr.filter(Rec.toEntries(module), ([name]) => !Arr.contains(RESERVED, name));
};

/** Every exported value of the files that end with `suffix`, with the file it is exported from. */
const declaredIn = async (
  suffix: string,
): Promise<ReadonlyArray<{ readonly file: string; readonly name: string; readonly value: unknown }>> =>
  Arr.flatten(
    await Promise.all(
      Arr.map(
        Arr.filter(files, (path) => Str.endsWith(suffix)(path)),
        async (file) =>
          Arr.map(await exported(new URL(file, THINGS)), ([name, value]) => ({ file: `things/${file}`, name, value })),
      ),
    ),
  );

/** Today's exit code of every refusal (src/generated/refusals.ts at e3a7df8): moving each onto its own declaration changes none. */
const EXIT_CODES: { readonly [tag: string]: number } = {
  NotSignedIn: 3,
  NotWorldOwner: 4,
  PayloadRejected: 2,
  NotImplemented: 6,
  OrgNotFound: 2,
  InsufficientBalance: 2,
  NoSiteUser: 4,
  SiteRefused: 2,
  SiteUnavailable: 5,
  ApprovalNotFound: 2,
  NotYourApproval: 4,
  SignatureInvalid: 2,
  ApprovalExpired: 2,
  ApprovalClosed: 2,
  TransactionReverted: 5,
  CannotChangeBoard: 4,
  ThresholdTooHigh: 2,
  ThresholdUnchanged: 2,
  BoardChangeWaiting: 2,
  BudgetNotFound: 2,
  ExceedsParent: 2,
  ClockBackwards: 2,
  PersonNotFound: 2,
  FounderNotReady: 2,
  HandleTaken: 2,
  FoundingChanged: 2,
  SetupUnfinished: 2,
  NotADirector: 4,
  NotAMember: 2,
  MemberHasNoSafe: 2,
  AlreadyADirector: 2,
  NotADraft: 2,
  ExportNotAllowed: 4,
  CannotManagePeople: 4,
  AlreadyAMember: 2,
  AlreadyInvited: 2,
  InvitationNotFound: 2,
  NotYourInvitation: 4,
  InvitationClosed: 2,
  AlreadyHeld: 2,
  ChangeWaiting: 2,
  SnapshotExists: 2,
  SnapshotNotFound: 2,
  SnapshotInUse: 2,
  ExpiryBeyondSource: 2,
  WorldNotFound: 2,
  WorldExists: 2,
  GradeNotOffered: 4,
  WorldQuotaReached: 6,
  ClockBeforeSeed: 2,
};

/** Each export of `declared` whose kind is not `kind`, one line each. */
const notOfKind = (
  declared: ReadonlyArray<{ readonly file: string; readonly name: string; readonly value: unknown }>,
  kind: string,
): ReadonlyArray<string> =>
  Arr.flatMap(declared, ({ file, name, value }) => {
    const found = kindOf(value);
    return found === kind ? [] : [`${file}: ${name} is ${String(found)}, not a ${kind}`];
  });

test("the toolkit's door has one constructor per kind, verb, refusal and event, and no longer declare or declareOutcomes", () => {
  const missing = Arr.filter(["verb", "refusal", "event", "kindOf"], (name) => !Predicate.isFunction(toolkit[name]));
  assert.deepEqual(missing, [], `@capxul/blueprint-tools exports none of: ${Arr.join(missing, ", ")}`);
  const retired = Arr.filter(["declare", "declareOutcomes"], (name) => name in toolkit);
  assert.deepEqual(retired, [], `verb(...) replaces ${Arr.join(retired, " and ")}: the toolkit still exports it`);
});

test("a thing's refusals.ts holds only refusal(...), and no exitCode map", async () => {
  const declared = await declaredIn("/refusals.ts");
  const maps = Arr.filter(declared, ({ name }) => name === "exitCode");
  assert.deepEqual(
    Arr.map(maps, ({ file }) => file),
    [],
    "a refusal carries its exit code on its own declaration: these still export an exitCode map",
  );
  assert.deepEqual(notOfKind(declared, "refusal"), []);
});

test("src/common/refusals.ts holds only refusal(...), and no exitCode map", async () => {
  const module: { readonly [name: string]: unknown } = { ...(await import(new URL("common/refusals.ts", SRC).href)) };
  assert.ok(!("exitCode" in module), "src/common/refusals.ts still exports an exitCode map");
  const declared = Arr.map(
    Arr.filter(Rec.toEntries(module), ([name]) => !Arr.contains(RESERVED, name)),
    ([name, value]) => ({ file: "common/refusals.ts", name, value }),
  );
  assert.deepEqual(notOfKind(declared, "refusal"), []);
});

test("a thing's events.ts holds only event(...)", async () => {
  assert.deepEqual(notOfKind(await declaredIn("/events.ts"), "event"), []);
});

test("a verb's file declares exactly one verb(...), or one piece of work, and no refusal or event", async () => {
  const problems = Arr.flatten(
    await Promise.all(
      Arr.map(
        Arr.filter(files, (path) => Str.includes("/verbs/")(path)),
        async (file) => {
          const text = readFileSync(new URL(file, THINGS), "utf8");
          if (/^export const \w+ = work\(\{/m.test(text)) return [];
          const kinds = Arr.map(
            await exported(new URL(file, THINGS)),
            ([name, value]) => [name, kindOf(value)] as const,
          );
          const verbs = Arr.filter(kinds, ([, kind]) => kind === "verb");
          const strays = Arr.filter(kinds, ([, kind]) => kind === "refusal" || kind === "event");
          return [
            ...(verbs.length === 1 ? [] : [`things/${file}: declares ${verbs.length} verb(...), not one`]),
            ...Arr.map(
              strays,
              ([name, kind]) => `things/${file}: ${name} is a ${String(kind)}; it belongs beside verbs/`,
            ),
          ];
        },
      ),
    ),
  );
  assert.deepEqual(problems, []);
});

test("every refusal carries its exit code on its own declaration, today's code unchanged", () => {
  const all: ReadonlyArray<Operation> = Rec.values(operations);
  const refusals = Arr.dedupeWith(
    Arr.flatMap(all, (operation) => refusalsOf(operation)),
    (a, b) => a === b,
  );
  const wrong = Arr.flatMap(refusals, (refusal) => {
    const code = field(refusal, "exitCode");
    const today = EXIT_CODES[refusal.identifier];
    return code === today
      ? []
      : [`${refusal.identifier}: carries exit code ${String(code)}, expected ${String(today)} (today's)`];
  });
  assert.deepEqual(wrong, []);
});

test("every refusal an operation declares is a refusal(...), and every event it emits an event(...)", () => {
  const wrong = Arr.flatMap(Rec.toEntries(operations), ([name, operation]: readonly [string, Operation]) => [
    ...Arr.flatMap(refusalsOf(operation), (refusal) =>
      kindOf(refusal) === "refusal" ? [] : [`${name}: its refusal ${refusal.identifier} is no refusal(...)`],
    ),
    ...Arr.flatMap(operation.emits, (event) =>
      kindOf(event) === "event" ? [] : [`${name}: its event ${event.identifier} is no event(...)`],
    ),
    ...(kindOf(operation) === "verb" ? [] : [`${name}: its declaration is no verb(...)`]),
  ]);
  assert.deepEqual(wrong, []);
});
