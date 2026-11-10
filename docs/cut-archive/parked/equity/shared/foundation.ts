// Moved out of the built book by the cut, 10 November 2026, from books/target/shared/foundation.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import {
  defineComponent,
  defineConcept,
  defineEnvironment,
  defineSystem,
  type Concept,
} from "../../../packages/book/src/index.ts";
import type { FrozenId } from "../../frozen/index.ts";
import type { CUT } from "./cut.ts";

export const concept_equity = defineConcept({
  id: "equity",
  title: "Equity",
  about:
    "The company's equity, low priority and off the critical path: share classes and the cap table, issues and transfers, " +
    "vesting, options (grant, accept, exercise, end), priced rounds and SAFEs (create, invite, commit, sign, allocate, pay, " +
    "close, cancel), exits, a shareholder's shares, and shareholder votes through the Governor. A Board matter is a Board " +
    "proposal. Split from old organizations.",
  component: B,
  dependsOn: [
    concept_access, concept_parties, concept_indexing, concept_approvals, concept_accounts, concept_organizations, concept_board,
    concept_documents,
  ],
  was: [`${OLD}/organizations/README.md:3`],
});
