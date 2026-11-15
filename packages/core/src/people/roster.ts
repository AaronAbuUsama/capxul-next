// Who belongs to a company: its Directors in the board's order, then its members, the founding ones first and then
// those who joined by an invitation, in the order they joined. The one reading of membership: member.list answers
// it, invitation.send refuses whoever is in it, and org.member.grant grants a permission only to someone in it.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import type { Organization } from "../organizations/store.ts";
import { joinedOf } from "./store.ts";

export interface Belonging {
  readonly person: string;
  readonly role: "director" | "member";
}

/** The company's people, each once, Directors first. */
export const rosterOf = Effect.fn("people.roster")(function* (organization: Organization) {
  const joined = yield* joinedOf(organization.org);
  const directors = Arr.map(organization.directors, (person): Belonging => ({ person, role: "director" }));
  const members = Arr.map([...organization.members, ...joined], (person): Belonging => ({ person, role: "member" }));
  return Arr.dedupeWith([...directors, ...members], (a, b) => a.person === b.person);
});

/** Whether `person` belongs to the company, as a Director or a member. */
export const belongs = (organization: Organization, person: string) =>
  Effect.map(
    rosterOf(organization),
    Arr.some((each) => each.person === person),
  );
