// The target book of the rebuilt Capxul: the shared records, then each concept's records as its
// design lands. Build it (stage "target" enforces the target rules in packages/book/src/build.ts):
//
//   node --experimental-strip-types packages/book/src/main.ts books/target/index.ts book-out/target
//
// A concept's designer adds `import * as <concept> from "./<concept>/index.ts";` and appends
// `...<concept>.modules` to `conceptModules`, in the dependency order of shared/foundation.ts.

import { recordsOf, sharedModules } from "./shared/index.ts";
import * as access from "./access/index.ts";
import * as media from "./media/index.ts";
import * as parties from "./parties/index.ts";
import * as indexing from "./indexing/index.ts";
import * as approvals from "./approvals/index.ts";
import * as accounts from "./accounts/index.ts";
import * as organizations from "./organizations/index.ts";
import * as board from "./board/index.ts";
import * as agents from "./agents/index.ts";
import * as budgets from "./budgets/index.ts";
import * as books from "./books/index.ts";
import * as documents from "./documents/index.ts";
import * as contacts from "./contacts/index.ts";
import * as payments from "./payments/index.ts";
import * as payroll from "./payroll/index.ts";
import * as banking from "./banking/index.ts";
import * as requests from "./requests/index.ts";
import * as applications from "./applications/index.ts";
import * as equity from "./equity/index.ts";
import * as activity from "./activity/index.ts";
import * as notices from "./notices/index.ts";
import * as devnet from "./devnet/index.ts";
import * as journeys from "./journeys.ts";

export const name = "Capxul target";
export const stage = "target" as const;

/** Each designed concept's modules (its <concept>/index.ts exports `modules`). Empty until the designs land. */
const conceptModules: readonly object[] = [...access.modules, ...media.modules, ...parties.modules, ...indexing.modules, ...approvals.modules, ...accounts.modules, ...organizations.modules, ...board.modules, ...agents.modules, ...budgets.modules, ...books.modules, ...documents.modules, ...contacts.modules, ...payments.modules, ...payroll.modules, ...banking.modules, ...requests.modules, ...applications.modules, ...equity.modules, ...activity.modules, ...notices.modules, ...devnet.modules];

export const records = recordsOf([...sharedModules, ...conceptModules, journeys]);
