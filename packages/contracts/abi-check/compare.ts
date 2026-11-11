// The comparison of the blueprint's contract records with the contracts in the code. Pure: the caller reads the blueprint, the ABI
// export and the manifest and passes them in, so every rule here is tested with small fixtures.
//
// A difference is a fact that the two disagree. It fails the check unless an allowance covers it: an allowance names a
// subject and a decision, and counts only when that decision is in the blueprint and its text names the subject. An allowance that
// covers nothing fails too, so none outlives the difference it was written for.

import { parseSignature, renderBlueprint, renderEntry, signatureMismatches, type AbiEntry } from "./signature.ts";

export type CodeStatus = "built" | "designed" | "third-party";

export interface BlueprintContract {
  readonly id: string;
  /** `built`: in the code, compared. `designed`: designed, not built. `third-party`: someone else's code, not compared. */
  readonly code?: CodeStatus;
  /** The Solidity contract this record describes (for `built`). */
  readonly artifact?: string;
  readonly functions: Readonly<Record<string, { signature: string }>>;
  readonly events: Readonly<Record<string, { signature: string }>>;
  readonly errors?: Readonly<Record<string, { signature: string }>>;
}
export interface CodeContract {
  readonly name: string;
  readonly kind: "contract" | "library";
  readonly abi: readonly AbiEntry[];
}
/** A difference that may stand because a decision names it. `subject` is `blueprint:<id>`, `code:<Artifact>` or `blueprint:<id>.<function|event|error>.<name>`. */
export interface Allowance {
  readonly subject: string;
  readonly decision: string;
}
export interface Input {
  readonly blueprint: readonly BlueprintContract[];
  readonly code: readonly CodeContract[];
  /** The contracts the deployment puts on chain: the deploy manifest's, plus those a deployed contract creates. */
  readonly deployed: readonly string[];
  readonly allowances: readonly Allowance[];
  /** Decision id → the text that names things (title, question, options, why, and the ids of what it affects). */
  readonly decisions: Readonly<Record<string, string>>;
}

export type DiffKind =
  | "contract-without-code"
  | "code-without-book"
  | "unknown-artifact"
  | "undeclared-code"
  | "not-deployed"
  | "missing-in-book"
  | "missing-in-code"
  | "differs"
  | "bad-signature";
export interface Difference {
  readonly kind: DiffKind;
  /** `blueprint:<id>`, `code:<Artifact>` or `blueprint:<id>.<function|event|error>.<name>`: what an allowance names. */
  readonly subject: string;
  readonly message: string;
}
export interface Allowed extends Difference {
  readonly decision: string;
}
export interface Report {
  readonly compared: { contracts: number; functions: number; events: number; errors: number };
  readonly thirdParty: readonly string[];
  readonly failures: readonly Difference[];
  readonly allowed: readonly Allowed[];
}

const MEMBERS = [
  ["function", "functions"],
  ["event", "events"],
  ["error", "errors"],
] as const;

const blueprintSig = (s: string): { ok: true; sig: ReturnType<typeof parseSignature> } | { ok: false; why: string } => {
  try {
    return { ok: true, sig: parseSignature(s) };
  } catch (e) {
    return { ok: false, why: (e as Error).message };
  }
};

const compareOne = (blueprint: BlueprintContract, code: CodeContract, out: Difference[], counts: Report["compared"]): void => {
  for (const [type, field] of MEMBERS) {
    const codeEntries = code.abi.filter((e) => e.type === type);
    const blueprintEntries = Object.entries(blueprint[field] ?? {});
    const subject = (name: string) => `blueprint:${blueprint.id}.${type}.${name}`;
    counts[field] += codeEntries.length;
    const byName = new Map<string, AbiEntry[]>();
    for (const e of codeEntries) byName.set(e.name!, [...(byName.get(e.name!) ?? []), e]);
    const seen = new Set<string>();
    for (const [key, { signature }] of blueprintEntries) {
      const parsed = blueprintSig(signature);
      if (!parsed.ok) {
        out.push({ kind: "bad-signature", subject: subject(key), message: `${blueprint.id}: ${type} ${key}: cannot read "${signature}": ${parsed.why}` });
        continue;
      }
      const candidates = byName.get(parsed.sig.name) ?? [];
      if (candidates.length === 0) {
        out.push({
          kind: "missing-in-code",
          subject: subject(parsed.sig.name),
          message: `${blueprint.id}: the blueprint has ${type} ${renderBlueprint(parsed.sig)}; ${code.name} has none by that name`,
        });
        continue;
      }
      // An overload is matched to the candidate that differs least; two blueprint entries may name two overloads.
      const scored = candidates.map((c) => ({ c, why: signatureMismatches(parsed.sig, c) })).sort((a, b) => a.why.length - b.why.length);
      const best = scored[0]!;
      seen.add(`${parsed.sig.name}|${candidates.indexOf(best.c)}`);
      if (best.why.length > 0)
        out.push({
          kind: "differs",
          subject: subject(parsed.sig.name),
          message: `${blueprint.id}: ${type} ${parsed.sig.name} differs: ${best.why.join("; ")}\n      blueprint: ${renderBlueprint(parsed.sig)}\n      code: ${renderEntry(best.c)}`,
        });
    }
    for (const [name, entries] of byName)
      entries.forEach((e, i) => {
        if (!seen.has(`${name}|${i}`))
          out.push({ kind: "missing-in-book", subject: subject(name), message: `${blueprint.id}: the code's ${type} ${renderEntry(e)} is not in the blueprint` });
      });
  }
};

/** Whether a decision's text names a subject: the contract's record id or Solidity name, or the member's name. */
const names = (subject: string, text: string): boolean => {
  const tail = subject.slice(subject.indexOf(":") + 1);
  const parts = tail.split(".");
  const last = parts[parts.length - 1]!;
  return text.includes(parts[0]!) && (parts.length === 1 || text.includes(last));
};

export const compareContracts = (input: Input): Report => {
  const diffs: Difference[] = [];
  const counts = { contracts: 0, functions: 0, events: 0, errors: 0 };
  const thirdParty: string[] = [];
  const codeByName = new Map(input.code.map((c) => [c.name, c]));
  const claimed = new Set<string>();

  for (const b of input.blueprint) {
    if (b.code === undefined) {
      diffs.push({ kind: "undeclared-code", subject: `blueprint:${b.id}`, message: `${b.id}: the record does not say whether its code is built, designed or third-party (\`code\`)` });
      continue;
    }
    if (b.code === "third-party") {
      thirdParty.push(b.id);
      continue;
    }
    if (b.code === "designed") {
      diffs.push({ kind: "contract-without-code", subject: `blueprint:${b.id}`, message: `${b.id}: designed, not built: the code has no such contract` });
      continue;
    }
    const code = b.artifact === undefined ? undefined : codeByName.get(b.artifact);
    if (!code) {
      diffs.push({ kind: "unknown-artifact", subject: `blueprint:${b.id}`, message: `${b.id}: says it is built as ${b.artifact ?? "(no artifact named)"}, which the code does not have` });
      continue;
    }
    claimed.add(code.name);
    counts.contracts++;
    compareOne(b, code, diffs, counts);
  }

  for (const name of input.deployed) {
    const code = codeByName.get(name);
    if (!code) diffs.push({ kind: "unknown-artifact", subject: `code:${name}`, message: `${name}: the deployment names it, but the code export has no such contract` });
    else if (!claimed.has(name)) diffs.push({ kind: "code-without-book", subject: `code:${name}`, message: `${name}: deployed by the code, and no contract record in the blueprint describes it` });
  }

  for (const c of input.code)
    if (c.kind === "contract" && !input.deployed.includes(c.name))
      diffs.push({ kind: "not-deployed", subject: `code:${c.name}`, message: `${c.name}: a contract with code that neither the deploy manifest nor the created-by list accounts for` });

  const failures: Difference[] = [];
  const allowed: Allowed[] = [];
  const used = new Set<Allowance>();
  for (const d of diffs) {
    const cover = input.allowances.find((a) => {
      const covers = a.subject === d.subject || d.subject.startsWith(`${a.subject}.`);
      return covers && names(a.subject, input.decisions[a.decision] ?? "");
    });
    if (cover) {
      used.add(cover);
      allowed.push({ ...d, decision: cover.decision });
    } else failures.push(d);
  }
  for (const a of input.allowances) {
    if (input.decisions[a.decision] === undefined)
      failures.push({ kind: "differs", subject: a.subject, message: `allowance for ${a.subject}: decision ${a.decision} is not in the blueprint` });
    else if (!names(a.subject, input.decisions[a.decision]!))
      failures.push({ kind: "differs", subject: a.subject, message: `allowance for ${a.subject}: decision ${a.decision} does not name it` });
    else if (!used.has(a))
      failures.push({ kind: "differs", subject: a.subject, message: `allowance for ${a.subject} (${a.decision}) covers no difference: remove it` });
  }
  return { compared: counts, thirdParty, failures, allowed };
};
