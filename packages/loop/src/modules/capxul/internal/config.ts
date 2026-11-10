/** What is Capxul's about the agents: what their shell may run, what they may not write, which models and where the keys are looked for. */
import type { Models } from "@earendil-works/pi-ai";
import { modelsFrom, type Policy } from "../../agents/service.ts";
import type { Ctx } from "../types.ts";

const FILES = /^(ls|cat|head|tail|wc|nl|grep|sort|diff|echo|pwd)( |$)/;
/**
 * Commands that only read, which the agents asked for and were refused on 10 November 2026 (54 of 256 calls in four runs):
 * `rg` (never with a preprocessor, which runs a program), `sed -n` printing a range of lines, `find` without an action
 * that runs or deletes, and the parts of git that only look.
 */
const READS: readonly RegExp[] = [
  /^rg (?!.*--(pre|pre-glob|hostname-bin)\b)/,
  /^sed -n (['"]?)[0-9,$]+p\1( [A-Za-z0-9_.\/-]+)+$/,
  /^find (?!.*-(exec|execdir|ok|okdir|delete|fls|fprint\w*)\b)/,
  /^git (diff|log|show|status|rev-parse|ls-files|merge-base|blame)( |$)/,   // not `git grep`: its -O opens a program
];

/** `pnpm exec` and `node` can run anything the user can: the list limits what the model asks for, it is not a sandbox (README). */
export const POLICY: Policy = {
  bash: {
    write: [/^pnpm (-s |--silent )?(exec|test|run|check|plan|book|blueprint|frozen|layout|tasks|judgments|evals|evals:check|portal:check|contracts:[a-z-]+|devnet:test|sdk:test)( |$)/, /^node( |$)/, /^git (add|commit|mv|rm)( |$)/,
      /^rm( -f)?(?!.* (books\/frozen|blueprint\/baseline|var)\/)(?!.*\/(src\/generated|\.git|\.claude)\/)( [A-Za-z0-9_][A-Za-z0-9_.\/-]*)+$/,   // its own scratch files, by plain relative name: never -r, a dash, a dot or a protected folder
      ...READS, FILES, /^mkdir( |$)/, /^cd [A-Za-z0-9_./-]+$/],
    read: [...READS, FILES],
  },
  denyWrite: [/^books\/frozen\//, /^blueprint\/baseline\//, /(^|\/)src\/generated\//, /^\.git(\/|$)/, /^\.claude\//, /^var\//],
};

/**
 * The maker's and the checker's default models. The maker is gpt-6.1-sol and the checker gpt-6.1-terra, by Aaron's ruling (10 November
 * 2026: Sol 6.1 for coding; only Sol 6.1 and Terra 6.1 allowed). Both are flags.
 */
export const MAKER_MODEL = "gpt-6.1-sol";
export const CHECKER_MODEL = "gpt-6.1-terra";

/** Aaron, 10 November 2026: only gpt-6.1-sol and gpt-6.1-terra are allowed. Anything else is refused before a call is made. */
export const ALLOWED_MODELS = ["gpt-6.1-sol", "gpt-6.1-terra"] as const;
export const allowedModel = (id: string): boolean => !id.startsWith("gateway/") || ALLOWED_MODELS.some((m) => id === `gateway/${m}`); // a test's fake provider is not the gateway

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
