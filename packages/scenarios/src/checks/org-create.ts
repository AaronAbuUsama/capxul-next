// The checks of every org.create (claims.md, org.create 1 to 7): a founding answers the company as asked (its board
// with the founder first, its profile trimmed) and one approval per founding Director before anyone signs; its Safe
// is Companies House's company Safe for this founder; the same intent resumes it and records nothing; and every
// refusal names what was wrong and makes nothing.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Str from "effect/String";
import { Capxul } from "../client.ts";
import { expect } from "../expectation.ts";
import { isAddress, logsOf, usdc } from "../support/chain.ts";
import { present, same, sameAddress, sameAmount } from "../support/expect.ts";
import { castMember, company, ownCompanies, view, whereOf } from "../support/world.ts";
import { callerIn, callerOf, namesCaller, nothingRecorded, worldBefore, type Before } from "./common.ts";
import { check, checks, type Asked, type Check } from "./format.ts";
import { steady } from "../support/steady.ts";
import { logsSoFar } from "../support/scans.ts";

type Asking = Asked<"org.create">;

const trimmed = (text: string | null) => (text === null ? null : Str.trim(text));

/** Capital as its asset and quantity, however its amount is spelled. */
const capitalOf = (capital: { readonly asset: string; readonly amount: string } | null) =>
  capital === null ? null : [capital.asset, Number(capital.amount)];

/**
 * The journey's own companies (`ownCompanies`) now and before the call, with the handle it asked for: in a shared world
 * other journeys found companies at the same moment, and theirs are not this call's to judge.
 */
const ownNowAndBefore = (asked: Asking, before: Before) =>
  Effect.gen(function* () {
    const handles = [asked.payload.handle];
    return {
      now: yield* ownCompanies(yield* view(before.world.world), handles),
      before: yield* ownCompanies(before.world, handles),
    };
  });

/** Nothing is made: the record gains nothing and world.show lists the journey's companies it listed before. */
const nothingMade = (what: string, asked: Asking, before: Before): ReadonlyArray<Check> => [
  nothingRecorded(what, before),
  check(
    `${what} makes no company`,
    Effect.flatMap(ownNowAndBefore(asked, before), (companies) =>
      same("the companies after the refusal", companies.now, companies.before),
    ),
  ),
];

/** The company world.show lists under the handle asked. */
const listed = (asked: Asking, before: Before) => company(before.world, asked.payload.handle);

export const orgCreate = checks<"org.create", Before>({
  before: (asked) => worldBefore(asked.options),
  success: (asked, answer, before) => {
    const { payload } = asked;
    if (answer._tag === "Resumed")
      return [
        check(
          "it resumes the company world.show lists under the handle",
          Effect.flatMap(listed(asked, before), (found) =>
            same("the resumed company", [answer.org, answer.handle], [found.org, found.handle]),
          ),
        ),
        ...nothingMade("the resumed founding", asked, before),
      ];
    const founded = answer;
    const where = whereOf(asked.options);
    return [
      check(
        "the caller founds it, from their own personal Safe",
        Effect.gen(function* () {
          const founder = yield* callerIn(before, asked.options);
          yield* same("the founder", founded.founder, founder.person);
          yield* sameAddress("the founder's Safe", founded.founderSafe, founder.safe);
        }),
      ),
      check(
        "it is the company asked: its handle, its profile trimmed, its board with the founder first, members, capital",
        same(
          "the company",
          [founded.handle, founded.profile, founded.board, founded.members, capitalOf(founded.capital)],
          [
            payload.handle,
            {
              name: Str.trim(payload.profile.name),
              country: payload.profile.country,
              bio: trimmed(payload.profile.bio),
              size: trimmed(payload.profile.size),
            },
            { directors: [callerOf(asked.options), ...payload.directors], threshold: payload.threshold },
            payload.members,
            capitalOf(payload.capital),
          ],
        ),
      ),
      check(
        "it asks each founding Director, in the board's order, to sign at their own signer address",
        Effect.gen(function* () {
          yield* same(
            "the approvals' signers",
            Arr.map(founded.approvals, (each) => each.signer),
            founded.board.directors,
          );
          for (const approval of founded.approvals)
            yield* sameAddress(
              `${approval.signer}'s approval's address`,
              approval.signerAddress,
              (yield* castMember(before.world, approval.signer)).signer,
            );
        }),
      ),
      check(
        "its Safe is Companies House's company Safe for this founder",
        Effect.gen(function* () {
          const capxul = yield* Capxul;
          const contracts = before.world.contracts;
          // Companies House runs the minter's `mint` by delegatecall (CompanySafeMinter.sol refuses a plain call), so
          // the log is Companies House's own, not the minter's.
          const logs = yield* logsSoFar("CompanySafeMinted", contracts.companiesHouse, where);
          const minted = Arr.filter(logsOf(logs, "CompanySafeMinted"), (log) => isAddress(log.safe, founded.safe));
          yield* same(
            "the CompanySafeMinted logs naming the company Safe",
            Arr.map(minted, (log) => [Str.toLowerCase(log.founderSafe), log.company]),
            [[Str.toLowerCase(founded.founderSafe), founded.org]],
          );
          const derived = yield* steady(capxul.chain).companySafeFor(
            {
              minter: contracts.companySafeMinter,
              owner: contracts.companiesHouse,
              namespace: contracts.companyNamespace,
              company: founded.org,
              founderSafe: founded.founderSafe,
            },
            where,
          );
          yield* sameAddress("companySafeAddressFor the company and the founder's Safe", derived, founded.safe);
        }),
      ),
      check(
        "world.show lists it, once, beside the companies it listed before",
        Effect.flatMap(ownNowAndBefore(asked, before), (companies) =>
          same("the companies", companies.now, [
            ...companies.before,
            { org: founded.org, handle: founded.handle, name: founded.profile.name },
          ]),
        ),
      ),
    ];
  },
  refusals: {
    FounderNotReady: (asked, refused, before) => [
      namesCaller("FounderNotReady", refused.person, asked.options),
      check(
        "the founder has no claimed personal Safe",
        Effect.flatMap(callerIn(before, asked.options), (founder) =>
          same(`${founder.person}'s Safe`, founder.safe, null),
        ),
      ),
      ...nothingMade("the refused founding", asked, before),
    ],
    PersonNotFound: (asked, refused, before) => [
      check(
        "PersonNotFound names a person the founding names who is not of the world",
        Effect.gen(function* () {
          const named = [...asked.payload.directors, ...asked.payload.members];
          yield* expect(Arr.contains(named, refused.person), `${refused.person} is not named by the founding`);
          yield* expect(
            !Arr.some(before.world.cast, (each) => each.person === refused.person),
            `${refused.person} is a person of the world`,
          );
        }),
      ),
      ...nothingMade("the refused founding", asked, before),
    ],
    InsufficientBalance: (asked, refused, before) => [
      check(
        "InsufficientBalance names the founder's Safe, what it holds and the capital asked, which is more",
        Effect.gen(function* () {
          const founder = yield* callerIn(before, asked.options);
          const safe = yield* present(`${founder.person}'s Safe`, founder.safe);
          const capital = yield* present("the capital asked", asked.payload.capital);
          yield* sameAddress("InsufficientBalance's Safe", refused.safe, safe);
          yield* same("InsufficientBalance's asset", refused.asset, capital.asset);
          yield* sameAmount("InsufficientBalance's amount", refused.amount, capital.amount);
          yield* sameAmount(
            "InsufficientBalance's balance",
            refused.balance,
            yield* usdc(before.world, safe, whereOf(asked.options)),
          );
          yield* expect(Number(refused.amount) > Number(refused.balance), "the capital asked is not more than held");
        }),
      ),
      ...nothingMade("the refused founding", asked, before),
    ],
    SetupUnfinished: (asked, refused, before) => [
      check(
        "SetupUnfinished names another company of the world, by its org and handle",
        Effect.gen(function* () {
          const other = yield* company(before.world, refused.handle);
          yield* same("SetupUnfinished's org", refused.org, other.org);
          yield* expect(refused.handle !== asked.payload.handle, "SetupUnfinished names the handle asked");
        }),
      ),
      ...nothingMade("the refused founding", asked, before),
    ],
    FoundingChanged: (asked, refused, before) => [
      check(
        "FoundingChanged names the handle asked and the company under it",
        Effect.flatMap(listed(asked, before), (found) =>
          same("FoundingChanged", [refused.handle, refused.org], [asked.payload.handle, found.org]),
        ),
      ),
      ...nothingMade("the refused founding", asked, before),
    ],
    HandleTaken: (asked, refused, before) => [
      check(
        "HandleTaken names the handle asked, which a company holds",
        Effect.gen(function* () {
          yield* same("HandleTaken's handle", refused.handle, asked.payload.handle);
          yield* listed(asked, before);
        }),
      ),
      ...nothingMade("the refused founding", asked, before),
    ],
    PayloadRejected: (asked, _refused, before) => nothingMade("the rejected founding", asked, before),
  },
});
