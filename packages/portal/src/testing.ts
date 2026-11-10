/**
 * The small book every module's test is run on: the invitations fixture of `@capxul/book`, plus one decision that
 * waits for an answer. Test-only: nothing under `modules/` or `main.ts` imports it.
 */
import { buildBook, defineDecision, keyOf, type AnyRecord, type StatusDocument } from "@capxul/book";

import { direction } from "#content/direction.ts";
import type { Assets } from "#src/modules/render/types.ts";
import type { PlanInput, SiteInput } from "#src/modules/site/types.ts";

import * as fixture from "../../book/test/fixtures/invitations.ts";

/** The id of the one decision that waits in the fixture. */
export const WAITING = "access.who-invites";

const waiting = defineDecision({
  id: WAITING,
  title: "Who may invite a member",
  question: "An invitation gives a person a way in. Who may send one?",
  options: [
    { label: "owners", text: "Only an Owner invites." },
    { label: "admins", text: "An Owner or an Admin invites." },
  ],
  chosen: "owners",
  why: "An invitation is a grant, and grants are an Owner's.",
  source: "The fixture.",
  affects: [fixture.invite],
});

const settled = defineDecision({
  id: "access.one-open",
  title: "One open invitation per email",
  question: "May the same email hold two open invitations to one Organization?",
  options: [{ label: "one", text: "One open invitation per email." }, { label: "many", text: "Any number." }],
  chosen: "one",
  why: "Two open invitations give two ways in for one person.",
  source: "The fixture.",
  affects: [fixture.oneOpen],
});

const isRecord = (u: unknown): u is AnyRecord => typeof u === "object" && u !== null && "_kind" in u && "id" in u;

/** Every record of the fixture book, for a test that changes one of them. */
export const fixtureRecords: readonly unknown[] = [...fixture.records, waiting, settled];

/**
 * The input of a site over the fixture book. The old CLI knows `org member invite` and nothing else.
 * At stage `as-is` the fixture has no problem; at stage `target` its operations have several, so they stand at specify.
 */
export const fixtureInput = (
  commit = "abc1234", stage: "as-is" | "target" = "as-is", status: StatusDocument | null = null, records: readonly unknown[] = fixtureRecords,
  plan: PlanInput | null = null,
): SiteInput => {
  const book = buildBook({ name: "fixture", stage, records });
  const conceptOf = new Map<string, string>();
  for (const r of book.records.values()) {
    const concept = r["concept"];
    if (isRecord(concept)) conceptOf.set(keyOf(r), concept.id);
  }
  return {
    book, commit, concepts: ["access", "organizations"], conceptOf, direction, status, plan,
    waits: (decision) => decision.id === WAITING,
    frozenOperations: new Set(["org.member.invite"]),
    frozen: new Map([["org.member.invite", {
      command: "org member invite", inCli: true,
      arguments: [{ name: "email", type: "string", required: true, variadic: false, description: "Who is invited." }],
      flags: [{
        flag: "--role", alias: "-r", takesValue: true, type: "string", metavar: "role", required: false, repeatable: false,
        description: "The role the invitee takes.", default: "member",
      }],
    }]]),
  };
};

export const fixtureAssets: Assets = { css: "body { margin: 0; }\n", js: "/* no script */\n" };
