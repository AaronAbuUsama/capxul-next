// What an approval of the domain "documents" authorises (`Subject` in ../values.ts): a held payment by its request
// id (`doc.submit`'s Held).
import * as Schema from "effect/Schema";
import { PaymentRequestId } from "../ids.ts";

export const subjects = [Schema.Struct({ kind: Schema.Literal("payment"), id: PaymentRequestId })] as const;
