// `capxul member list` (today `org.member.list`): a company's Directors and members.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { declare, claim } from "@capxul/blueprint-tools";
import { NotImplemented, OrgNotFound } from "../../../common/refusals.ts";
import { OrgId } from "../../../common/values.ts";
import { startingWorlds as w, type ClaimsOf } from "../../../starting-points/points.ts";
import { NotAMember } from "../../company/refusals.ts";
import { olga } from "../examples.ts";
import { Member } from "../values.ts";

export const memberList = declare({
  rpc: Rpc.make("org.member.list", {
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
          olga,
        ],
      },
    },
  ],
});

/** Who serves it: a world's Core, through the world's door (`WorldRpcs`). */
export const server = "world";

/** It moves no thing with a lifecycle (the machine format): why. */
export const stateless = "a read: lists a company's members and changes nothing";

/** What `org.member.list` promises, each promise checked by the journeys. */
export const promises: ClaimsOf = {
  operation: memberList,
  claims: [
    claim(
      "The company's people: its Directors in the board's order, then its members in the order they joined.",
      w.founded,
      "org.member.list as dana of Northwind answers dana and eli as Directors, then sam and pat as members, each with the email of their cast entry; after olga accepts, olga follows pat as a member, and she sees the same list. It reads only: the record gains no entry.",
      { thinLine: true },
    ),
    claim(
      "Only the company's own people, and the world's owner, see it.",
      w.founded,
      "org.member.list as the world's owner answers what it answers dana. As olga before she accepts it is refused with NotAMember naming Northwind and olga; of a company nobody founded, with OrgNotFound. record.export shows no new entry.",
      { refusals: [NotAMember, OrgNotFound] },
    ),
  ],
  dropped: [],
};
