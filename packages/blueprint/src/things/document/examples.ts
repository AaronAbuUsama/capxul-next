// Example data the document's verbs share with the starting points.
import * as Str from "effect/String";
import { exampleAddress as address } from "../world/examples.ts";
import { type Created, Held, Posted } from "./values.ts";

/** The Supplier, as `doc.create`'s example makes it. */
export const supplierCreated: typeof Created.Type = {
  doctype: "Supplier",
  name: "Brightside Cleaning Ltd",
  docstatus: 0,
  fields: { supplier_name: "Brightside Cleaning Ltd" },
  hash: `0x${Str.repeat(32)("cd")}`,
};

/** The Purchase Invoice, posted, as `doc.submit`'s first example submits it. */
export const postedInvoice = Posted.make({ doctype: "Purchase Invoice", name: "ACC-PINV-2026-00001", docstatus: 1 });

/** The Payment Entry, held for sam, as `doc.submit`'s second example submits it. */
export const heldPayment = Held.make({
  doctype: "Payment Entry",
  name: "ACC-PAY-2026-00001",
  docstatus: 0,
  payment: {
    request: "req_pay00001",
    amount: { asset: "USDC", amount: "125.50" },
    payee: "Brightside Cleaning Ltd",
    payeeAddress: address(31),
    documentHash: `0x${Str.repeat(32)("ef")}`,
    paymentId: `0x${Str.repeat(32)("9a")}`,
  },
  approval: {
    id: "apr_pay00001",
    signer: "sam",
    signerAddress: address(3),
    digest: `0x${Str.repeat(32)("12")}`,
    expiresAt: "2026-11-14T09:00:00Z",
  },
});
