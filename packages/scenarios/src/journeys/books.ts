// What the journeys read of a company's books and chain to observe what a step did: the company Safe's ledger lines
// and closing balance, what is outstanding on an invoice, a world's state as one value to compare before and after.
import { Site } from "@capxul/blueprint";
import { Cast } from "../cast.ts";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { Success } from "../client.ts";
import { usdc } from "../support/chain.ts";
import { present } from "../support/expect.ts";
import { isSafeAccount, ledger, linesOf, numberOf, safeBalance } from "../support/site.ts";
import { fieldOf, headOf, personalSafes, textOf, type View, type Who } from "../support/world.ts";

type Rows = Success<"report.run">["rows"];
const ROW = Site.ROW_FIELDS;

/** A General Ledger's postings: opening, total and closing rows name no voucher. */
export const postings = (rows: Rows) => Arr.filter(rows, (row) => textOf(row, ROW.voucher) !== "");

/** Debits less credits on the company Safe's account among a General Ledger's postings. */
export const safeBalanceOf = (rows: Rows) => safeBalance(postings(rows));

/** The Trial Balance's closing balance of the company Safe's account. */
export const closingSafeBalance = (rows: Rows) =>
  Effect.map(
    present(
      "the company Safe's account in the Trial Balance",
      Option.getOrNull(Arr.findFirst(rows, (row) => isSafeAccount(textOf(row, ROW.account)))),
    ),
    (row) => numberOf(fieldOf(row, ROW.closingDebit)) - numberOf(fieldOf(row, ROW.closingCredit)),
  );

/** What Accounts Payable says is still owed on `invoice`: 0 when it lists nothing for it. */
export const owedOn = (rows: Rows, invoice: string) =>
  Arr.reduce(linesOf(rows, invoice), 0, (sum, row) => sum + numberOf(fieldOf(row, ROW.outstanding)));

/** A world as one value: its record's head, its General Ledger as sam, and the USDC of every Safe it knows. */
export const stateOf = (world: View, org: string, companySafe: string, who: Who) =>
  Effect.flatMap(Cast, (cast) =>
    Effect.all({
      head: headOf(who),
      books: ledger(org, {}, { ...who, as: cast.sam }),
      safes: Effect.forEach([companySafe, ...personalSafes(world)], (safe) => usdc(world, safe, who)),
    }),
  );
