// `capxul invitation list` (today `invite.list`): a person lists the invitations sent to them.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { declare, claim } from "@capxul/blueprint-tools";
import { NotImplemented } from "../../common/refusals.ts";
import { startingWorlds as w, type ClaimsOf } from "../../starting-points/points.ts";
import { invitation } from "./examples.ts";
import { Invitation } from "./values.ts";

export const inviteList = declare({
  rpc: Rpc.make("invite.list", {
    payload: {},
    success: Schema.Struct({
      /** Every invitation sent to the caller's email, whatever its state, oldest first. The world's owner has none. */
      invitations: Schema.Array(Invitation),
    }),
    error: NotImplemented,
  }),
  emits: [],
  budget: {
    excludes: ["waking a parked world"],
    provisional: true,
    ms: 1_000,
    basis: "one read of the world's database",
  },
  examples: [{ payload: {}, success: { invitations: [invitation("inv_olga01", "pending")] } }],
});

/** Who serves it: a world's Core, through the world's door (`WorldRpcs`). */
export const server = "world";

/** It moves no thing with a lifecycle (the machine format): why. */
export const stateless = "a read: lists the caller's invitations and changes nothing";

/** What `invite.list` promises, each promise checked by the journeys. */
export const promises: ClaimsOf = {
  operation: inviteList,
  claims: [
    claim(
      "A person lists every invitation sent to their email, whatever its state, oldest first, and only those.",
      w.founded,
      "invite.list as olga after dana invites her answers that invitation, pending, from dana for Northwind; after she declines it and accepts dana's second, it answers both, the first declined then the second accepted. rex@elsewhere.test's invitation is listed to nobody of the cast. As sam it answers none. Every invitation it lists is to the caller's email, and the record gains no entry.",
      { thinLine: true },
    ),
  ],
  dropped: [],
};
