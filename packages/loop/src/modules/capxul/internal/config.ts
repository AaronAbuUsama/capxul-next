/** What is Capxul's about the agents: what their shell may run, what they may not write, which models and where the keys are looked for. */
import type { Models } from "@earendil-works/pi-ai";
import { modelsFrom, type Policy, type Profile } from "../../agents/service.ts";
import { TOOL_NAMES } from "../../evidence/types.ts";
import { SANDBOX_TOOLS } from "./boxes.ts";
import type { Ctx } from "../types.ts";

const FILES = /^(ls|cat|head|tail|wc|nl|grep|sort|uniq|cut|tr|diff|echo|printf|pwd|true|basename|dirname|stat|du|jq)( |$)/;
/**
 * Commands that only read, which the agents asked for and were refused on 10 November 2026: `rg` (never with a
 * preprocessor, which runs a program), `sed -n` printing ranges of lines (of a file, or of what is piped to it), `find`
 * without an action that runs or deletes, and the parts of git that only look.
 */
const READS: readonly RegExp[] = [
  /^rg (?!.*--(pre|pre-glob|hostname-bin)\b)/,
  /^sed -n [0-9,$;p]+( [A-Za-z0-9_.\/@-]+)*$/,
  /^find (?!.*-(exec|execdir|ok|okdir|delete|fls|fprint\w*)\b)/,
  /^git (diff|log|show|status|rev-parse|ls-files|merge-base|blame|rev-list|cat-file|shortlog|describe)( |$)/,
  /^git branch( (--show-current|-a|-r|-v|-vv|--list|--contains|--merged|--no-merged)( [A-Za-z0-9_.\/-]+)*)?$/,
  /^git grep (?!.*(-O|--open-files-in-pager))/,
];

/**
 * The repository's own scripts an agent runs to do and check its work. Not `pnpm loop` (an agent does not drive the loop),
 * `pnpm portal`/`portal:serve` (a server) or `pnpm install` (the lane's dependencies are prepared before it starts).
 * `pnpm exec` and `node` can run anything the user can: the list limits what the model asks for, it is not a sandbox (README).
 */
const SCRIPTS = "test|check|plan|plan:check|plan:test|tasks|tasks:check|blueprint|book|frozen|layout|layout:test|judgments|evals|evals:check|evals:test|portal:check|loop:test|record:test|contracts:[a-z:-]+|devnet:test|sdk:test";
const RUNS: readonly RegExp[] = [
  new RegExp(`^pnpm (-s |--silent )?(exec|run (${SCRIPTS})|${SCRIPTS})( |$)`),
  /^pnpm (-s |--silent )?(--filter|-F) @?[A-Za-z0-9_.\/-]+ (test|check|build|typecheck|exec)( |$)/,
  /^node( |$)/,
];
/** Removing, copying or moving its own files, by plain relative names: never -r, a dash, a dot or a protected folder. */
const KEEP_OUT = String.raw`(?!.*(^| )(books\/frozen|blueprint\/baseline|var\/runs)\/)(?!.*\/(src\/generated|\.git|\.claude)\/)(?!.*(^| )(\.git|\.claude)(\/| |$))`;
const OWN_FILES = String.raw`( [A-Za-z0-9_][A-Za-z0-9_.\/@-]*)+$`;
const CD = /^cd [A-Za-z0-9_./-]+$/;
export const POLICY: Policy = {
  bash: {
    write: [...RUNS, /^git (add|commit|mv|rm|restore)( |$)/,
      new RegExp(`^rm( -f)?${KEEP_OUT}${OWN_FILES}`), new RegExp(`^(cp|mv)( -[fn])?${KEEP_OUT}${OWN_FILES}`),
      ...READS, FILES, /^mkdir( |$)/, /^touch( |$)/, CD],
    read: [...READS, FILES],
  },
  // var/ is the lane's own working data (the build writes var/blueprint); only the runs' storage under it is kept out
  denyWrite: [/^books\/frozen\//, /^blueprint\/baseline\//, /(^|\/)src\/generated\//, /^\.git(\/|$)/, /^\.claude\//, /^var\/runs(\/|$)/],
  tools: [...TOOL_NAMES, ...SANDBOX_TOOLS], // the capture tools (modules/evidence) and an agent's own boxes (boxes.ts): each checks its own arguments
  hints: [
    [/^pnpm (-s |--silent )?(--dir \S+ )?(install|i|add)( |$)/, "the lane's dependencies are installed before it starts; if one is missing, say so in your hand-back"],
    [/^python3?( |$)/, "use node for a script"],
    [/^pnpm (-s |--silent )?loop( |$)/, "an agent does not drive the loop"],
    [/^git (push|fetch|pull|checkout|switch|reset|rebase|merge)( |$)/, "the loop moves branches; commit your work in the lane"],
    [/^(curl|wget)( |$)/, "an agent has no network beyond its model"],
  ],
};

/**
 * What an agent may run through `record_terminal`. A maker: what its shell may run. A reader: the same programs a maker
 * runs (the lane's checks, node), though its own shell only reads. So a reader can try the thing it reviews, and
 * everything it runs is recorded; what that leaves in the lane is undone after it (internal/evidence.ts, `restore`).
 */
export const RECORD: Readonly<Record<Profile, readonly RegExp[]>> = { write: POLICY.bash.write, read: [...RUNS, ...READS, FILES, CD] };

/** What a shell may run, by the name an agent definition gives it (`shell`): `bash` for the tool, `record` for `record_terminal`. */
export const SHELLS: Readonly<Record<string, { readonly bash: readonly RegExp[]; readonly record: readonly RegExp[] }>> = {
  write: { bash: POLICY.bash.write, record: RECORD.write },
  read: { bash: POLICY.bash.read, record: RECORD.read },
};

/**
 * The maker's and the checker's default models. The maker is gpt-6.1-sol and the checker gpt-6.1-terra, by Aaron's ruling (10 November
 * 2026: Sol 6.1 for coding). Both are flags, and any model the gateway serves may be named. An agent's own model is in
 * its definition (`loops/agents/`); these two are what is allowed when the gateway cannot say what it serves.
 */
export const MAKER_MODEL = "gpt-6.1-sol";
export const CHECKER_MODEL = "gpt-6.1-terra";

/**
 * Which models may be used. Aaron's ruling of 10 November 2026, in his words to the coordinator: "it can use any model
 * the proxy serves" (it was only Sol 6.1 and Terra 6.1 earlier that day). So the gateway is asked what it serves, each time an agent starts; when it does
 * not answer, only the two defaults are allowed. A test's fake provider is not the gateway and is not asked about.
 */
export const DEFAULT_MODELS = [MAKER_MODEL, CHECKER_MODEL] as const;
export const servedModels = async (ctx: Ctx): Promise<readonly string[]> => {
  const gateway = gatewayOf(ctx), key = gateway.keyEnv === null ? undefined : ctx.env[gateway.keyEnv];
  try {
    const answer = await fetch(`${gateway.baseUrl.replace(/\/$/, "")}/models`, { signal: AbortSignal.timeout(5000), ...(key ? { headers: { authorization: `Bearer ${key}` } } : {}) });
    const listed = ((await answer.json()) as { data?: { id?: unknown }[] }).data?.flatMap((m) => (typeof m.id === "string" ? [m.id] : [])) ?? [];
    return answer.ok && listed.length > 0 ? listed : DEFAULT_MODELS;
  } catch { return DEFAULT_MODELS; }
};
export const allowedModel = async (ctx: Ctx, id: string): Promise<boolean> => !id.startsWith("gateway/") || (await servedModels(ctx)).includes(id.slice("gateway/".length));

/** `provider/id`, or a bare id (taken to be the gateway's). */
export const qualify = (id: string): string => (id.includes("/") ? id : `gateway/${id}`);
export const defaultModel = (ctx: Ctx): string => qualify(ctx.env.LOOP_MODEL ?? MAKER_MODEL);
export const defaultCheckerModel = (ctx: Ctx): string => qualify(ctx.env.LOOP_CHECKER_MODEL ?? CHECKER_MODEL);

/**
 * Every request carries `x-session-id`: pi-durable's own id of the conversation, one per agent of a run, the same after
 * a retry, a resume or a restart. A gateway that binds a session to one upstream account (CLIProxyAPI's
 * `routing.session-affinity`) keeps an agent on that account, so its prompt cache holds. pi-ai sends it only when
 * asked for an endpoint that is not OpenRouter; `openrouter` is the format whose header is the generic `x-session-id`.
 */
const SESSION = { sendSessionAffinityHeaders: true, sessionAffinityFormat: "openrouter" } as const;

/** A model gateway by name: where it is, and the NAME of the variable that holds its key, or null when it asks for none. */
export interface Gateway { readonly name: string; readonly baseUrl: string; readonly keyEnv: string | null }

/**
 * The gateways the loop knows. `local` is the CLI proxy that runs on this Mac (CLIProxyAPI, through VibeProxy), which
 * the owner allowed for the loop on 10 November 2026 and which asks for no key: it is the default. `router` is the
 * LiteLLM router the loop used before; the same ruling took it out of the loop's path, and it is here only by name.
 */
export const GATEWAYS: Readonly<Record<string, Omit<Gateway, "name">>> = {
  local: { baseUrl: "http://127.0.0.1:8317/v1", keyEnv: null },
  router: { baseUrl: "https://llm.capxul.com/v1", keyEnv: "LLM_ROUTER_API_KEY" },
};

/** The gateway this process uses: `LOOP_GATEWAY` names one (default `local`); `LOOP_MODEL_BASE_URL` and `LOOP_MODEL_KEY_ENV` still override its two parts. */
export const gatewayOf = (ctx: Ctx): Gateway => {
  const name = ctx.env.LOOP_GATEWAY ?? "local", known = GATEWAYS[name];
  if (!known) throw new Error(`there is no gateway named ${name}: LOOP_GATEWAY is one of ${Object.keys(GATEWAYS).join(", ")}`);
  return { name, baseUrl: ctx.env.LOOP_MODEL_BASE_URL ?? known.baseUrl, keyEnv: ctx.env.LOOP_MODEL_KEY_ENV ?? known.keyEnv };
};

/**
 * The models: tests hand in a fake provider. Otherwise the one OpenAI-compatible gateway `gatewayOf` names. Its key, when
 * it has one, is read from its variable when a request is made, and is never stored, logged or written anywhere.
 */
export const modelsOf = (ctx: Ctx, wanted: readonly string[] = []): Models => {
  if (ctx.models) return ctx.models;
  const ids = [...new Set([...wanted, defaultModel(ctx), defaultCheckerModel(ctx)].map((m) => m.replace(/^gateway\//, "")))];
  const gateway = gatewayOf(ctx);
  return modelsFrom({ gateway: {
    baseUrl: gateway.baseUrl, apiKeyEnv: gateway.keyEnv,
    models: ids.map((id) => ({ id, contextWindow: 200_000, maxTokens: 16_000, compat: { supportsStore: false, supportsDeveloperRole: false, ...SESSION } })),
  } });
};
