// What org.director.add and org.threshold.set share: the company and who may change its Board, the change that may
// be waiting, the Board as the chain holds it, and the proposal itself. A change to the Board is never a Board
// proposal: it is one UserOperation of the founder's own Safe, the wearer of the Shareholders' top hat, prepared now
// with one approval, the founder's, whose digest is the Safe4337Module's operation hash; approval.sign sends it at
// that first signature (blueprint `src/board/order.md`).
import { type Board as Ops, Errors } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as PgClient from "@effect/sql-pg/PgClient";
import type { Hex } from "viem";
import { open } from "../approvals/store.ts";
import { Cast } from "../cast/Cast.ts";
import { APPROVAL_LIFETIME_MS } from "../chain/seeded.ts";
import { nonceKeyOf, prepare } from "../chain/userop.ts";
import { caller, instant } from "../organizations/caller.ts";
import { newId } from "../organizations/ids.ts";
import * as Organizations from "../organizations/store.ts";
import { emitDeclared, worldNow } from "../record/emit.ts";
import { ownersOf } from "./calls.ts";
import * as Store from "./store.ts";

type Proposed = typeof Ops.directorAdd.rpc.successSchema.Type;

/** The company, once its setup has landed: before that it has no Board on the chain. Otherwise OrgNotFound. */
export const companyOf = Effect.fn("board.company")(function* (org: string) {
  const found = yield* Organizations.byOrg(org);
  if (Option.isNone(found) || found.value.setup !== "ready") return yield* Errors.OrgNotFound.make({ org });
  return found.value;
});

/**
 * Only the wearer of the Shareholders' top hat changes the Board: the founder's personal Safe, until shares are
 * issued (InstallerMoney `_shareholdersTree`). Anyone else, Directors and the world's owner included, is refused.
 */
export const founderOnly = Effect.fn("board.founder")(function* (organization: Organizations.Organization) {
  const who = yield* caller;
  if (!who.person || who.name !== organization.founder)
    return yield* Errors.CannotChangeBoard.make({ org: organization.org, person: who.name });
  return yield* Effect.void;
});

/** Refuses while another change to the company's Board waits for its founder's signature. */
export const nothingWaiting = Effect.fn("board.waiting")(function* (org: string) {
  const now = yield* worldNow;
  const waiting = yield* Store.waitingOf(org, now.timestampMs);
  if (Option.isSome(waiting)) return yield* Errors.BoardChangeWaiting.make({ org, change: waiting.value });
  return yield* Effect.void;
});

/**
 * The Board as the company Safe holds it now. Core's own Board (`app.organizations`) is updated in the transaction
 * that lands each change, so the two never differ; if they do, something outside Core changed the Board, and nothing
 * is proposed on top of it.
 */
export const boardNow = Effect.fn("board.now")(function* (organization: Organizations.Organization) {
  const held = yield* ownersOf(organization.safe);
  const board = { directors: held.owners.length, threshold: held.threshold };
  if (board.directors !== organization.directors.length || board.threshold !== organization.threshold)
    return yield* Effect.die(
      `the company Safe of ${organization.org} has ${board.directors} owners at ${board.threshold}; Core's Board is ` +
        `${organization.directors.length} Directors at ${organization.threshold}`,
    );
  return board;
});

/** A change to the Board, checked, as it is to be proposed. */
export interface Proposal {
  readonly operation: "org.director.add" | "org.threshold.set";
  readonly payload: unknown;
  readonly organization: Organizations.Organization;
  readonly action: "add" | "threshold";
  readonly person: string | null;
  readonly before: Store.Seats;
  readonly after: Store.Seats;
  /** The founder's Safe's one call (0) or DELEGATECALL (1), and the gas it may use. */
  readonly call: { readonly to: string; readonly data: Hex; readonly operation: 0 | 1; readonly gas: bigint };
}

/** Prepares the founder's UserOperation, opens its one approval and keeps the change, recording it. */
export const propose = Effect.fn("board.propose")(function* (proposal: Proposal) {
  const sql = yield* PgClient.PgClient;
  const cast = yield* Cast;
  const { organization } = proposal;
  const listed = yield* cast.find(organization.founder);
  if (Option.isNone(listed))
    return yield* Effect.die(`the founder ${organization.founder} of ${organization.org} is not in the cast`);
  const founder = listed.value;
  const change = yield* newId("bch");
  const operation = yield* prepare({
    sender: organization.founderSafe,
    to: proposal.call.to,
    data: proposal.call.data,
    operation: proposal.call.operation,
    nonceKey: nonceKeyOf(`board_change:${change}`),
    callGas: proposal.call.gas,
  });
  const now = yield* worldNow;
  const expiresMs = now.timestampMs + APPROVAL_LIFETIME_MS;
  const approval = {
    id: yield* newId("apr"),
    signer: founder.person,
    signerAddress: founder.signer,
    digest: operation.digest,
    expiresAt: instant(expiresMs),
  };
  const answer: Proposed = {
    change: {
      id: change,
      action: proposal.action,
      person: proposal.person,
      before: proposal.before,
      after: proposal.after,
      state: "proposed",
    },
    approval,
  };
  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* Store.insert({
        change,
        org: organization.org,
        action: proposal.action,
        person: proposal.person,
        before: proposal.before,
        after: proposal.after,
        expiresMs,
      });
      yield* open({
        subject: { kind: "board_change", id: change },
        org: organization.org,
        threshold: 1,
        needs: founder.person,
        landing: { via: "operation", operation },
        spends: null,
        about: null,
        approvals: [{ ...approval, signerSafe: organization.founderSafe }],
      });
      yield* emitDeclared(proposal.operation, proposal.payload, answer);
    }),
  );
  return answer;
});
