// `capxul director list` (today `org.director.list`): a company's Directors and its threshold.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { declare, claim } from "@capxul/blueprint-tools";
import { NotImplemented, OrgNotFound } from "../../../common/refusals.ts";
import { Address, HatId, OrgId, PersonId } from "../../../common/values.ts";
import { startingWorlds as w, type ClaimsOf } from "../../../starting-points/points.ts";
import { Threshold } from "../../board/values.ts";
import { NotAMember } from "../../company/refusals.ts";
import { exampleAddress as address } from "../../world/examples.ts";

/** One Director of a company: the person and the personal Safe that signs the company Safe. */
export const Director = Schema.Struct({ person: PersonId, safe: Address });

export const directorList = declare({
  rpc: Rpc.make("org.director.list", {
    payload: { org: OrgId },
    success: Schema.Struct({
      org: OrgId,
      /** The hat every Director's Safe wears, by its id on the world's Hats protocol. */
      directorHat: HatId,
      /** How many Directors must sign: the company Safe's threshold. */
      threshold: Threshold,
      /**
       * Its Directors, the founder first, then each in the order they were seated: the owners of the company Safe, read
       * from the chain. Its Directors and members see it, and so does the world's owner; anyone else is refused with
       * `NotAMember`.
       */
      directors: Schema.Array(Director),
    }),
    error: Schema.Union([OrgNotFound, NotAMember, NotImplemented]),
  }),
  emits: [],
  budget: {
    ms: 2_000,
    excludes: ["waking a parked world"],
    provisional: true,
    basis: "live reads of the company Safe's owners and threshold on the world's chain, and of the world's cast",
  },
  examples: [
    {
      payload: { org: "org_northwind1" },
      success: {
        org: "org_northwind1",
        directorHat: "26959946667150639794667015087019630673637144422540572481103610249216",
        threshold: 2,
        directors: [
          { person: "dana", safe: address(11) },
          { person: "eli", safe: address(12) },
        ],
      },
    },
  ],
});

/** Who serves it: a world's Core, through the world's door (`WorldRpcs`). */
export const server = "world";

/** It moves no thing with a lifecycle (the machine format): why. */
export const stateless = "a read: lists a company's Directors and threshold and changes nothing";

/** What `org.director.list` promises, each promise checked by the journeys. */
export const promises: ClaimsOf = {
  operation: directorList,
  claims: [
    claim(
      "A company's Board as the chain holds it: its Directors, the founder first, each with the Safe that signs, and how many must sign.",
      w.founded,
      "org.director.list as dana of Northwind answers dana and eli, each with the Safe of their cast entry, at threshold 2. Through the door's chain RPC those Safes are the company Safe's owners and 2 its threshold (chain.safe), and each wears the Director hat it names (chain.wears). Once sam is seated it answers dana, eli and sam at 2, as sam sees it too. It reads only: the record gains no entry.",
      { thinLine: true },
    ),
    claim(
      "Only the company's own people, and the world's owner, see it.",
      w.founded,
      "org.director.list as the world's owner answers what it answers dana. As olga, who belongs to no company, it is refused with NotAMember naming Northwind and olga; of a company nobody founded, with OrgNotFound. record.export shows no new entry.",
      { refusals: [NotAMember, OrgNotFound] },
    ),
  ],
  dropped: [],
};
