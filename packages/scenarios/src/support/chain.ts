// Reading a world's chain through its door (decisions.md, 34): balances of the world's USDC, the hats a transaction
// minted, and the payments the Payments contract sent. Every read takes its addresses from the world's view, and goes
// to the door and as the operator a look at that world goes (`whereOf`).
import type { Chain } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Str from "effect/String";
import { Capxul } from "../client.ts";
import { whereOf, type View, type Who } from "./world.ts";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Two addresses are one, whatever their letters' case. */
export const isAddress = (a: string, b: string) => Str.toLowerCase(a) === Str.toLowerCase(b);

type Log = Chain.Log;
type Tagged<T extends Log["_tag"]> = Extract<Log, { readonly _tag: T }>;

/** The logs of one kind among `logs`. */
export const logsOf = <T extends Log["_tag"]>(logs: ReadonlyArray<Log>, tag: T): ReadonlyArray<Tagged<T>> =>
  Arr.filter(logs, (log): log is Tagged<T> => log._tag === tag);

/** What `holder` holds of the world's USDC, at the latest block or `block`, through the door `who` names. */
export const usdc = (world: View, holder: string, who: Who = {}, block: number | null = null) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    return yield* capxul.chain.balance({ token: world.contracts.usdc, holder, block }, whereOf(who));
  });

/** The hats a transaction minted to `wearer`: its TransferSingle logs from the world's Hats, from the zero address. */
export const mintedTo = (world: View, logs: ReadonlyArray<Log>, wearer: string) =>
  Arr.filter(
    logsOf(logs, "TransferSingle"),
    (log) =>
      isAddress(log.address, world.contracts.hats) && isAddress(log.from, ZERO_ADDRESS) && isAddress(log.to, wearer),
  );

/** Every PaymentSent of the world's Payments contract carrying `paymentId`, through the door `who` names. */
export const paymentsSent = (world: View, paymentId: string, who: Who = {}) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const logs = yield* capxul.chain.logs(
      { log: "PaymentSent", address: world.contracts.payments, fromBlock: null, toBlock: null },
      whereOf(who),
    );
    return Arr.filter(logsOf(logs, "PaymentSent"), (log) => log.paymentId === paymentId);
  });
