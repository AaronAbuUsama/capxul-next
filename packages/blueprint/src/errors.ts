// Every refusal of the contract, gathered here from where each is declared once, and imported by the operations
// that refuse with it. A refusal is a typed error that needs the world's state to decide; a payload of the wrong
// shape never reaches a handler (its schema rejects it). Each refusal carries what a caller needs to act on it, and
// nothing secret. A domain's own refusals are in its folder (`src/<domain>/refusals.ts`); those several domains share
// are in errors/. Each such file declares its refusals with their exit codes; this file lists each file once.
import * as Approvals from "./approvals/refusals.ts";
import * as Documents from "./documents/refusals.ts";
import * as Caller from "./errors/caller.ts";
import * as Companies from "./errors/companies.ts";
import * as Server from "./errors/server.ts";
import { gather } from "./gather.ts";
import * as Budgets from "./budgets/refusals.ts";
import * as Organizations from "./organizations/refusals.ts";
import * as People from "./people/refusals.ts";
import * as Record from "./record/refusals.ts";
import * as World from "./world/refusals.ts";

export * from "./errors/caller.ts";
export * from "./errors/server.ts";
export * from "./errors/companies.ts";
export * from "./world/refusals.ts";
export * from "./organizations/refusals.ts";
export * from "./people/refusals.ts";
export * from "./budgets/refusals.ts";
export * from "./documents/refusals.ts";
export * from "./approvals/refusals.ts";
export * from "./record/refusals.ts";

/** Every file that declares refusals. */
const declaring = [
  Caller,
  Server,
  Companies,
  World,
  Organizations,
  People,
  Budgets,
  Documents,
  Approvals,
  Record,
] as const;

/**
 * Every refusal, by its tag. The tests read this to prove no tag is declared twice. All but `PayloadRejected` are a
 * door's; that one is the caller's own client's, made from the operation's schema before anything is sent.
 */
export const refusals = gather(declaring, "refusals");

export type RefusalTag = keyof typeof refusals;

/**
 * A command line's exit code for a refusal: 2 the request cannot be done as asked, 3 not signed in, 4 not allowed,
 * 5 something outside failed, 6 a limit or a switch (`NotImplemented` is one: the operation is not switched on yet).
 */
export type ExitCode = 2 | 3 | 4 | 5 | 6;

/** The command line's exit code for each refusal, declared beside the refusal so the CLI never invents one. */
export const exitCode: { readonly [Tag in RefusalTag]: ExitCode } = gather(declaring, "exitCode");
