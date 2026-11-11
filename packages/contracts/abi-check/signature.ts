// A blueprint signature, read, and compared with the ABI entry the compiler made. Pure: no files, no blueprint.
//
//   blueprint:  "execute(uint256 scheduledId) returns (bytes32 paymentId)"      "Spent(address indexed safe, uint256 amount)"
//   code:  { type: "function", name: "execute", inputs: [...], outputs: [...], stateMutability: "nonpayable" }
//
// What is compared: the name, each argument's type in order, the return types in order, the mutability (a signature that
// says nothing is nonpayable), and an event's indexed flags. Argument names are not compared: they are the blueprint's words. A
// struct is compared by name (`Budget`) and an enum by name or as its `uint8`; a tuple written out in the blueprint is compared
// field by field with the ABI's components. An address typed as a contract in the code (`IPayments`) is an `address`.

export interface AbiParam {
  readonly type: string;
  readonly name?: string;
  readonly internalType?: string;
  readonly indexed?: boolean;
  readonly components?: readonly AbiParam[];
}
export interface AbiEntry {
  readonly type: string;
  readonly name?: string;
  readonly inputs?: readonly AbiParam[];
  readonly outputs?: readonly AbiParam[];
  readonly stateMutability?: string;
}

/** One type as the blueprint writes it: a name (`uint8`, `Budget`) or a tuple of types, then array suffixes (`[]`, `[3]`). */
export interface BlueprintType {
  readonly base: string;
  readonly tuple?: readonly BlueprintParam[];
  readonly arrays: string;
}
export interface BlueprintParam {
  readonly type: BlueprintType;
  readonly indexed: boolean;
  readonly name?: string;
}
export interface BlueprintSignature {
  readonly name: string;
  readonly params: readonly BlueprintParam[];
  readonly mutability: string;
  readonly returns: readonly BlueprintParam[];
}

const splitTop = (s: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim() !== "") out.push(cur.trim());
  return out;
};

/** The index of the `)` that closes the `(` at `open`. */
const closing = (s: string, open: number): number => {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    if (s[i] === ")" && --depth === 0) return i;
  }
  throw new Error(`unbalanced parentheses in "${s}"`);
};

const parseParam = (raw: string): BlueprintParam => {
  let rest = raw.trim();
  let base: string;
  let tuple: BlueprintParam[] | undefined;
  if (rest.startsWith("(")) {
    const end = closing(rest, 0);
    tuple = splitTop(rest.slice(1, end)).map(parseParam);
    base = "tuple";
    rest = rest.slice(end + 1);
  } else {
    const m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(rest);
    if (!m) throw new Error(`cannot read a type in "${raw}"`);
    base = m[0];
    rest = rest.slice(m[0].length);
  }
  const arrays = /^(\[\d*\])*/.exec(rest)![0];
  const words = rest.slice(arrays.length).trim().split(/\s+/).filter(Boolean);
  const indexed = words.includes("indexed");
  const name = words.filter((w) => w !== "indexed" && w !== "memory" && w !== "calldata")[0];
  return { type: { base, ...(tuple ? { tuple } : {}), arrays }, indexed, ...(name ? { name } : {}) };
};

export const parseSignature = (signature: string): BlueprintSignature => {
  const open = signature.indexOf("(");
  if (open < 1) throw new Error(`no argument list in "${signature}"`);
  const name = signature.slice(0, open).trim();
  const end = closing(signature, open);
  const params = splitTop(signature.slice(open + 1, end)).map(parseParam);
  let tail = signature.slice(end + 1).trim();
  let returns: BlueprintParam[] = [];
  const r = tail.indexOf("returns");
  if (r >= 0) {
    const ro = tail.indexOf("(", r);
    returns = splitTop(tail.slice(ro + 1, closing(tail, ro))).map(parseParam);
    tail = tail.slice(0, r).trim();
  }
  const words = tail.split(/\s+/).filter(Boolean);
  const mutability = words.find((w) => ["view", "pure", "payable"].includes(w)) ?? "nonpayable";
  return { name, params, mutability, returns };
};

// ── the code's side ──────────────────────────────────────────────────────────────────────────

const arraysOf = (type: string): string => /(\[\d*\])*$/.exec(type)![0];
const internalName = (p: AbiParam): { kind: "struct" | "enum" | "contract" | "plain"; name: string } => {
  const m = /^(struct|enum|contract)\s+(?:[A-Za-z0-9_]+\.)?([A-Za-z0-9_]+)/.exec(p.internalType ?? "");
  return m ? { kind: m[1] as "struct" | "enum" | "contract", name: m[2]! } : { kind: "plain", name: "" };
};

/** Why a blueprint type is not the ABI parameter's, or undefined when they are the same. */
export const typeMismatch = (b: BlueprintType, c: AbiParam): string | undefined => {
  const arrays = arraysOf(c.type);
  if (b.arrays !== arrays) return `array shape ${b.arrays || "none"} against ${arrays || "none"}`;
  const base = c.type.slice(0, c.type.length - arrays.length);
  const named = internalName(c);
  if (b.tuple) {
    if (base !== "tuple") return `a tuple against ${c.type}`;
    const comps = c.components ?? [];
    if (comps.length !== b.tuple.length) return `a tuple of ${b.tuple.length} fields against ${comps.length}`;
    for (let i = 0; i < comps.length; i++) {
      const why = typeMismatch(b.tuple[i]!.type, comps[i]!);
      if (why) return `tuple field ${i + 1}: ${why}`;
    }
    return undefined;
  }
  if (base === "tuple") return b.base === named.name ? undefined : `struct ${b.base} against struct ${named.name}`;
  if (b.base === base) return undefined;
  if (named.kind === "enum" && b.base === named.name) return undefined;
  if (named.kind === "contract" && base === "address" && b.base === named.name) return undefined;
  return `${b.base} against ${named.kind === "plain" ? base : `${base} (${named.name})`}`;
};

/** The ABI entry in the blueprint's notation, to show in a report: the type names, no argument names unless the code has them. */
export const renderType = (p: AbiParam): string => {
  const arrays = arraysOf(p.type);
  const base = p.type.slice(0, p.type.length - arrays.length);
  const n = internalName(p);
  if (base === "tuple") return `${n.name !== "" ? n.name : `(${(p.components ?? []).map(renderType).join(", ")})`}${arrays}`;
  return `${base}${arrays}`;
};
const renderParam = (p: AbiParam, events: boolean): string =>
  [renderType(p), events && p.indexed ? "indexed" : "", p.name ?? ""].filter(Boolean).join(" ");

export const renderEntry = (e: AbiEntry): string => {
  const ev = e.type === "event";
  const args = (e.inputs ?? []).map((p) => renderParam(p, ev)).join(", ");
  const m = e.stateMutability && e.stateMutability !== "nonpayable" ? ` ${e.stateMutability}` : "";
  const outs = e.outputs?.length ? ` returns (${e.outputs.map((p) => renderParam(p, false)).join(", ")})` : "";
  return `${e.name}(${args})${m}${outs}`;
};

export const renderBlueprint = (s: BlueprintSignature): string => {
  const one = (p: BlueprintParam): string => {
    const t = p.type.tuple ? `(${p.type.tuple.map(one).join(", ")})` : p.type.base;
    return [`${t}${p.type.arrays}`, p.indexed ? "indexed" : "", p.name ?? ""].filter(Boolean).join(" ");
  };
  const m = s.mutability !== "nonpayable" ? ` ${s.mutability}` : "";
  const outs = s.returns.length ? ` returns (${s.returns.map(one).join(", ")})` : "";
  return `${s.name}(${s.params.map(one).join(", ")})${m}${outs}`;
};

const listMismatch = (b: readonly BlueprintParam[], c: readonly AbiParam[], what: string, events: boolean): string[] => {
  if (b.length !== c.length) return [`${what}: ${b.length} in the blueprint, ${c.length} in the code`];
  const out: string[] = [];
  b.forEach((bp, i) => {
    const why = typeMismatch(bp.type, c[i]!);
    if (why) out.push(`${what} ${i + 1} (${c[i]!.name || "unnamed"}): ${why}`);
    if (events && bp.indexed !== Boolean(c[i]!.indexed)) out.push(`${what} ${i + 1} (${c[i]!.name || "unnamed"}): ${c[i]!.indexed ? "indexed in the code, not in the blueprint" : "indexed in the blueprint, not in the code"}`);
  });
  return out;
};

/** Every way the blueprint's signature differs from the code's entry; empty when they agree. */
export const signatureMismatches = (b: BlueprintSignature, c: AbiEntry): string[] => {
  const out: string[] = [];
  if (b.name !== c.name) out.push(`name ${b.name} against ${c.name}`);
  out.push(...listMismatch(b.params, c.inputs ?? [], "argument", c.type === "event"));
  if (c.type === "function") {
    out.push(...listMismatch(b.returns, c.outputs ?? [], "return", false));
    const cm = c.stateMutability ?? "nonpayable";
    if (b.mutability !== cm) out.push(`mutability ${b.mutability} in the blueprint, ${cm} in the code`);
  }
  return out;
};
