// `capxul member list`: a company's Directors and members.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { log, promise, promisesOf, span, verb } from "@capxul/blueprint-tools";
import { NotImplemented, OrgNotFound } from "../../../common/refusals.ts";
import { OrgId, roles } from "../../../common/values.ts";
import { startingPoints as w, type PromisesOf } from "../../../starting-points/points.ts";
import { StepKind } from "../../../telemetry/step-kinds.ts";
import { NotAMember } from "../../company/refusals.ts";
import { Member, MemberRefusalRule } from "../values.ts";

/** Its logs. */
const logs = {
  /** Written where it refuses, naming the rule that refused. */
  refused: log("member.list.refused", { org: OrgId, rule: MemberRefusalRule }),
};

export const memberList = verb({
  rpc: Rpc.make("member.list", {
    payload: { org: OrgId },
    success: Schema.Struct({
      org: OrgId,
      /**
       * Its Directors in the board's order, then its members in the order they joined. Its Directors and members see
       * it, and so does the world's owner, who sees the whole world; anyone else is refused with `NotAMember`.
       */
      members: Schema.Array(Member),
    }),
    error: Schema.Union([OrgNotFound, NotAMember, NotImplemented]),
  }),
  emits: [],
  allowed: [roles.member, roles.operator],
  refusesOthers: NotAMember,
  spans: {
    /** The company, its board and its members, and the cast entry of each, from the world's database. */
    read: span("member.list.read", StepKind.database),
  },
  logs,
  refusals: {
    OrgNotFound: logs.refused,
    NotAMember: logs.refused,
  },
  budget: {
    excludes: ["waking a parked world"],
    provisional: true,
    ms: 1_000,
    basis: "one read of the world's database",
  },
  examples: [
    {
      payload: { org: "org_northwind1" },
      success: {
        org: "org_northwind1",
        members: [
          { person: "dana", email: "dana@cast.test", role: "director" },
          { person: "eli", email: "eli@cast.test", role: "director" },
          { person: "sam", email: "sam@cast.test", role: "member" },
          { person: "pat", email: "pat@cast.test", role: "member" },
          { person: "olga", email: "olga@cast.test", role: "member" as const },
        ],
      },
    },
  ],
});

/** Who serves it: a world's Core, through the world's door (`WorldRpcs`). */
export const server = "world";

/** It moves no thing with a lifecycle (the machine format): why. */
export const stateless = "a read: lists a company's members and changes nothing";

/** What `member.list` promises, each promise checked by the journeys. */
export const promises: PromisesOf = promisesOf(memberList, [
  promise(
    "The company's people: its Directors in the board's order, then its members in the order they joined.",
    w.founded,
    "member.list as dana of Northwind answers dana and eli as Directors, then sam and pat as members, each with the email of their cast entry; after olga accepts, olga follows pat as a member, and she sees the same list. It reads only: the world's history gains no entry.",
    { thinLine: true },
  ),
  promise(
    "Only the company's own people, and the world's owner, see it.",
    w.founded,
    "member.list as the world's owner answers what it answers dana. As olga before she accepts it is refused with NotAMember naming Northwind and olga; of a company nobody founded, with OrgNotFound. The world's history shows no new entry.",
    { refusals: [NotAMember, OrgNotFound] },
  ),
]);
