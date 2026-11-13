// org.member.grant, claim 5: the proposal mints the officer hat to the member's Safe, and takes one more seat first
// when every seat is worn. Checked: the proposal executes in one transaction once both Directors sign, and the
// operations then say sam's Safe wears the hat (AlreadyHeld). Not checked: that the transaction is
// Hats.mintHat(hat, sam's Safe), preceded by changeHatMaxSupply when every seat is worn, which only the door's
// chain RPC shows, and Capxul does not offer it.
import * as Effect from "effect/Effect";
import { scenario } from "../scenario.ts";
import { refusal, same } from "../support/expect.ts";
import { grant, grantSigned } from "../support/grants.ts";
import { northwind } from "../support/world.ts";

export const orgMemberGrant5 = scenario(
  { operation: "org.member.grant", claim: 5 },
  Effect.gen(function* () {
    const { org } = yield* northwind;
    const { sent } = yield* grantSigned(org, "sam", "manage-books");
    yield* same("the executed subject's kind", sent.subject.kind, "officer_change");
    const held = yield* refusal(
      "a second grant of manage-books to sam",
      "AlreadyHeld",
      grant(org, "sam", "manage-books"),
    );
    yield* same("AlreadyHeld's person", held.person, "sam");
  }),
);
