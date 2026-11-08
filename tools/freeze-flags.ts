// node --experimental-strip-types tools/freeze-flags.ts [old repo root] [out]
// Generates books/frozen/flags.ts: the positional arguments and flags of every frozen command, as
// the old CLI declares them, and the global flags every command takes, once.
//
// Source: Xelmar-tech/infrastructure, branch integration/factory, apps/cli/src. The CLI builds its
// grammar with Effect CLI (`Command.make`, `Flag.*`, `Argument.*`), so this reads that source with
// the TypeScript compiler API and evaluates only what the grammar needs: string and number literals,
// objects, arrays, constants and the helper functions that build flags, followed across imports
// into the old packages. Handlers are never run, and nothing of the old system is executed. A value
// the evaluator cannot work out stays unknown, and an unknown name, description, choice or default
// stops the generator: nothing is guessed.
//
// Effect's own built-in global flags (--help, --version and the rest) are declared in the Effect
// library, not in the CLI, so they are taken as the old CLI printed them: the `globalFlags` of the
// newest `capxul schema … --json` result recorded in apps/docs/factory/proofs. The six global flags
// the CLI declares itself are read from its source and checked against that same printed result.
//
// Running it again on the same checkout writes the same file, byte for byte.

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { frozen } from "../books/frozen/operations.ts";

const ROOT = path.resolve(process.argv[2] ?? "/home/user/factory");
const OUT = path.resolve(process.argv[3] ?? "books/frozen/flags.ts");
const CLI = path.join(ROOT, "apps/cli");

// ── values ──────────────────────────────────────────────────────────────────────────────────

/** A value the evaluator could not work out, with the first reason. */
class Unknown {
  readonly why: string;
  constructor(why: string) { this.why = why.length > 400 ? why.slice(0, 400) + "…" : why; }
}
/** A construct the evaluator does not model; caught at a function or declaration boundary. */
class Unsupported extends Error {}
/** The grammar needs a value the evaluator could not work out: the generator stops. */
class Fatal extends Error {}

const CLOSURE = Symbol("closure");
const MODEL = Symbol("model");
type Val = unknown;

const isUnknown = (v: Val): v is Unknown => v instanceof Unknown;
const containsUnknown = (v: Val, depth = 0): boolean => {
  if (v instanceof Unknown) return true;
  if (depth > 4 || v === null || typeof v !== "object") return false;
  if (Array.isArray(v)) return v.some((x) => containsUnknown(x, depth + 1));
  if (Object.getPrototypeOf(v) === Object.prototype) return Object.values(v).some((x) => containsUnknown(x, depth + 1));
  return false;
};
const where = (node: ts.Node) => {
  const sf = node.getSourceFile();
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return `${path.relative(ROOT, sf.fileName)}:${line + 1}`;
};
const unsupported = (node: ts.Node, what: string): never => {
  throw new Unsupported(`${what} at ${where(node)}`);
};

// ── the Effect CLI model ─────────────────────────────────────────────────────────────────────

type ParamSpec = {
  kind: "flag" | "argument";
  name: string;
  type: string;
  choices: string[] | null;
  description: string | null;
  metavar: string | null;
  aliases: string[];
  optional: boolean;
  hasDefault: boolean;
  default: Val;
  repeat: { min: number; max?: number } | null;
};
class Param {
  readonly p: ParamSpec;
  constructor(p: ParamSpec) { this.p = p; }
  with(patch: Partial<ParamSpec>) { return new Param({ ...this.p, ...patch }); }
  pipe(...fns: Val[]) { return pipeAll(this, fns); }
}
type Child = Cmd | { group: string; commands: Cmd[] };
type CmdSpec = {
  name: string;
  params: Param[];
  description: string | null;
  children: Child[];
  unlisted: boolean;
  alias: string | null;
  globals: Global[];
  at: string;
};
class Cmd {
  readonly c: CmdSpec;
  constructor(c: CmdSpec) { this.c = c; }
  with(patch: Partial<CmdSpec>) { return new Cmd({ ...this.c, ...patch }); }
  pipe(...fns: Val[]) { return pipeAll(this, fns); }
}
class Global {
  readonly name: string;
  readonly flag: Param;
  constructor(name: string, flag: Param) { this.name = name; this.flag = flag; }
}
for (const proto of [Param.prototype, Cmd.prototype]) (proto.pipe as unknown as Record<symbol, boolean>)[MODEL] = true;

function pipeAll(self: Val, fns: Val[]): Val {
  let acc = self;
  for (const fn of fns) {
    if (isUnknown(fn)) throw new Fatal(`a pipe step is unknown: ${fn.why}`);
    if (typeof fn !== "function") throw new Fatal(`a pipe step is not a function`);
    acc = fn(acc);
    if (isUnknown(acc)) throw new Fatal(`a pipe step gave an unknown value: ${acc.why}`);
  }
  return acc;
}

const known = <T>(v: Val, what: string, test: (v: Val) => boolean): T => {
  if (isUnknown(v)) throw new Fatal(`${what} is unknown: ${v.why}`);
  if (!test(v)) throw new Fatal(`${what} is not what Effect CLI takes: ${JSON.stringify(v)}`);
  return v as T;
};
const str = (v: Val, what: string) => known<string>(v, what, (x) => typeof x === "string");
const strings = (v: Val, what: string) =>
  known<string[]>(v, what, (x) => Array.isArray(x) && x.every((s) => typeof s === "string")).slice();
const data = (v: Val, what: string): Val => {
  if (containsUnknown(v)) throw new Fatal(`${what} is unknown`);
  JSON.stringify(v);
  return v;
};
const model = <F extends (...args: never[]) => unknown>(f: F): F => Object.assign(f, { [MODEL]: true });
/** An Effect "dual" combinator: `f(args)(param)` in a pipe, or `f(param, args)`. */
const dual = <T>(arity: number, is: (v: Val) => boolean, apply: (self: T, ...args: Val[]) => Val) =>
  model((...args: Val[]) =>
    args.length >= arity && is(args[0])
      ? apply(args[0] as T, ...args.slice(1))
      : model((self: Val) => {
          if (!is(self)) throw new Fatal(`a combinator was applied to something it does not take`);
          return apply(self as T, ...args);
        }));
const isParam = (v: Val) => v instanceof Param;
const isCmd = (v: Val) => v instanceof Cmd;

const single = (kind: ParamSpec["kind"], type: string) =>
  model((name: Val) => new Param({
    kind, name: str(name, `a ${kind} name`), type, choices: null, description: null, metavar: null, aliases: [],
    optional: false, hasDefault: false, default: null, repeat: null,
  }));
const literals = (kind: ParamSpec["kind"]) =>
  model((name: Val, values: Val) => single(kind, "choice")(name).with({ choices: strings(values, `the choices of ${String(name)}`) }));
const choiceWithValue = (kind: ParamSpec["kind"]) =>
  model((name: Val, pairs: Val) => {
    const list = known<Val[]>(pairs, `the choices of ${String(name)}`, Array.isArray);
    return single(kind, "choice")(name).with({ choices: list.map((pair) => str((pair as Val[])[0], `a choice of ${String(name)}`)) });
  });
const paramCombinators = {
  withDescription: dual<Param>(2, isParam, (self, d) => self.with({ description: str(d, `the description of ${self.p.name}`) })),
  withMetavar: dual<Param>(2, isParam, (self, m) => self.with({ metavar: str(m, `the metavar of ${self.p.name}`) })),
  withAlias: dual<Param>(2, isParam, (self, a) => self.with({ aliases: [...self.p.aliases, str(a, `an alias of ${self.p.name}`)] })),
  optional: model((self: Val) => known<Param>(self, "an optional flag", isParam).with({ optional: true })),
  withDefault: dual<Param>(2, isParam, (self, v) => self.with({ hasDefault: true, default: data(v, `the default of ${self.p.name}`) })),
  atLeast: dual<Param>(2, isParam, (self, n) => self.with({ repeat: { min: known<number>(n, "a minimum", (x) => typeof x === "number") } })),
  atMost: dual<Param>(2, isParam, (self, n) => self.with({ repeat: { min: 0, max: known<number>(n, "a maximum", (x) => typeof x === "number") } })),
  between: dual<Param>(3, isParam, (self, a, b) => self.with({
    repeat: { min: known<number>(a, "a minimum", (x) => typeof x === "number"), max: known<number>(b, "a maximum", (x) => typeof x === "number") },
  })),
  // Value checks and transforms change what a flag's value becomes, not its grammar.
  filter: dual<Param>(3, isParam, (self) => self),
  filterMap: dual<Param>(3, isParam, (self) => self),
  map: dual<Param>(2, isParam, (self) => self),
  mapEffect: dual<Param>(2, isParam, (self) => self),
  mapTryCatch: dual<Param>(3, isParam, (self) => self),
};
const FlagNs = {
  String: single("flag", "string"), Int: single("flag", "integer"), Boolean: single("flag", "boolean"),
  Finite: single("flag", "number"), Date: single("flag", "date"),
  Literals: literals("flag"), ChoiceWithValue: choiceWithValue("flag"),
  ...paramCombinators,
};
const ArgumentNs = {
  String: single("argument", "string"), Int: single("argument", "integer"), Finite: single("argument", "number"),
  Literals: literals("argument"), ChoiceWithValue: choiceWithValue("argument"),
  ...paramCombinators,
  variadic: dual<Param>(2, isParam, (self, options) => {
    const o = (options === undefined ? {} : known<{ min?: number; max?: number }>(options, "variadic options", (x) => typeof x === "object")) ?? {};
    return self.with({ repeat: { min: o.min ?? 0, ...(o.max === undefined ? {} : { max: o.max }) } });
  }),
};
/** The params of a command's config, in the order it declares them (Effect walks records and arrays). */
const paramsOf = (config: Val, at: string): Param[] => {
  if (config === undefined) return [];
  if (isUnknown(config)) throw new Fatal(`the config of the command at ${at} is unknown: ${config.why}`);
  if (config instanceof Param) return [config];
  if (Array.isArray(config)) return config.flatMap((c) => paramsOf(c, at));
  if (config !== null && typeof config === "object" && Object.getPrototypeOf(config) === Object.prototype)
    return Object.values(config).flatMap((c) => paramsOf(c, at));
  throw new Fatal(`the config of the command at ${at} holds something that is no flag or argument`);
};
let callSite = "";
const CommandNs = {
  make: model((name: Val, config?: Val) => new Cmd({
    name: str(name, "a command name"), params: paramsOf(config, callSite), description: null, children: [],
    unlisted: false, alias: null, globals: [], at: callSite,
  })),
  withDescription: dual<Cmd>(2, isCmd, (self, d) => self.with({ description: str(d, `the description of ${self.c.name}`) })),
  withSubcommands: dual<Cmd>(2, isCmd, (self, children) => self.with({
    children: [...self.c.children, ...known<Val[]>(children, `the subcommands of ${self.c.name}`, Array.isArray).map((child): Child => {
      if (child instanceof Cmd) return child;
      const g = child as { group?: Val; commands?: Val };
      if (g && typeof g === "object" && typeof g.group === "string" && Array.isArray(g.commands) && g.commands.every(isCmd))
        return { group: g.group, commands: g.commands as Cmd[] };
      throw new Fatal(`a subcommand of ${self.c.name} is unknown: ${isUnknown(child) ? child.why : JSON.stringify(child)}`);
    })],
  })),
  withAlias: dual<Cmd>(2, isCmd, (self, a) => self.with({ alias: str(a, `the alias of ${self.c.name}`) })),
  withGlobalFlags: dual<Cmd>(2, isCmd, (self, flags) => self.with({
    globals: known<Val[]>(flags, "the global flags", Array.isArray).map((g) => known<Global>(g, "a global flag", (x) => x instanceof Global)),
  })),
  unlisted: model((self: Val) => known<Cmd>(self, "an unlisted command", isCmd).with({ unlisted: true })),
  // Metadata, examples and handlers do not change the grammar.
  annotate: dual<Cmd>(3, isCmd, (self) => self),
  withExamples: dual<Cmd>(2, isCmd, (self) => self),
  withHandler: dual<Cmd>(2, isCmd, (self) => self),
  withShortDescription: dual<Cmd>(2, isCmd, (self) => self),
};
const GlobalFlagNs = {
  Setting: model((name: Val) => model((spec: Val) => {
    const flag = (spec as { flag?: Val })?.flag;
    return new Global(str(name, "a global flag name"), known<Param>(flag, `the flag of global ${String(name)}`, isParam));
  })),
};

// ── modules ─────────────────────────────────────────────────────────────────────────────────

type Local = { node: ts.Node; pick?: ts.BindingName; within?: ts.VariableDeclaration };
type Mod = {
  file: string;
  sf: ts.SourceFile;
  locals: Map<string, Local>;
  imports: Map<string, { spec: string; name: string }>;
  exports: Map<string, { local: string } | { from: string; name: string }>;
  stars: string[];
  cache: Map<string, Val>;
  busy: Set<string>;
};
const mods = new Map<string, Mod>();

const bindingNames = (name: ts.BindingName, out: ts.Identifier[] = []) => {
  if (ts.isIdentifier(name)) out.push(name);
  else for (const el of name.elements) if (!ts.isOmittedExpression(el)) bindingNames(el.name, out);
  return out;
};
const hasModifier = (node: ts.Node, kind: ts.SyntaxKind) =>
  (ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? [] : []).some((m) => m.kind === kind);

function loadMod(file: string): Mod {
  const hit = mods.get(file);
  if (hit) return hit;
  const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const m: Mod = { file, sf, locals: new Map(), imports: new Map(), exports: new Map(), stars: [], cache: new Map(), busy: new Set() };
  for (const st of sf.statements) {
    const exported = hasModifier(st, ts.SyntaxKind.ExportKeyword);
    if (hasModifier(st, ts.SyntaxKind.DeclareKeyword)) continue;
    if (ts.isImportDeclaration(st)) {
      const spec = (st.moduleSpecifier as ts.StringLiteral).text;
      const clause = st.importClause;
      if (!clause || clause.isTypeOnly) continue;
      if (clause.name) m.imports.set(clause.name.text, { spec, name: "default" });
      const nb = clause.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) m.imports.set(nb.name.text, { spec, name: "*" });
      if (nb && ts.isNamedImports(nb))
        for (const el of nb.elements) if (!el.isTypeOnly) m.imports.set(el.name.text, { spec, name: (el.propertyName ?? el.name).text });
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations)
        for (const id of bindingNames(d.name)) {
          m.locals.set(id.text, ts.isIdentifier(d.name) ? { node: d } : { node: d, pick: id, within: d });
          if (exported) m.exports.set(id.text, { local: id.text });
        }
    } else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) && st.name) {
      m.locals.set(st.name.text, { node: st });
      if (exported) m.exports.set(hasModifier(st, ts.SyntaxKind.DefaultKeyword) ? "default" : st.name.text, { local: st.name.text });
    } else if (ts.isExportAssignment(st)) {
      m.locals.set("*default*", { node: st });
      m.exports.set("default", { local: "*default*" });
    } else if (ts.isExportDeclaration(st) && !st.isTypeOnly) {
      const from = st.moduleSpecifier ? (st.moduleSpecifier as ts.StringLiteral).text : undefined;
      const ec = st.exportClause;
      if (!ec) { if (from) m.stars.push(from); continue; }
      if (ts.isNamespaceExport(ec)) { if (from) m.exports.set(ec.name.text, { from, name: "*" }); continue; }
      for (const el of ec.elements) {
        if (el.isTypeOnly) continue;
        const inner = (el.propertyName ?? el.name).text;
        m.exports.set(el.name.text, from ? { from, name: inner } : { local: inner });
      }
    }
  }
  mods.set(file, m);
  return m;
}

const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
const asFile = (base: string): string | undefined => {
  const tries = base.endsWith(".ts") ? [base] : base.endsWith(".js") ? [base.slice(0, -3) + ".ts", base] : [base + ".ts", base + ".tsx", path.join(base, "index.ts"), base];
  return tries.find((f) => fs.existsSync(f) && fs.statSync(f).isFile() && /\.tsx?$/.test(f));
};
const packageOf = (file: string): string | undefined => {
  for (let dir = path.dirname(file); dir.startsWith(ROOT); dir = path.dirname(dir))
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
  return undefined;
};
/** A package.json `imports` or `exports` map entry for `key`, with `*` patterns. */
const mapEntry = (map: Record<string, unknown> | undefined, key: string): string | undefined => {
  if (!map) return undefined;
  const pick = (v: unknown): string | undefined =>
    typeof v === "string" ? v : v && typeof v === "object" ? pick((v as Record<string, unknown>).import ?? (v as Record<string, unknown>).default ?? (v as Record<string, unknown>).types) : undefined;
  if (key in map) return pick(map[key]);
  for (const [pattern, target] of Object.entries(map)) {
    const star = pattern.indexOf("*");
    if (star < 0) continue;
    const [pre, post] = [pattern.slice(0, star), pattern.slice(star + 1)];
    if (key.startsWith(pre) && key.endsWith(post) && key.length >= pre.length + post.length) {
      const t = pick(target);
      return t?.replace("*", key.slice(pre.length, key.length - post.length));
    }
  }
  return undefined;
};
const workspacePackages = new Map<string, string>();
for (const group of ["apps", "packages"])
  for (const dir of fs.readdirSync(path.join(ROOT, group))) {
    const pj = path.join(ROOT, group, dir, "package.json");
    if (fs.existsSync(pj)) workspacePackages.set(readJson(pj).name, path.join(ROOT, group, dir));
  }

/** The source file an import names, or undefined for a module outside the old repository. */
function resolveSpec(from: string, spec: string): string | undefined {
  if (spec.startsWith(".")) return asFile(path.resolve(path.dirname(from), spec));
  const pkg = packageOf(from);
  if (spec.startsWith("#") && pkg) {
    const t = mapEntry(readJson(path.join(pkg, "package.json")).imports, spec);
    return t ? asFile(path.resolve(pkg, t)) : undefined;
  }
  if (spec.startsWith("~/") && pkg) return asFile(path.join(pkg, "src", spec.slice(2)));
  const parts = spec.split("/");
  const name = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  const dir = workspacePackages.get(name);
  if (!dir) return undefined;
  const sub = "." + spec.slice(name.length);
  const t = mapEntry(readJson(path.join(dir, "package.json")).exports, sub);
  return t ? asFile(path.resolve(dir, t)) : undefined;
}

const builtins: Record<string, Record<string, Val>> = {
  "effect/cli": { Flag: FlagNs, Argument: ArgumentNs, Command: CommandNs, GlobalFlag: GlobalFlagNs },
};
class Namespace {
  readonly mod: Mod;
  constructor(mod: Mod) { this.mod = mod; }
}

function importValue(m: Mod, spec: string, name: string, at: ts.Node): Val {
  const builtin = builtins[spec];
  if (builtin) return name in builtin ? builtin[name] : new Unknown(`${spec}#${name}`);
  const file = resolveSpec(m.file, spec);
  if (!file) return new Unknown(`${spec}#${name} (outside the old repository's source)`);
  const target = loadMod(file);
  if (name === "*") return new Namespace(target);
  return exportValue(target, name, at, new Set());
}
function exportValue(m: Mod, name: string, at: ts.Node, seen: Set<string>): Val {
  const key = `${m.file}#${name}`;
  if (seen.has(key)) return new Unknown(`export cycle ${key}`);
  seen.add(key);
  const e = m.exports.get(name);
  if (e && "local" in e) return localValue(m, e.local, at);
  if (e) return importValue(m, e.from, e.name, at);
  if (name !== "default")
    for (const star of m.stars) {
      const file = resolveSpec(m.file, star);
      if (!file) continue;
      const target = loadMod(file);
      if (target.exports.has(name) || target.stars.length) {
        const v = exportValue(target, name, at, seen);
        if (!(v instanceof Unknown && v.why.startsWith("no export"))) return v;
      }
    }
  return new Unknown(`no export ${name} in ${path.relative(ROOT, m.file)}`);
}
function localValue(m: Mod, name: string, at: ts.Node): Val {
  if (m.cache.has(name)) return m.cache.get(name);
  const local = m.locals.get(name);
  if (!local) {
    const imp = m.imports.get(name);
    if (imp) return importValue(m, imp.spec, imp.name, at);
    return undefined as never;
  }
  if (m.busy.has(name)) return new Unknown(`${name} is read while it is defined (${path.relative(ROOT, m.file)})`);
  m.busy.add(name);
  let v: Val;
  try {
    const env = moduleEnv(m);
    const n = local.node;
    if (ts.isFunctionDeclaration(n)) v = closure(n, env);
    else if (ts.isClassDeclaration(n) || ts.isEnumDeclaration(n)) v = new Unknown(`class ${name}`);
    else if (ts.isExportAssignment(n)) v = evaluate(n.expression, env);
    else if (ts.isVariableDeclaration(n)) {
      const init = n.initializer ? evaluate(n.initializer, env) : undefined;
      if (local.pick && local.within) {
        const scope = new Env(env);
        bind(local.within.name, init, scope);
        v = scope.get(name);
      } else v = init;
    } else v = new Unknown(`declaration ${name}`);
  } catch (e) {
    if (!(e instanceof Unsupported)) throw e;
    v = new Unknown(e.message);
  } finally {
    m.busy.delete(name);
  }
  m.cache.set(name, v);
  return v;
}

// ── evaluation ──────────────────────────────────────────────────────────────────────────────

const GLOBALS: Record<string, Val> = {
  undefined, NaN, Infinity, Object, Array, Map, Set, String, Number, Boolean, JSON, Math, parseInt, parseFloat,
};
class Env {
  readonly vars = new Map<string, Val>();
  readonly parent: Env | undefined;
  readonly mod: Mod;
  constructor(parent: Env | undefined, mod?: Mod) { this.parent = parent; this.mod = mod ?? parent!.mod; }
  has(name: string): boolean { return this.vars.has(name) || (this.parent?.has(name) ?? false); }
  get(name: string): Val { return this.vars.has(name) ? this.vars.get(name) : this.parent?.get(name); }
  set(name: string, v: Val) { this.vars.set(name, v); }
  assign(name: string, v: Val): boolean {
    if (this.vars.has(name)) { this.vars.set(name, v); return true; }
    return this.parent?.assign(name, v) ?? false;
  }
}
const moduleEnvs = new Map<Mod, Env>();
const moduleEnv = (m: Mod) => moduleEnvs.get(m) ?? (moduleEnvs.set(m, new Env(undefined, m)), moduleEnvs.get(m)!);

function lookup(id: ts.Identifier, env: Env): Val {
  const name = id.text;
  if (env.has(name)) return env.get(name);
  const m = env.mod;
  if (m.locals.has(name) || m.imports.has(name)) return localValue(m, name, id);
  if (name in GLOBALS) return GLOBALS[name];
  return new Unknown(`the global ${name}`);
}

function closure(fn: ts.FunctionLikeDeclaration, env: Env): Val {
  const f = function (this: Val, ...args: Val[]) { return callClosure(fn, env, this, args); };
  return Object.assign(f, { [CLOSURE]: true });
}
function callClosure(fn: ts.FunctionLikeDeclaration, env: Env, self: Val, args: Val[]): Val {
  if (fn.asteriskToken || hasModifier(fn, ts.SyntaxKind.AsyncKeyword)) return new Unknown(`a generator or async function at ${where(fn)}`);
  const scope = new Env(env);
  if (!ts.isArrowFunction(fn)) scope.set("this", self);
  try {
    fn.parameters.forEach((p, i) => {
      if (p.dotDotDotToken) return bind(p.name, args.slice(i), scope);
      let v = args[i];
      if (v === undefined && p.initializer) v = evaluate(p.initializer, scope);
      bind(p.name, v, scope);
    });
    if (!fn.body) return new Unknown(`a function without a body at ${where(fn)}`);
    if (!ts.isBlock(fn.body)) return evaluate(fn.body, scope);
    const out = exec(fn.body.statements, scope);
    return out && out.kind === "return" ? out.value : undefined;
  } catch (e) {
    if (e instanceof Unsupported) return new Unknown(e.message);
    throw e;
  }
}

function bind(name: ts.BindingName, v: Val, env: Env) {
  if (ts.isIdentifier(name)) return env.set(name.text, v);
  if (isUnknown(v)) { for (const id of bindingNames(name)) env.set(id.text, v); return; }
  if (ts.isObjectBindingPattern(name)) {
    if (v === null || v === undefined) unsupported(name, "destructuring nothing");
    const used: string[] = [];
    for (const el of name.elements) {
      if (el.dotDotDotToken) {
        const rest = Object.fromEntries(Object.entries(v as object).filter(([k]) => !used.includes(k)));
        bind(el.name, rest, env);
        continue;
      }
      const key = el.propertyName ? propertyName(el.propertyName, env) : (el.name as ts.Identifier).text;
      used.push(key);
      let x = getProperty(v, key, el);
      if (x === undefined && el.initializer) x = evaluate(el.initializer, env);
      bind(el.name, x, env);
    }
    return;
  }
  const arr = Array.isArray(v) ? v : unsupported(name, "array destructuring of a non-array");
  name.elements.forEach((el, i) => {
    if (ts.isOmittedExpression(el)) return;
    if (el.dotDotDotToken) return bind(el.name, arr.slice(i), env);
    let x = arr[i];
    if (x === undefined && el.initializer) x = evaluate(el.initializer, env);
    bind(el.name, x, env);
  });
}

type Completion = { kind: "return"; value: Val } | { kind: "break" } | { kind: "continue" } | undefined;
function exec(statements: readonly ts.Statement[], env: Env): Completion {
  for (const st of statements)
    if (ts.isFunctionDeclaration(st) && st.name) env.set(st.name.text, closure(st, env));
  for (const st of statements) {
    const out = execOne(st, env);
    if (out) return out;
  }
  return undefined;
}
function execOne(st: ts.Statement, env: Env): Completion {
  if (ts.isFunctionDeclaration(st) || ts.isEmptyStatement(st)) return undefined;
  if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) return undefined;
  if (ts.isVariableStatement(st)) {
    for (const d of st.declarationList.declarations) bind(d.name, d.initializer ? evaluate(d.initializer, env) : undefined, env);
    return undefined;
  }
  if (ts.isReturnStatement(st)) return { kind: "return", value: st.expression ? evaluate(st.expression, env) : undefined };
  if (ts.isExpressionStatement(st)) { evaluate(st.expression, env); return undefined; }
  if (ts.isBlock(st)) return exec(st.statements, new Env(env));
  if (ts.isIfStatement(st)) {
    const c = evaluate(st.expression, env);
    if (isUnknown(c)) throw new Unsupported(`a condition is unknown at ${where(st)}: ${c.why}`);
    if (c) return execOne(st.thenStatement, new Env(env));
    return st.elseStatement ? execOne(st.elseStatement, new Env(env)) : undefined;
  }
  if (ts.isBreakStatement(st) && !st.label) return { kind: "break" };
  if (ts.isContinueStatement(st) && !st.label) return { kind: "continue" };
  if (ts.isForOfStatement(st) && ts.isVariableDeclarationList(st.initializer) && st.initializer.declarations.length === 1) {
    const it = evaluate(st.expression, env);
    if (isUnknown(it) || it === null || typeof (it as Iterable<Val>)[Symbol.iterator] !== "function") return unsupported(st, "a loop over an unknown value");
    for (const x of it as Iterable<Val>) {
      const scope = new Env(env);
      bind(st.initializer.declarations[0].name, x, scope);
      const out = execOne(st.statement, scope);
      if (out?.kind === "break") break;
      if (out?.kind === "return") return out;
    }
    return undefined;
  }
  if (ts.isSwitchStatement(st)) {
    const d = evaluate(st.expression, env);
    if (isUnknown(d)) return unsupported(st, "a switch on an unknown value");
    const clauses = st.caseBlock.clauses;
    let start = clauses.findIndex((c) => ts.isCaseClause(c) && evaluate(c.expression, env) === d);
    if (start < 0) start = clauses.findIndex((c) => ts.isDefaultClause(c));
    if (start < 0) return undefined;
    const scope = new Env(env);
    for (const c of clauses.slice(start)) {
      const out = exec(c.statements, scope);
      if (out?.kind === "break") return undefined;
      if (out) return out;
    }
    return undefined;
  }
  return unsupported(st, `the statement ${ts.SyntaxKind[st.kind]}`);
}

function propertyName(name: ts.PropertyName, env: Env): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isComputedPropertyName(name)) {
    const k = evaluate(name.expression, env);
    if (typeof k === "string" || typeof k === "number") return String(k);
    return unsupported(name, "a computed key that is not known");
  }
  return unsupported(name, "a property name");
}
const BLOCKED = new Set(["constructor", "__proto__", "prototype", "__defineGetter__", "__defineSetter__"]);
function getProperty(obj: Val, key: string, at: ts.Node, optional = false): Val {
  if (isUnknown(obj)) return obj;
  if (obj === null || obj === undefined) return optional ? undefined : unsupported(at, `reading ${key} of ${String(obj)}`);
  if (BLOCKED.has(key)) return unsupported(at, `reading ${key}`);
  if (obj instanceof Namespace) return exportValue(obj.mod, key, at, new Set());
  if (obj instanceof Param || obj instanceof Cmd) return key === "pipe" ? (obj as Param).pipe : unsupported(at, `reading ${key} of a ${obj instanceof Param ? "flag" : "command"}`);
  return (obj as Record<string, Val>)[key];
}
function call(fn: Val, self: Val, args: Val[], at: ts.Node): Val {
  if (isUnknown(fn)) return fn;
  if (typeof fn !== "function") return unsupported(at, "calling something that is not a function");
  const f = fn as ((...a: Val[]) => Val) & { [CLOSURE]?: boolean; [MODEL]?: boolean };
  if (f[MODEL]) {
    const before = callSite;
    callSite = where(at);
    try { return f.apply(self, args); } finally { callSite = before; }
  }
  if (f[CLOSURE]) return f.apply(self, args);
  // A built-in (Array.prototype.map, Object.entries, …): only on known values, so it never prints an unknown.
  if (containsUnknown(self) || args.some((a) => containsUnknown(a))) return new Unknown(`a built-in call on an unknown value at ${where(at)}`);
  try { return f.apply(self, args); } catch (e) {
    if (e instanceof Fatal) throw e;
    return new Unknown(`a built-in call threw at ${where(at)}: ${(e as Error).message}`);
  }
}
const primitive = (v: Val) => v === null || ["string", "number", "boolean", "undefined", "bigint"].includes(typeof v);

function evaluate(node: ts.Expression, env: Env): Val {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression(node))
    return evaluate(node.expression, env);
  if (ts.isExpressionWithTypeArguments(node)) return evaluate(node.expression, env);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (node.kind === ts.SyntaxKind.ThisKeyword) return env.get("this");
  if (ts.isIdentifier(node)) return lookup(node, env);
  if (ts.isTemplateExpression(node)) {
    let s = node.head.text;
    for (const span of node.templateSpans) {
      const v = evaluate(span.expression, env);
      if (isUnknown(v)) return v;
      if (!primitive(v)) return unsupported(span, "a template of a non-primitive");
      s += String(v) + span.literal.text;
    }
    return s;
  }
  if (ts.isArrayLiteralExpression(node)) {
    const out: Val[] = [];
    for (const el of node.elements) {
      if (ts.isSpreadElement(el)) {
        const v = evaluate(el.expression, env);
        if (isUnknown(v)) return v;
        out.push(...(v as Iterable<Val>));
      } else if (ts.isOmittedExpression(el)) out.push(undefined);
      else out.push(evaluate(el, env));
    }
    return out;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const out: Record<string, Val> = {};
    for (const p of node.properties) {
      if (ts.isPropertyAssignment(p)) out[propertyName(p.name, env)] = evaluate(p.initializer, env);
      else if (ts.isShorthandPropertyAssignment(p)) out[p.name.text] = lookup(p.name, env);
      else if (ts.isSpreadAssignment(p)) {
        const v = evaluate(p.expression, env);
        if (isUnknown(v)) return v;
        if (v !== null && typeof v === "object") Object.assign(out, v);
      } else if (ts.isMethodDeclaration(p)) out[propertyName(p.name, env)] = closure(p, env);
      else if (ts.isGetAccessorDeclaration(p)) {
        const getter = closure(p, env) as () => Val;
        out[propertyName(p.name, env)] = getter.call(out);
      } else return unsupported(p, "an object member");
    }
    return out;
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return closure(node, env);
  if (ts.isPropertyAccessExpression(node)) {
    const obj = evaluate(node.expression, env);
    return getProperty(obj, node.name.text, node, !!(node.flags & ts.NodeFlags.OptionalChain));
  }
  if (ts.isElementAccessExpression(node)) {
    const obj = evaluate(node.expression, env);
    const k = evaluate(node.argumentExpression, env);
    if (isUnknown(k)) return k;
    return getProperty(obj, String(k), node, !!(node.flags & ts.NodeFlags.OptionalChain));
  }
  if (ts.isCallExpression(node)) {
    const args: Val[] = [];
    for (const a of node.arguments) {
      if (ts.isSpreadElement(a)) {
        const v = evaluate(a.expression, env);
        if (isUnknown(v)) return v;
        args.push(...(v as Iterable<Val>));
      } else args.push(evaluate(a, env));
    }
    const optional = !!(node.flags & ts.NodeFlags.OptionalChain);
    let callee = node.expression;
    while (ts.isParenthesizedExpression(callee) || ts.isNonNullExpression(callee)) callee = callee.expression;
    if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
      const self = evaluate(callee.expression, env);
      const key = ts.isPropertyAccessExpression(callee) ? callee.name.text : evaluate(callee.argumentExpression, env);
      if (isUnknown(key)) return key;
      const fn = getProperty(self, String(key), callee, !!(callee.flags & ts.NodeFlags.OptionalChain));
      if ((fn === undefined || fn === null) && optional) return undefined;
      return call(fn, self, args, node);
    }
    if (callee.kind === ts.SyntaxKind.ImportKeyword) return new Unknown(`a dynamic import at ${where(node)}`);
    const fn = evaluate(callee, env);
    if ((fn === undefined || fn === null) && optional) return undefined;
    return call(fn, undefined, args, node);
  }
  if (ts.isNewExpression(node)) {
    const ctor = evaluate(node.expression, env);
    const args = (node.arguments ?? []).map((a) => evaluate(a, env));
    if (ctor !== Map && ctor !== Set) return new Unknown(`new ${node.expression.getText()} at ${where(node)}`);
    if (args.some((a) => containsUnknown(a))) return new Unknown(`new ${node.expression.getText()} of an unknown value`);
    return new (ctor as MapConstructor)(args[0] as Iterable<[Val, Val]>);
  }
  if (ts.isConditionalExpression(node)) {
    const c = evaluate(node.condition, env);
    if (isUnknown(c)) return c;
    return evaluate(c ? node.whenTrue : node.whenFalse, env);
  }
  if (ts.isPrefixUnaryExpression(node)) {
    const v = evaluate(node.operand, env);
    if (isUnknown(v)) return v;
    switch (node.operator) {
      case ts.SyntaxKind.ExclamationToken: return !v;
      case ts.SyntaxKind.MinusToken: return -(v as number);
      case ts.SyntaxKind.PlusToken: return +(v as number);
      default: return unsupported(node, "a unary operator");
    }
  }
  if (ts.isTypeOfExpression(node)) {
    const v = evaluate(node.expression, env);
    return isUnknown(v) ? v : typeof v;
  }
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (op === ts.SyntaxKind.EqualsToken) {
      const v = evaluate(node.right, env);
      if (ts.isIdentifier(node.left) && env.assign(node.left.text, v)) return v;
      if (ts.isPropertyAccessExpression(node.left)) {
        const obj = evaluate(node.left.expression, env);
        if (obj !== null && typeof obj === "object" && Object.getPrototypeOf(obj) === Object.prototype) {
          (obj as Record<string, Val>)[node.left.name.text] = v;
          return v;
        }
      }
      return unsupported(node, "an assignment");
    }
    const l = evaluate(node.left, env);
    if (isUnknown(l)) return l;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) return l ? evaluate(node.right, env) : l;
    if (op === ts.SyntaxKind.BarBarToken) return l ? l : evaluate(node.right, env);
    if (op === ts.SyntaxKind.QuestionQuestionToken) return l ?? evaluate(node.right, env);
    const r = evaluate(node.right, env);
    if (isUnknown(r)) return r;
    if (op === ts.SyntaxKind.InKeyword) return r !== null && typeof r === "object" ? String(l) in (r as object) : unsupported(node, "in");
    if (!primitive(l) || !primitive(r)) {
      if (op === ts.SyntaxKind.EqualsEqualsEqualsToken) return l === r;
      if (op === ts.SyntaxKind.ExclamationEqualsEqualsToken) return l !== r;
      return unsupported(node, "an operator on a non-primitive");
    }
    const a = l as number, b = r as number;
    switch (op) {
      case ts.SyntaxKind.PlusToken: return (a as unknown as string) + (b as unknown as string);
      case ts.SyntaxKind.MinusToken: return a - b;
      case ts.SyntaxKind.AsteriskToken: return a * b;
      case ts.SyntaxKind.SlashToken: return a / b;
      case ts.SyntaxKind.PercentToken: return a % b;
      case ts.SyntaxKind.AsteriskAsteriskToken: return a ** b;
      case ts.SyntaxKind.EqualsEqualsEqualsToken: return a === b;
      case ts.SyntaxKind.ExclamationEqualsEqualsToken: return a !== b;
      case ts.SyntaxKind.EqualsEqualsToken: return a == b;
      case ts.SyntaxKind.ExclamationEqualsToken: return a != b;
      case ts.SyntaxKind.LessThanToken: return a < b;
      case ts.SyntaxKind.LessThanEqualsToken: return a <= b;
      case ts.SyntaxKind.GreaterThanToken: return a > b;
      case ts.SyntaxKind.GreaterThanEqualsToken: return a >= b;
      default: return unsupported(node, `the operator ${ts.SyntaxKind[op]}`);
    }
  }
  return unsupported(node, `the expression ${ts.SyntaxKind[node.kind]}`);
}

// ── the command tree ────────────────────────────────────────────────────────────────────────

const rootFile = path.join(CLI, "src/command.ts");
const rootMod = loadMod(rootFile);
const root = localValue(rootMod, "command", rootMod.sf);
if (!(root instanceof Cmd)) throw new Fatal(`apps/cli/src/command.ts: \`command\` is not a command: ${isUnknown(root) ? root.why : typeof root}`);

const childrenOf = (c: Cmd) => c.c.children.flatMap((ch) => (ch instanceof Cmd ? [ch] : ch.commands));
type Node = { path: string; cmd: Cmd; unlisted: boolean; hasChildren: boolean };
const nodes: Node[] = [];
const walk = (c: Cmd, words: string[], unlisted: boolean) => {
  for (const child of childrenOf(c)) {
    const p = [...words, child.c.name];
    const hidden = unlisted || child.c.unlisted;
    nodes.push({ path: p.join(" "), cmd: child, unlisted: hidden, hasChildren: childrenOf(child).length > 0 });
    walk(child, p, hidden);
  }
};
walk(root, [], false);
const byPath = new Map(nodes.map((n) => [n.path, n]));

const fileOf = (at: string) => at.replace(/:\d+$/, "");
const flagOut = (p: Param) => {
  if (p.p.hasDefault && p.p.default === null) throw new Fatal(`${p.p.name}: a null default`);
  const repeat = p.p.repeat;
  return {
    flag: `--${p.p.name}`,
    alias: p.p.aliases.length ? p.p.aliases.map((a) => (a.length === 1 ? `-${a}` : `--${a}`)).join(", ") : null,
    takesValue: p.p.type !== "boolean",
    type: p.p.type,
    choices: p.p.choices,
    metavar: p.p.metavar,
    // Effect requires a flag unless it is optional, has a default, is a switch, or repeats zero or more times.
    required: !(p.p.optional || p.p.hasDefault || p.p.type === "boolean" || (repeat !== null && repeat.min === 0)),
    default: p.p.hasDefault ? p.p.default : null,
    repeatable: repeat === null ? false : repeat,
    description: p.p.description,
  };
};
const argOut = (p: Param) => {
  const repeat = p.p.repeat;
  return {
    name: p.p.name,
    type: p.p.type,
    choices: p.p.choices,
    // Effect requires an argument unless it is optional or has a default, or is variadic with no minimum.
    required: !(p.p.optional || p.p.hasDefault) && (repeat === null || repeat.min > 0),
    variadic: repeat !== null,
    ...(repeat !== null ? { min: repeat.min, ...(repeat.max === undefined ? {} : { max: repeat.max }) } : {}),
    default: p.p.hasDefault ? p.p.default : null,
    description: p.p.description,
  };
};
const entryOf = (n: Node) => ({
  description: n.cmd.c.description,
  declaredIn: fileOf(n.cmd.c.at),
  ...(n.unlisted ? { unlisted: true } : {}),
  ...(n.hasChildren ? { group: true } : {}),
  ...(n.cmd.c.alias ? { alias: n.cmd.c.alias } : {}),
  arguments: n.cmd.c.params.filter((p) => p.p.kind === "argument").map(argOut),
  flags: n.cmd.c.params.filter((p) => p.p.kind === "flag").map(flagOut),
});

// ── the global flags ────────────────────────────────────────────────────────────────────────

const declaredGlobals = root.c.globals.map((g) => ({ setting: g.name, ...flagOut(g.flag) }));
const proofsDir = path.join(ROOT, "apps/docs/factory/proofs");
type Printed = { name: string; aliases: string[]; type: string; required: boolean; description: string | null };
const runStamp = (file: string) => file.match(/run-(\d{8}T\d{6})/)?.[1] ?? "";
const printedRuns: { file: string; globals: Printed[] }[] = [];
for (const file of fs.readdirSync(proofsDir).filter((f) => f.endsWith(".json")).sort()) {
  const found: Printed[][] = [];
  const visit = (x: Val) => {
    if (Array.isArray(x)) return x.forEach(visit);
    if (x === null || typeof x !== "object") return;
    const o = x as Record<string, Val>;
    if (o.command === "schema" && o.outcome === "succeeded" && o.data && typeof o.data === "object" && Array.isArray((o.data as Record<string, Val>).globalFlags))
      found.push((o.data as { globalFlags: Printed[] }).globalFlags);
    Object.values(o).forEach(visit);
  };
  visit(readJson(path.join(proofsDir, file)));
  for (const g of found) printedRuns.push({ file, globals: g });
}
if (!printedRuns.length) throw new Fatal("no `capxul schema` result with globalFlags in apps/docs/factory/proofs");
printedRuns.sort((a, b) => runStamp(a.file).localeCompare(runStamp(b.file)) || a.file.localeCompare(b.file));
const newest = printedRuns[printedRuns.length - 1];
const disagreeing = printedRuns.filter((r) => JSON.stringify(r.globals) !== JSON.stringify(newest.globals)).length;
const declaredNames = new Set(declaredGlobals.map((g) => g.flag));
const builtInGlobals = newest.globals.filter((g) => !declaredNames.has(g.name)).map((g) => ({
  flag: g.name,
  alias: g.aliases.length ? g.aliases.join(", ") : null,
  printedType: g.type,
  required: g.required,
  description: g.description,
}));
// The printed result must agree with what the source declares for the CLI's own six.
const globalProblems: string[] = [];
for (const d of declaredGlobals) {
  const p = newest.globals.find((g) => g.name === d.flag);
  if (!p) { globalProblems.push(`${d.flag} is declared but not printed`); continue; }
  const printedType = d.metavar ?? d.type;
  if (p.type !== printedType) globalProblems.push(`${d.flag}: printed type ${p.type}, declared ${printedType}`);
  if (p.description !== d.description) globalProblems.push(`${d.flag}: printed description differs`);
  if (p.required !== d.required) globalProblems.push(`${d.flag}: printed required ${p.required}, declared ${d.required}`);
}
if (globalProblems.length) throw new Fatal(`the printed global flags disagree with the source: ${globalProblems.join("; ")}`);

// ── matching the frozen commands ────────────────────────────────────────────────────────────

const ids = Object.keys(frozen).sort();
const frozenCommands = new Map(ids.map((id) => [(frozen as Record<string, { command: string }>)[id].command, id]));
const commands: Record<string, Val> = {};
const notInCli: string[] = [];
for (const id of ids) {
  const command = (frozen as Record<string, { command: string }>)[id].command;
  const n = byPath.get(command);
  if (!n) { notInCli.push(id); commands[id] = { command, inCli: false }; continue; }
  commands[id] = { command, inCli: true, ...entryOf(n) };
}
const notFrozen = nodes.filter((n) => !frozenCommands.has(n.path) && !(n.hasChildren && !n.cmd.c.params.length && nodes.some((m) => m.path.startsWith(n.path + " ") && frozenCommands.has(m.path))));
const notFrozenRunnable = nodes.filter((n) => !frozenCommands.has(n.path));

// A flag the frozen designed (v4) block lists that the CLI does not declare on that command.
type Designed = { flags?: { flag: string }[] } | null;
const designedOnly: { id: string; flag: string }[] = [];
const globalNames = new Set([...declaredGlobals.map((g) => g.flag), ...builtInGlobals.map((g) => g.flag)]);
for (const id of ids) {
  const designed = (frozen as Record<string, { designed: Designed }>)[id].designed;
  const entry = commands[id] as { inCli: boolean; flags?: { flag: string }[] };
  const own = new Set((entry.flags ?? []).map((f) => f.flag));
  for (const row of designed?.flags ?? []) {
    for (const token of row.flag.match(/`(--?[a-z][a-z0-9-]*)/g) ?? []) {
      const flag = token.slice(1);
      if (!own.has(flag) && !globalNames.has(flag)) designedOnly.push({ id, flag });
    }
  }
}

// ── the file ────────────────────────────────────────────────────────────────────────────────

const body = {
  globalFlags: { declared: declaredGlobals, builtIn: builtInGlobals },
  commands,
};
const json = JSON.stringify(body, null, 2);
const lines = [
  "// GENERATED by tools/freeze-flags.ts from the old CLI. Do not edit: regenerate.",
  "//   node --experimental-strip-types tools/freeze-flags.ts /home/user/factory books/frozen/flags.ts",
  "// The arguments and flags of every frozen command, as apps/cli/src declares them with Effect CLI, and",
  "// the global flags every command takes (policy P10: the CLI's flags are frozen surface). `declared`",
  "// global flags are read from the source (`Command.withGlobalFlags` in apps/cli/src/command.ts);",
  "// `builtIn` ones are Effect's own, as the old CLI printed them in the newest recorded",
  `// \`capxul schema\` result (apps/docs/factory/proofs/${newest.file}).`,
  "// A frozen command with `inCli: false` is one the old CLI never declared.",
  "",
  `export const frozenFlagBook = ${json} as const;`,
  "",
  "export type FrozenFlagEntry = (typeof frozenFlagBook.commands)[keyof typeof frozenFlagBook.commands];",
  "",
];
fs.writeFileSync(OUT, lines.join("\n"));

// ── the report ──────────────────────────────────────────────────────────────────────────────

const inCli = ids.length - notInCli.length;
const flagCount = ids.reduce((s, id) => s + (((commands[id] as { flags?: unknown[] }).flags ?? []).length), 0);
const argCount = ids.reduce((s, id) => s + (((commands[id] as { arguments?: unknown[] }).arguments ?? []).length), 0);
console.log(`${ids.length} frozen commands: ${inCli} in the CLI with ${argCount} arguments and ${flagCount} flags; ${notInCli.length} the CLI does not have.`);
console.log(`${declaredGlobals.length} declared global flags (checked against the printed schema), ${builtInGlobals.length} built-in; ${printedRuns.length} recorded schema results, ${disagreeing} differing from the newest.`);
console.log(`${nodes.length} CLI command paths; ${notFrozenRunnable.length} not frozen (${notFrozen.length} excluding groups that only hold frozen commands).`);
for (const id of notInCli) console.log(`frozen-not-in-cli ${id} (${(frozen as Record<string, { command: string }>)[id].command})`);
for (const n of notFrozen) console.log(`cli-not-frozen ${n.path}${n.unlisted ? " (unlisted)" : ""}${n.hasChildren ? " (group)" : ""} ${fileOf(n.cmd.c.at)}`);
for (const d of designedOnly) console.log(`designed-flag-not-in-cli ${d.id} ${d.flag}`);
