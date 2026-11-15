// Step 3.5's proof: the delta check (src/delta.ts) and the machine format it reads (src/machine-format.ts), first on
// made-up domains and machines, then on the blueprint itself. Written before the existing operations are classified,
// by another agent than the one who classifies them (AGENTS.md, "How a feature is built"). Run with `pnpm test`.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import * as Str from "effect/String";
import { blueprint, deltaCheck, type Finding } from "../src/delta.ts";
import type { Format } from "../src/format.ts";
import { formats } from "../src/formats.ts";
import { machineFormat, type Declared, type DomainShape, type MachineShape } from "../src/machine-format.ts";

/** The most operations each format's `unmigrated` list may hold. Set by the lead; each may only fall. */
const CEILINGS: { readonly [format: string]: number } = { machine: 0 };

const closed = { refusal: "Closed" } as const;

/** A made-up machine: a ticket, opened by `ticket.open`, closed by `ticket.close`, reopened by `ticket.reopen`. */
const ticket = (moves?: Partial<MachineShape["moves"]>): MachineShape => ({
  name: "ticket",
  states: ["open", "closed"],
  start: { by: "ticket.open" },
  moves: {
    close: { from: ["open"], by: "ticket.close", otherwise: { closed: "unchanged" } },
    reopen: { from: ["closed"], by: "ticket.reopen", otherwise: { open: closed } },
    ...moves,
  },
});

/** A made-up domain, "tickets": the ticket's three operations and a read. */
const tickets = (overrides?: Partial<DomainShape>): DomainShape => ({
  operations: { "ticket.open": [], "ticket.close": [], "ticket.reopen": ["Closed"], "ticket.list": [] },
  machines: { ticket: ticket() },
  stateless: { "ticket.list": "a read: changes nothing" },
  ...overrides,
});

/** Runs the check on `domains`, with the machine format allowing `unmigrated`. */
const run = (domains: Declared, unmigrated: ReadonlyArray<string> = []): ReadonlyArray<Finding> =>
  deltaCheck({
    operations: Arr.flatMap(Rec.values(domains), (domain) => Rec.keys(domain.operations)),
    formats: { machine: machineFormat(domains, unmigrated) },
  });

const about = (findings: ReadonlyArray<Finding>) =>
  Arr.map(findings, (finding) => `${finding.operation} (${finding.format}): ${finding.reason}`);

/** Asserts exactly one finding, about `operation`, whose reason holds `words`. */
const one = (findings: ReadonlyArray<Finding>, operation: string, words: string) => {
  assert.equal(findings.length, 1, Arr.join(about(findings), "\n"));
  const [finding] = findings;
  assert.equal(finding?.operation, operation);
  assert.equal(finding?.format, "machine");
  assert.ok(Str.includes(words)(finding?.reason ?? ""), finding?.reason);
};

test("a domain whose operations each start or move a machine, or are stateless with a reason, passes", () => {
  assert.deepEqual(run({ tickets: tickets() }), []);
});

test("an operation that is no machine's start or move, and not stateless, lacks the format", () => {
  one(run({ tickets: tickets({ stateless: {} }) }), "ticket.list", "not declare it stateless");
});

test("a stateless operation with an empty reason lacks the format", () => {
  one(run({ tickets: tickets({ stateless: { "ticket.list": "  " } }) }), "ticket.list", "no reason");
});

test("an operation both stateless and a machine's start or move contradicts itself", () => {
  const stateless = { "ticket.list": "a read", "ticket.close": "it closes nothing" };
  one(run({ tickets: tickets({ stateless }) }), "ticket.close", "yet it makes ticket.close");
  const starting = { "ticket.list": "a read", "ticket.open": "it opens nothing" };
  one(run({ tickets: tickets({ stateless: starting }) }), "ticket.open", "ticket's start");
});

test("a move that declares nothing from a state it cannot start from lacks the format", () => {
  const machine = ticket({ reopen: { from: ["closed"], by: "ticket.reopen", otherwise: {} } });
  one(run({ tickets: tickets({ machines: { ticket: machine } }) }), "ticket.reopen", "declares nothing from open");
});

test("a move that names a state in both `from` and `otherwise`, or a state it does not have, lacks the format", () => {
  const twice = ticket({
    close: { from: ["open"], by: "ticket.close", otherwise: { open: "unchanged", closed: "unchanged" } },
  });
  one(run({ tickets: tickets({ machines: { ticket: twice } }) }), "ticket.close", "both in `from`");
  const stranger = ticket({
    close: { from: ["open"], by: "ticket.close", otherwise: { closed: "unchanged", lost: "unchanged" } },
  });
  one(run({ tickets: tickets({ machines: { ticket: stranger } }) }), "ticket.close", "lost in `otherwise`");
});

test("a move refusing with a refusal its operation does not declare lacks the format", () => {
  const operations = { "ticket.open": [], "ticket.close": [], "ticket.reopen": [], "ticket.list": [] };
  one(run({ tickets: tickets({ operations }) }), "ticket.reopen", "does not declare");
});

test("a move from every state needs no `otherwise`", () => {
  const machine = ticket({ reopen: { from: ["open", "closed"], by: "ticket.reopen", otherwise: {} } });
  assert.deepEqual(run({ tickets: tickets({ machines: { ticket: machine } }) }), []);
});

test("a machine in another domain counts: the operation need not live beside its machine", () => {
  const notes: DomainShape = { operations: { "note.add": [] }, machines: {}, stateless: { "note.add": "a note" } };
  const elsewhere: DomainShape = { ...tickets(), machines: {} };
  const holder: DomainShape = { operations: {}, machines: { ticket: ticket() }, stateless: {} };
  assert.deepEqual(run({ tickets: elsewhere, notes, holder }), []);
});

test("a domain that exports no `stateless` is a finding of its own", () => {
  const holder: DomainShape = { operations: {}, machines: { ticket: ticket() }, stateless: undefined };
  const findings = run({ tickets: { ...tickets(), machines: {} }, holder });
  one(findings, "holder", "exports no `stateless`");
});

test("a `stateless` entry that is no operation of its domain is a finding", () => {
  const notes: DomainShape = {
    operations: {},
    machines: {},
    stateless: { "ticket.list": "declared in the wrong place" },
  };
  one(run({ tickets: tickets(), notes }), "ticket.list", "no operation there");
});

test("an unmigrated operation that lacks the format is allowed", () => {
  assert.deepEqual(run({ tickets: tickets({ stateless: {} }) }, ["ticket.list"]), []);
});

test("an unmigrated operation that now has the format is a finding: remove it from the list", () => {
  one(run({ tickets: tickets() }, ["ticket.list"]), "ticket.list", "remove it from machine's unmigrated list");
});

test("an unmigrated entry that names no operation is a finding", () => {
  one(run({ tickets: tickets() }, ["ticket.gone"]), "ticket.gone", "names no operation");
});

test("an unmigrated entry listed twice is a finding", () => {
  one(run({ tickets: tickets({ stateless: {} }) }, ["ticket.list", "ticket.list"]), "ticket.list", "more than once");
});

test("every finding names its format", () => {
  const steps: Format = { missing: () => ["no steps declared"], unmigrated: [] };
  const findings = deltaCheck({ operations: ["ticket.list"], formats: { steps } });
  assert.deepEqual(findings, [{ operation: "ticket.list", format: "steps", reason: "no steps declared" }]);
});

test("the blueprint: every operation has every format, or is on its unmigrated list", () => {
  assert.deepEqual(about(deltaCheck()), []);
});

test("the blueprint: every format's unmigrated list is under its ceiling, which may only fall, and has no repeats", () => {
  assert.deepEqual(Rec.keys(formats), Rec.keys(CEILINGS), "every format has a ceiling, and only formats do");
  for (const [name, format] of Rec.toEntries(formats)) {
    const ceiling = CEILINGS[name] ?? 0;
    assert.ok(format.unmigrated.length <= ceiling, `${name}: ${format.unmigrated.length} over ${ceiling}`);
    assert.equal(Arr.dedupe(format.unmigrated).length, format.unmigrated.length, `${name}: an entry twice`);
  }
  assert.strictEqual(blueprint.formats, formats);
});
