// org.create: a company founded in one step (decisions.md, 26). Everything is checked before the first write. Then
// the company Safe is minted through Companies House's company role for the founder's Safe, under the Organization's
// id (decisions.md, 34), and the Installer deploys its authority: the Board's hats with one officer hat per
// permission, the Director hat on every founding Director's Safe, the Signer Gate and Roles. The setup that completes
// it is prepared as one UserOperation of the founder's Safe: the founder's capital to the company Safe, then the
// company Safe's install batch (the Gate as module and guard, every founding Director's Safe a signer at the board's
// threshold, Budgets with a top budget for the Books hat). Every founding Director gets an approval of its digest;
// approval.sign sends it once the threshold is signed, the founder's among them. The company's site is started on
// the world's bench.
import { Errors, Organizations as Ops, Values } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as PgClient from "@effect/sql-pg/PgClient";
import { decodeEventLog, encodeFunctionData, formatUnits, type Hex, keccak256, parseUnits, stringToHex, padHex } from "viem";
import { open } from "../approvals/store.ts";
import { Cast, type CastMember } from "../cast/Cast.ts";
import { ERC20, INSTALLER, MINTER, ROLES } from "../chain/abi.ts";
import { head, readContract, sendAsService, usdcOf } from "../chain/calls.ts";
import { approvedBySender, execTransaction, multiSend } from "../chain/safe.ts";
import { APPROVAL_LIFETIME_MS, SEEDED, TIER, USDC_DECIMALS } from "../chain/seeded.ts";
import { nonceKeyOf, prepare } from "../chain/userop.ts";
import { emitDeclared } from "../record/emit.ts";
import { callerPerson, instant } from "./caller.ts";
import { newId } from "./ids.ts";
import { startSite } from "./site.ts";
import * as Store from "./store.ts";

type Founding = typeof Ops.create.rpc.payloadSchema.Type;

const PERMISSIONS = Values.Permission.literals;
const hex = (text: string): Hex => (text.startsWith("0x") ? (text as Hex) : "0x");
/** A log's topics as viem decodes them: the event's selector first. */
export const topicsOf = (topics: ReadonlyArray<string>): [Hex, ...Array<Hex>] => [hex(topics[0] ?? "0x"), ...Arr.map(Arr.drop(topics, 1), hex)];
const roleKey = (name: string) => padHex(stringToHex(name), { dir: "right", size: 32 });
/** The top budget's amount and the payout role's ceiling: 1,000,000 USDC a month. */
const TOP_BUDGET = 1_000_000n * 10n ** BigInt(USDC_DECIMALS);
const encodeFounding = Schema.encodeEffect(Schema.toCodecJson(Ops.create.rpc.payloadSchema));

/** The cast member a founding names, or PersonNotFound. */
const person = (name: string) =>
  Effect.gen(function* () {
    const cast = yield* Cast;
    return yield* Effect.fromOption(yield* cast.find(name)).pipe(
      Effect.mapError(() => Errors.PersonNotFound.make({ person: name })),
    );
  });

/** A founding Director needs a claimed Safe to wear the Director hat, as the founder does (decisions.md, 47). */
const withSafe = (member: CastMember) =>
  member.safe === null ? Effect.fail(Errors.FounderNotReady.make({ person: member.person })) : Effect.succeed(member.safe);

/** The checks, in the order the claims read them; nothing is written before they all hold. */
const check = Effect.fn("org.create.check")(function* (founding: Founding) {
  const founderName = yield* callerPerson;
  const founder = yield* person(founderName);
  const founderSafe = yield* withSafe(founder);
  const encoded = yield* encodeFounding(founding).pipe(Effect.orDie);
  const held = yield* Store.byHandle(founding.handle);
  if (Option.isSome(held)) {
    if (held.value.founder !== founderName) return yield* Errors.HandleTaken.make({ handle: founding.handle });
    if (!Equal.equals(held.value.founding, encoded))
      return yield* Errors.FoundingChanged.make({ handle: founding.handle, org: held.value.org });
    return { _tag: "resume" as const, organization: held.value };
  }
  const directors = Arr.dedupe([founderName, ...founding.directors]);
  const coDirectors = yield* Effect.forEach(Arr.drop(directors, 1), (name) =>
    Effect.flatMap(person(name), (member) => Effect.map(withSafe(member), (safe) => ({ member, safe }))),
  );
  yield* Effect.forEach(founding.members, person);
  const unfinished = yield* Store.unfinishedOf(founderName);
  if (Option.isSome(unfinished))
    return yield* Errors.SetupUnfinished.make({ org: unfinished.value.org, handle: unfinished.value.handle });
  const capital = founding.capital === null ? 0n : parseUnits(founding.capital.amount, USDC_DECIMALS);
  const balance = yield* usdcOf(founderSafe);
  if (capital > balance)
    return yield* Errors.InsufficientBalance.make({
      safe: founderSafe,
      asset: "USDC",
      balance: formatUnits(balance, USDC_DECIMALS),
      amount: founding.capital?.amount ?? "0",
    });
  return { _tag: "found" as const, founder, founderSafe, directors, coDirectors, capital, encoded };
});

/** Mints the company Safe and deploys its authority: two transactions of the service key. */
const deploy = Effect.fn("org.create.deploy")(function* (org: string, founderSafe: string, coDirectors: ReadonlyArray<string>, threshold: number) {
  const mint = encodeFunctionData({ abi: MINTER, functionName: "mint", args: [TIER.companyNamespace, org, hex(founderSafe)] });
  yield* sendAsService(
    SEEDED.companiesHouseRoles,
    encodeFunctionData({
      abi: ROLES,
      functionName: "execTransactionWithRole",
      args: [SEEDED.companySafeMinter, 0n, mint, 1, roleKey(TIER.companyRole), true],
    }),
  );
  const safe = yield* readContract({
    address: SEEDED.companySafeMinter,
    abi: MINTER,
    functionName: "companySafeAddressFor",
    args: [SEEDED.companiesHouse, TIER.companyNamespace, org, hex(founderSafe)],
  });
  const plan = {
    safe,
    founderSafe: hex(founderSafe),
    coDirectors: Arr.map(coDirectors, hex),
    threshold: { thresholdType: 0, min: BigInt(threshold), target: BigInt(threshold) },
    officers: Arr.map(PERMISSIONS, (permission) => ({ details: Values.OFFICER_HAT_DETAILS[permission], maxSupply: 1 })),
    salt: keccak256(stringToHex(org)),
  };
  const deployed = yield* sendAsService(SEEDED.installer, encodeFunctionData({ abi: INSTALLER, functionName: "deployMoney", args: [plan] }));
  const log = yield* Effect.fromOption(
    Arr.findFirst(deployed.logs, (each) => each.address.toLowerCase() === SEEDED.installer.toLowerCase()),
  ).pipe(Effect.orDie);
  const made = yield* Effect.try(() =>
    decodeEventLog({ abi: INSTALLER, eventName: "MoneyDeployed", topics: topicsOf(log.topics), data: hex(log.data) }),
  ).pipe(Effect.orDie);
  return { safe, deployment: made.args.deployment };
});

/** Founds the company, or resumes the same founding. */
export const orgCreate = Effect.fn("org.create.found")(function* (founding: Founding) {
  const checked = yield* check(founding);
  if (checked._tag === "resume") return yield* resumed(checked.organization);
  const sql = yield* PgClient.PgClient;
  const org = yield* newId("org");
  const coSafes = Arr.map(checked.coDirectors, (each) => each.safe);
  const { safe, deployment } = yield* deploy(org, checked.founderSafe, coSafes, founding.threshold);
  const books = deployment.officerHats[0] ?? 0n;
  const install = yield* readContract({
    address: SEEDED.installer,
    abi: INSTALLER,
    functionName: "buildMoney",
    args: [
      {
        safe,
        founderSafe: hex(checked.founderSafe),
        coDirectors: Arr.map(coSafes, hex),
        deployment,
        tokens: [{ token: SEEDED.usdc, ceiling: TOP_BUDGET, budgetPeriod: 0, topAmount: TOP_BUDGET, topHat: books }],
      },
    ],
  });
  const installTx = { safe, to: SEEDED.multiSendCallOnly, data: multiSend(install), operation: 1 as const, nonce: 0n };
  const capitalCall =
    checked.capital > 0n
      ? [{ to: SEEDED.usdc, data: encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [safe, checked.capital] }) }]
      : [];
  const operation = yield* prepare({
    sender: checked.founderSafe,
    to: SEEDED.multiSendCallOnly,
    data: multiSend([...capitalCall, { to: safe, data: execTransaction(installTx, approvedBySender(checked.founderSafe)) }]),
    operation: 1,
    nonceKey: nonceKeyOf(`org_setup:${org}`),
    callGas: 6_000_000n,
  });
  const now = yield* head;
  const expiresAt = instant(now.timestampMs + APPROVAL_LIFETIME_MS);
  const signers = [checked.founder, ...Arr.map(checked.coDirectors, (each) => each.member)];
  const approvals = yield* Effect.forEach(signers, (member) =>
    Effect.map(newId("apr"), (id) => ({
      id,
      signer: member.person,
      signerAddress: member.signer,
      digest: operation.digest,
      expiresAt,
      signerSafe: member.safe,
    })),
  );
  const answer = Ops.Founded.make({
    org,
    handle: founding.handle,
    profile: founding.profile,
    safe,
    founder: checked.founder.person,
    founderSafe: checked.founderSafe,
    board: { directors: checked.directors, threshold: founding.threshold },
    members: founding.members,
    capital: founding.capital,
    approvals: Arr.map(approvals, ({ signerSafe: _, ...approval }) => approval),
  });
  const foundedMs = yield* Clock.currentTimeMillis;
  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* Store.insert({
        org,
        handle: founding.handle,
        name: founding.profile.name,
        founder: checked.founder.person,
        founderSafe: checked.founderSafe,
        safe,
        founding: checked.encoded,
        directors: checked.directors,
        threshold: founding.threshold,
        members: founding.members,
        setup: "awaiting_signatures",
        deployment: {
          boardTopHat: deployment.boardTopHat.toString(),
          directorHat: deployment.directorHat.toString(),
          officerHats: {
            "manage-books": (deployment.officerHats[0] ?? 0n).toString(),
            "issue-invoices": (deployment.officerHats[1] ?? 0n).toString(),
            "manage-people": (deployment.officerHats[2] ?? 0n).toString(),
          },
          gate: deployment.gate,
          roles: deployment.roles,
        },
        budget: null,
        site: null,
        foundedMs,
      });
      yield* open({
        subject: { kind: "org_setup", id: org },
        org,
        threshold: founding.threshold,
        needs: checked.founder.person,
        landing: { via: "operation", operation },
        spends: checked.capital > 0n ? { safe: checked.founderSafe, amount: checked.capital } : null,
        about: null,
        approvals,
      });
      yield* emitDeclared("org.create", founding, answer);
    }),
  );
  yield* startSite(org, founding.handle, founding.profile.name);
  return answer;
});

/** The same founding again: the company as it stands, and the approvals not yet signed. */
const resumed = Effect.fn("org.create.resume")(function* (organization: Store.Organization) {
  const sql = yield* PgClient.PgClient;
  const unsigned = yield* sql<{
    readonly approval: string;
    readonly signer: string;
    readonly signer_address: string;
    readonly digest: string;
    readonly expires_at: string;
  }>`select approval, signer, signer_address, digest, expires_at from app.approvals
     where subject_kind = 'org_setup' and subject_id = ${organization.org} and signature is null
       and not exists (select 1 from app.subjects s where s.kind = 'org_setup' and s.id = ${organization.org} and s.state = 'sent')
     order by position`;
  return Ops.Resumed.make({
    org: organization.org,
    handle: organization.handle,
    setup: organization.setup,
    approvals: Arr.map(unsigned, (row) => ({
      id: row.approval,
      signer: row.signer,
      signerAddress: row.signer_address,
      digest: row.digest,
      expiresAt: row.expires_at,
    })),
  });
});
