// What the in-memory tests of the doors need now that some handlers are built: those operations, which no longer
// answer NotImplemented, and a Core with no database, chain, cast or bench, which only their handlers would reach.
import type { OperationName } from "@capxul/blueprint";
import * as Layer from "effect/Layer";
import * as PgClient from "@effect/sql-pg/PgClient";
import { ChainOps } from "../../src/organizations/handlers.ts";

/** The operations whose handlers are built: they answer for real, so they are left out of the NotImplemented checks. */
export const BUILT: ReadonlySet<OperationName> = new Set([
  "org.create",
  "org.member.grant",
  "approval.sign",
  "invitation.send",
  "invitation.list",
  "invitation.accept",
  "invitation.decline",
  "org.member.list",
  "org.director.list",
  "org.director.add",
  "org.threshold.set",
  "org.budget.create",
  "org.budget.show",
  "org.budget.list",
]);

/** No database: a test in memory never calls a built handler far enough to reach it. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a client that is never called; a built handler that reached it would die, which the tests do not do.
const noDatabase = Layer.succeed(PgClient.PgClient, {} as PgClient.PgClient);

export const absent = Layer.merge(ChainOps.absent, noDatabase);
