// What an approval of the domain "organizations" authorises (`Subject` in ../values.ts): a company's setup by its
// org id (`org.create`), an officer change by its change id (`org.member.grant`).
import * as Schema from "effect/Schema";
import { ChangeId, OrgId } from "../ids.ts";

export const subjects = [
  Schema.Struct({ kind: Schema.Literal("org_setup"), id: OrgId }),
  Schema.Struct({ kind: Schema.Literal("officer_change"), id: ChangeId }),
] as const;
