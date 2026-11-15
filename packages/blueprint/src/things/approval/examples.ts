// Example data `approval sign` shares with the starting points.
import * as Str from "effect/String";
import { Collected, Sent } from "./values.ts";

/** dana's signature of sam's Manage books, collected, as `approval.sign`'s first example gives it. */
export const booksCollected = Collected.make({
  approval: "apr_books1",
  signer: "dana",
  subject: { kind: "officer_change", id: "chg_books1" },
  signatures: 1,
  threshold: 2,
});

/** sam's signature of the held payment, which sent it, as `approval.sign`'s second example gives it. */
export const paymentSent = Sent.make({
  approval: "apr_pay00001",
  signer: "sam",
  subject: { kind: "payment", id: "req_pay00001" },
  transaction: `0x${Str.repeat(32)("77")}`,
  block: 47893300,
});
