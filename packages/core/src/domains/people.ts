// Core's handlers of the blueprint's domain "people": who belongs to a company and the invitations that bring a person
// in. None is built yet: each answers the blueprint's `NotImplemented`, naming itself (decisions.md, entry 33), so
// the journey "invite olga to Northwind" (packages/scenarios) fails at its first step until a builder writes them.
import { Errors } from "@capxul/blueprint";
import * as Effect from "effect/Effect";

/** The answer of an operation that is not built yet. */
const notBuilt = (operation: string) => () => Effect.fail(Errors.NotImplemented.make({ operation }));

/** Its share of the world group. */
export const world = {
  "org.member.invite": notBuilt("org.member.invite"),
  "invite.list": notBuilt("invite.list"),
  "invite.accept": notBuilt("invite.accept"),
  "invite.decline": notBuilt("invite.decline"),
  "org.member.list": notBuilt("org.member.list"),
};
