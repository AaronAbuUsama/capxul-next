// What the landing of an organizations subject means beyond its transaction (src/approvals/landed.ts gathers it with
// every other domain's). A company's setup makes the company ready: its top budget is read from the transaction's
// logs, and its site is to be told the company, its Safe, each Director's hat and the founder's capital. An officer
// change is executed, and the member's hat is to be told to the site.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Str from "effect/String";
import * as PgClient from "@effect/sql-pg/PgClient";
import { decodeEventLog, formatUnits } from "viem";
import { Cast } from "../cast/Cast.ts";
import { BUDGETS } from "../chain/abi.ts";
import { hex, sameAddress } from "../chain/hex.ts";
import { SEEDED, USDC_DECIMALS } from "../chain/seeded.ts";
import type { Landed } from "../chain/userop.ts";
import { worldNow } from "../record/emit.ts";
import { instant } from "./caller.ts";
import { topicsOf } from "./found.ts";
import { deliver, SITE_HATS } from "./site.ts";
import * as Store from "./store.ts";

const title = (person: string) => Str.capitalize(person);

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

const setupLanded = (id: string, landing: Landed) =>
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;
    const organization = yield* Store.byOrg(id);
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
  });

const changeLanded = (id: string) =>
  Effect.gen(function* () {
    const change = yield* Store.changeOf(id);
    if (Option.isNone(change)) return yield* Effect.void;
    yield* Store.markExecuted(id);
    const member = yield* personOf(change.value.member);
    if (member !== null)
      yield* deliver(change.value.org, "grant", {
        email: member.email,
        name: title(member.person),
        hat: SITE_HATS[change.value.permission],
      });
    return yield* Effect.void;
  });

/** The landings of this domain's subjects (blueprint `src/organizations/subjects.ts`), by kind. */
export const landings = {
  org_setup: {
    landed: setupLanded,
    orgOf: (id: string) => Effect.succeedSome(id),
  },
  officer_change: {
    landed: changeLanded,
    orgOf: (id: string) =>
      Effect.map(
        Store.changeOf(id),
        Option.map((change) => change.org),
      ),
  },
};
