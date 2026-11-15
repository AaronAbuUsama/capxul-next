// What the landing of a board subject means beyond its transaction (src/approvals/landed.ts gathers it with every
// other domain's). Not built yet: no operation opens a `board_change` while the board's handlers answer
// `NotImplemented` (src/domains/board.ts), so no landing of one can be reached. A builder makes a landed seat or
// threshold update the company's Board in `app.organizations` and queue the new Director's `grant` for the site
// (blueprint `src/board/order.md`).
import * as Effect from "effect/Effect";

/** The landings of this domain's subjects (blueprint `src/board/subjects.ts`), by kind. */
export const landings = {
  board_change: {
    landed: (id: string) => Effect.die(`the landing of the board change ${id} is not built`),
    orgOf: (id: string) => Effect.die(`the company of the board change ${id} is not built`),
  },
};
