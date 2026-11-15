// What the landing of a board subject means beyond its transaction (src/approvals/landed.ts gathers it with every
// other domain's), inside the transaction that marks it sent. A change to the Board updates the company's Board in
// Core (`app.organizations`, its Directors and threshold), so a later proposal asks the new Director and needs the new
// threshold. A seat also queues the new Director's `grant` of the Director's site hat, as the setup's landing does for
// each founding Director, so their user reaches the company's site (blueprint `src/board/order.md`).
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Str from "effect/String";
import { Cast } from "../cast/Cast.ts";
import { deliver, SITE_HATS } from "../organizations/site.ts";
import * as Organizations from "../organizations/store.ts";
import * as Store from "./store.ts";

const changeLanded = (id: string) =>
  Effect.gen(function* () {
    const found = yield* Store.changeOf(id);
    if (Option.isNone(found)) return yield* Effect.void;
    const change = found.value;
    const organization = yield* Organizations.byOrg(change.org);
    if (Option.isNone(organization)) return yield* Effect.void;
    yield* Store.markLanded(id);
    const seated = change.action === "add" ? change.person : null;
    const directors = organization.value.directors;
    yield* Organizations.setBoard(
      change.org,
      seated === null ? directors : Arr.dedupe([...directors, seated]),
      change.after.threshold,
    );
    if (seated === null) return yield* Effect.void;
    const cast = yield* Cast;
    const member = yield* cast.find(seated);
    if (Option.isSome(member))
      yield* deliver(change.org, "grant", {
        email: member.value.email,
        name: Str.capitalize(seated),
        hat: SITE_HATS.director,
      });
    return yield* Effect.void;
  });

/** The landings of this domain's subjects (blueprint `src/board/subjects.ts`), by kind. */
export const landings = {
  board_change: {
    landed: changeLanded,
    orgOf: (id: string) =>
      Effect.map(
        Store.changeOf(id),
        Option.map((change) => change.org),
      ),
  },
};
