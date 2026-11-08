// The target book of the rebuilt Capxul: the shared records, then each concept's records as its
// design lands. Build it (stage "target" enforces the target rules in packages/book/src/build.ts):
//
//   node --experimental-strip-types packages/book/src/main.ts books/target/index.ts book-out/target
//
// A concept's designer adds `import * as <concept> from "./<concept>/index.ts";` and appends
// `...<concept>.modules` to `conceptModules`, in the dependency order of shared/foundation.ts.

import { recordsOf, sharedModules } from "./shared/index.ts";
import * as parties from "./parties/index.ts";
import * as approvals from "./approvals/index.ts";
import * as contacts from "./contacts/index.ts";

export const name = "Capxul target";
export const stage = "target" as const;

/** Each designed concept's modules (its <concept>/index.ts exports `modules`). Empty until the designs land. */
const conceptModules: readonly object[] = [...parties.modules, ...approvals.modules, ...contacts.modules];

export const records = recordsOf([...sharedModules, ...conceptModules]);
