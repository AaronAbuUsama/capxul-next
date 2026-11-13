// What a subject's landing means beyond its transaction, by kind, and what must hold before it is sent. A company's
// setup makes the company ready: its top budget is read from the transaction's logs, and its site is to be told the
// company, its Safe, each Director's hat and the founder's capital. An officer change is executed, and the member's
// hat is to be told to the site. A payment's Payment Entry is to be posted on the site, as the chain paid it.
import { Errors } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Str from "effect/String";
import * as PgClient from "@effect/sql-pg/PgClient";
import { decodeEventLog, formatUnits } from "viem";
import { Cast } from "../cast/Cast.ts";
import { BUDGETS } from "../chain/abi.ts";
import { usdcOf } from "../chain/calls.ts";
import { SEEDED, USDC_DECIMALS } from "../chain/seeded.ts";
import type { Landed } from "../chain/userop.ts";
import { instant } from "../organizations/caller.ts";
import { worldNow } from "../record/emit.ts";
import { topicsOf } from "../organizations/found.ts";
import { deliver, SITE_HATS } from "../organizations/site.ts";
import * as Store from "../organizations/store.ts";
import { subjectOf, type Subject } from "./store.ts";
import { hex, sameAddress } from "../chain/hex.ts";

const title = (person: string) => Str.capitalize(person);

/** Refuses a send whose spend is more than its Safe holds now. */
export const checkFunds = Effect.fn("approval.sign.funds")(function* (subject: Subject) {
  const held = yield* subjectOf(subject.kind, subject.id);
  if (held.spends === null) return yield* Effect.void;
  const balance = yield* usdcOf(held.spends.safe);
  const amount = BigInt(held.spends.amount);
  if (amount > balance)
    return yield* Errors.InsufficientBalance.make({
      safe: held.spends.safe,
      asset: "USDC",
      balance: formatUnits(balance, USDC_DECIMALS),
      amount: formatUnits(amount, USDC_DECIMALS),
    });
  return yield* Effect.void;
});

/** The top budget the setup's transaction created for the company Safe, from its BudgetCreated log. */
const budgetOf = (landed: Landed, safe: string) => {
  const created = Arr.flatMap(landed.receipt.logs, (log) => {
    if (!sameAddress(log.address, SEEDED.budgets)) return [];
    const decoded = Option.liftThrowable(() =>
      decodeEventLog({ abi: BUDGETS, eventName: "BudgetCreated", topics: topicsOf(log.topics), data: hex(log.data) }),
    )();
    return Option.isSome(decoded) ? [decoded.value] : [];
  });
  return Option.getOrNull(
    Option.map(
      Arr.findFirst(created, (event) => sameAddress(event.args.safe, safe) && event.args.parent === 0n),
      (event) => event.args.id.toString(),
    ),
  );
};

const personOf = Effect.fn("approval.sign.person")(function* (name: string) {
  const cast = yield* Cast;
  return Option.getOrNull(yield* cast.find(name));
});

/** Records what the landing of `subject` made, inside the transaction that marks it sent. */
export const landed = Effect.fn("approval.sign.landed")(function* (subject: Subject, landing: Landed) {
  const sql = yield* PgClient.PgClient;
  if (subject.kind === "payment") {
    // The site posts the Payment Entry it holds for this hash, as the chain paid it (capxul/payments.py).
    const held = yield* subjectOf(subject.kind, subject.id);
    if (held.org === null || held.about === null) return yield* Effect.void;
    const now = yield* worldNow;
    return yield* deliver(held.org, "paid", {
      document_hash: held.about["documentHash"] ?? "",
      tx_hash: landing.receipt.transactionHash,
      amount: held.about["amount"] ?? "0",
      to: held.about["payee"] ?? "",
      block_time: instant(now.timestampMs),
    });
  }
  if (subject.kind === "org_setup") {
    const organization = yield* Store.byOrg(subject.id);
    if (Option.isNone(organization)) return yield* Effect.void;
    const org = organization.value;
    yield* Store.markReady(org.org, budgetOf(landing, org.safe));
    const [company] = yield* sql<{ readonly name: string }>`select name from app.companies where org = ${org.org}`;
    yield* deliver(org.org, "configure", { company_name: company?.name ?? org.handle, safe_address: org.safe });
    yield* deliver(org.org, "clock", {});
    for (const name of org.directors) {
      const member = yield* personOf(name);
      if (member !== null)
        yield* deliver(org.org, "grant", { email: member.email, name: title(name), hat: SITE_HATS.director });
    }
    const founder = yield* personOf(org.founder);
    const capital = yield* sql<{ readonly spends: { readonly amount: string } | null }>`
      select spends from app.subjects where kind = 'org_setup' and id = ${org.org}`;
    const amount = capital[0]?.spends?.amount ?? null;
    if (amount !== null && founder !== null) {
      const now = yield* worldNow;
      yield* deliver(org.org, "capital", {
        tx_hash: landing.receipt.transactionHash,
        amount: formatUnits(BigInt(amount), USDC_DECIMALS),
        block_time: instant(now.timestampMs),
        founder_email: founder.email,
        founder_name: title(founder.person),
        to: org.safe,
      });
    }
    return yield* Effect.void;
  }
  const change = yield* Store.changeOf(subject.id);
  if (Option.isNone(change)) return yield* Effect.void;
  yield* Store.markExecuted(subject.id);
  const member = yield* personOf(change.value.member);
  if (member !== null)
    yield* deliver(change.value.org, "grant", {
      email: member.email,
      name: title(member.person),
      hat: SITE_HATS[change.value.permission],
    });
  return yield* Effect.void;
});

/** The company a landed subject belongs to, whose site may now be moved on. */
export const orgOf = (subject: Subject) =>
  Effect.gen(function* () {
    if (subject.kind === "org_setup") return Option.some(subject.id);
    if (subject.kind === "officer_change") return Option.map(yield* Store.changeOf(subject.id), (change) => change.org);
    return Option.flatMapNullishOr(Option.some(yield* subjectOf(subject.kind, subject.id)), (held) => held.org);
  });
