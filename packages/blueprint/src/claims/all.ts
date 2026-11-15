// Every operation's claims, gathered from the domains (src/domains.ts), domain by domain. The type makes an operation
// with no claims a compile error.
import * as Rec from "effect/Record";
import type { OperationName } from "../door.ts";
import { domains } from "../domains.ts";
import { gather } from "../gather.ts";
import type { ClaimsOf } from "./claim.ts";

export const allClaims: { readonly [Name in OperationName]: ClaimsOf } = gather(Rec.values(domains), "claims");
