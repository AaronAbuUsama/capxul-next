/** An operation's page: the command, what it returns, its evals, its refusals, and where it stands. */
import { keyOf, type AnyRecord } from "@capxul/blueprint-engine";

import type { ArgRow, FrozenCommand, OperationPage, Refusal } from "../types.ts";
import { exampleViews } from "./examples.ts";
import { impactBlock } from "./impact.ts";
import {
  brief, conceptOf, decisionsOn, findingRows, head, isWaiting, linkGroups, membersOf, sourceOf, standOf, titleOf, type Ctx,
} from "./context.ts";
import { evalKind, inOrder } from "./evalKinds.ts";
import { evalRows, refOf } from "./locate.ts";
import { questionOf } from "./questions.ts";
import { jsonSchemaOf, variantsOf } from "./schema.ts";
import { typeScriptOf } from "./skeleton.ts";
import { traceOf } from "./trace.ts";
import { field, isObject, isRecord, list, objects, text } from "./values.ts";

/** `payment send <to> <amount> [memo] [flags]`: the old CLI's line, or the bare command for a new operation. */
const synopsisOf = (command: string, old: FrozenCommand | null): string => {
  if (!old) return command;
  const args = old.arguments.map((a) => {
    const name = a.variadic ? `${a.name}...` : a.name;
    return a.required ? `<${name}>` : `[${name}]`;
  });
  return [command, ...args, ...(old.flags.length > 0 ? ["[flags]"] : [])].join(" ");
};

const oldCliOf = (old: FrozenCommand): { readonly arguments: readonly ArgRow[]; readonly flags: readonly ArgRow[] } => ({
  arguments: old.arguments.map((a) => ({
    name: a.variadic ? `${a.name}...` : a.name, kind: `${a.type}, ${a.required ? "required" : "optional"}`, text: a.description,
  })),
  flags: old.flags.map((f) => ({
    name: [f.flag, ...(f.takesValue ? [`<${f.metavar ?? "value"}>`] : [])].join(" ") + (f.alias ? `, ${f.alias}` : ""),
    kind: [f.type, ...(f.required ? ["required"] : []), ...(f.repeatable ? ["repeatable"] : [])].join(", "),
    text: f.default === null ? f.description : `${f.description} (default ${f.default})`,
  })),
});

/** A refusal joined to its error record: the code, what the caller reads, and the exit code. */
const refusalsOf = (op: AnyRecord): readonly Refusal[] =>
  objects(op["refusals"]).flatMap((r) => {
    const error = r["error"];
    return isRecord(error) ? [{
      error: refOf(error), title: text(error["title"]), message: text(error["message"]), exit: text(error["exit"]),
      class: text(error["class"]), given: text(r["given"]), when: text(r["when"]),
    }] : [];
  });

const budgetOf = (op: AnyRecord): string => {
  const b = op["budget"];
  const cls = text(field(b, "class"));
  return cls === "" ? "" : `${cls}, p50 ${text(field(b, "p50Ms"))} ms, p95 ${text(field(b, "p95Ms"))} ms`;
};

/** The claims by their numbers in the blueprint. A retired line (null) keeps its number and is not listed. */
const acceptanceOf = (op: AnyRecord): OperationPage["acceptance"] =>
  list(op["acceptance"]).flatMap((line, i) =>
    isObject(line) ? [{ n: i + 1, claim: text(line["claim"]), observes: text(line["observes"]) }]
    : typeof line === "string" ? [{ n: i + 1, claim: text(line), observes: "" }] : []);

/**
 * The SDK call as TypeScript: the method the implementing record names, with its input and output schemas as types.
 * A record that names no method (an rpc) says so; nothing here is a recorded value.
 */
const sdkCallOf = (impl: AnyRecord | null): string => {
  if (!impl) return "";
  const sdk = text(impl["sdk"]);
  return [
    sdk === ""
      ? `// The blueprint names no SDK method for this operation: ${impl._kind} ${impl.id} implements it directly.`
      : `// Generated from ${impl._kind} ${impl.id}. The types are the blueprint's schemas; no value here is recorded.`,
    `type Input = ${typeScriptOf(jsonSchemaOf(impl["input"]))};`, "",
    `type Output = ${typeScriptOf(jsonSchemaOf(impl["output"]))};`, "",
    ...(sdk === "" ? [`// ${impl.id} takes Input and answers Output.`] : ["declare const input: Input;", `const output: Output = await ${sdk}(input);`]),
  ].join("\n");
};

export const operation = (ctx: Ctx, op: AnyRecord): OperationPage => {
  const key = keyOf(op);
  const impl = isRecord(op["implementedBy"]) ? op["implementedBy"] : null;
  const command = text(op["command"]) || op.id;
  const known = ctx.input.frozen.get(op.id);
  const old = known?.inCli ? known : null;
  const home = conceptOf(ctx, op);
  const affecting = decisionsOn(ctx, [key, ...(impl ? [keyOf(impl)] : [])]);
  const inConcept = home ? membersOf(ctx, home.id, "decision") : [];
  const sdk = impl ? impl["sdk"] : undefined;
  const evals = evalRows(ctx.evals.get(key) ?? [], op.id, new Set(), ctx.input.status);
  return {
    ...head(`operation/${op.id}`, titleOf(op), sourceOf(ctx, op), op), type: "operation",
    impact: impactBlock(ctx, key), examples: exampleViews(op),
    passing: { own: ctx.stands.get(key)?.own ?? { passing: 0, total: 0 }, under: ctx.stands.get(key)?.under ?? { passing: 0, total: 0 } },
    concept: home ? refOf(home) : null, command, about: text(op["about"]), priority: text(op["priority"]),
    isNew: !ctx.input.frozenOperations.has(op.id), synopsis: synopsisOf(command, old), oldCli: old ? oldCliOf(old) : null,
    returns: variantsOf(op["returns"]), who: text(op["who"]), changes: text(op["changes"]),
    notes: list(op["notes"]).map(text).filter(Boolean),
    mistakes: objects(op["mistakes"]).map((m) => ({ what: text(m["what"]), fix: text(m["fix"]) })),
    acceptance: acceptanceOf(op), evals, evalKinds: inOrder(evals.map((e) => e.kind)).map(evalKind),
    refusals: refusalsOf(op), stand: standOf(ctx, op),
    implementedBy: impl ? brief(impl) : null, implementedKind: impl ? impl._kind : "",
    sdk: isRecord(sdk) ? sdk.id : text(sdk), sdkCall: sdkCallOf(impl), trace: traceOf(ctx, impl, op),
    budget: budgetOf(op),
    waiting: affecting.filter((d) => isWaiting(ctx, d)).map((d) => ({ ref: questionOf(ctx, d).ref, text: text(d["title"]) })),
    decisions: affecting.filter((d) => !isWaiting(ctx, d)).map(brief),
    settledInConcept: inConcept.filter((d) => !isWaiting(ctx, d)).length,
    gaps: findingRows(ctx.gaps.get(key)),
    usedBy: linkGroups(ctx, (ctx.input.blueprint.linkedBy.get(key) ?? []).filter((l) => l.field !== "affects"), "from"),
  };
};
