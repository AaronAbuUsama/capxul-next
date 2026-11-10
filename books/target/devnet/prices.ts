// Devnet's prices area: USD rates scripted on this devnet. Books keeps one price writer, its Chainlink
// sync (books.prices.sync); on a devnet the Chainlink fake answers from devnet's scripted prices
// (./data.ts), and `dev prices set` (./flows.ts) scripts a rate and runs that sync once, so the money
// facts written after it take the rate (decision devnet.scripted-prices).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_devnet } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED } from "../shared/vocabulary.ts";
import { table_scripted_prices } from "./data.ts";

const S = Schema.String;

export const rpc_devnet_prices_script = defineRpc({
  id: "devnet.prices.script",
  title: "Script a pair's USD rate from a time on",
  about:
    "One transaction. The pair is `ASSET/USD` for an asset Capxul prices (USDC, USDT, EURC, WETH, WBTC), else INVALID_INPUT " +
    "naming them; the rate is a positive USD amount per unit, kept to eight decimals. Without `from` it is the pair's base " +
    "rate (from the epoch). The same pair and `from` again replaces the row. It answers the pair, the rate, its start " +
    "(`0` for a base rate) and its source, `devnet:<pair>`.",
  was: [
    "packages/backend/src/books/facts/operations/price.ts:23",
    "packages/backend/src/books/facts/operations/price.ts:26",
    "packages/protocol/src/books/fact-schema.ts:88",
  ],
  concept: concept_devnet,
  kind: "mutation",
  who: "devnet only: a signed-in person.",
  input: Schema.Struct({ pair: S, rate: S, from: Schema.optionalKey(Schema.DateTimeUtc) }),
  output: Schema.Struct({ pair: S, rate: S, from: Schema.Number, source: S }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT],
  reads: [table_scripted_prices],
  writes: [table_scripted_prices],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: ["rpc.devnet.prices.script"],
  budget: budget("write"),
});
