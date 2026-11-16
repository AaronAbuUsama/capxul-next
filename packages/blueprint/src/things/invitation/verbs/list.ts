// `capxul invitation list`: a person lists the invitations sent to them.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { promise, promisesOf, span, verb } from "@capxul/blueprint-tools";
import { NotImplemented } from "../../../common/refusals.ts";
import { roles } from "../../../common/values.ts";
import { startingPoints as w, type PromisesOf } from "../../../starting-points/points.ts";
import { StepKind } from "../../../telemetry/step-kinds.ts";
import { Invitation } from "../values.ts";

export const invitationList = verb({
  rpc: Rpc.make("invitation.list", {
    payload: {},
    success: Schema.Struct({
      /** Every invitation sent to the caller's email, whatever its state, oldest first. The world's owner has none. */
      invitations: Schema.Array(Invitation),
    }),
    error: NotImplemented,
  }),
  emits: [],
  allowed: [roles.person, roles.operator],
  refusesOthers: null,
  spans: {
    /** The invitations sent to the caller's email, from the world's database. */
    load: span("invitation.list.load", StepKind.database),
  },
  logs: {},
  refusals: {},
  budget: {
    excludes: ["waking a parked world"],
    provisional: true,
    ms: 1_000,
    basis: "one read of the world's database",
  },
  examples: [
    {
      payload: {},
      success: {
        invitations: [
          {
            id: "inv_olga01",
            org: "org_northwind1",
            handle: "northwind",
            email: "olga@cast.test",
            role: "member" as const,
            invitedBy: "dana",
            state: "pending" as const,
            invitedAt: "2026-11-13T09:05:00.000Z",
          },
        ],
      },
    },
  ],
});

/** Who serves it: a world's Core, through the world's door (`WorldRpcs`). */
export const server = "world";

/** It moves no thing with a lifecycle (the machine format): why. */
export const stateless = "a read: lists the caller's invitations and changes nothing";

/** What `invitation.list` promises, each promise checked by the journeys. */
export const promises: PromisesOf = promisesOf(invitationList, [
  promise(
    "A person lists every invitation sent to their email, whatever its state, oldest first, and only those.",
    w.founded,
    "invitation.list as olga after dana invites her answers that invitation, pending, from dana for Northwind; after she declines it and accepts dana's second, it answers both, the first declined then the second accepted. rex@elsewhere.test's invitation is listed to nobody of the cast. As sam it answers none. Every invitation it lists is to the caller's email, and the world's history gains no entry.",
    { thinLine: true },
  ),
]);
