// Who a requests call acts for, as the tables each guard reads. Not records: the rpcs in the area
// files spread these into their `reads`.
//
// - Yourself: the session's principal; your Safe is your person Party's (parties).
// - `--org <org>` to read: a current Seat in that Organization (organizations' members), else
//   ROLE_PERMISSION_DENIED; the inbox is keyed by the company Safe (organizations).
// - `--org <org>` to write (issue, cancel, decline, a service, a deposit match): the Seat's Safe wears the
//   Organization's Invoicing hat now, named by its deployment (organizations) and worn on chain
//   (indexing's hat wearers), else ROLE_PERMISSION_DENIED. Decision requests.invoicing-hat.

import { table_org_deployments, table_org_members, table_organizations } from "../organizations/data.ts";
import { table_parties } from "../parties/data.ts";
import { table_hat_wearers } from "../indexing/data.ts";

export const GUARD_WAS = ["packages/backend/src/requests/guards.ts:19", "packages/backend/src/requests/guards.ts:44"];

/** A reader: yourself (your Party and Safe), or a member of the Organization (its Seat and company Safe). */
export const READER = [table_parties, table_organizations, table_org_members] as const;

/** A writer: a reader, and for an Organization the Invoicing hat on the Seat's Safe. */
export const WRITER = [...READER, table_org_deployments, table_hat_wearers] as const;
