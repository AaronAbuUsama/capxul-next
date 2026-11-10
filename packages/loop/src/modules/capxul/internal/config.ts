/** What is Capxul's about the agents: what their shell may run, what they may not write, which models and where the keys are looked for. */
import type { Models } from "@earendil-works/pi-ai";
import { modelsFrom, type Policy } from "../../agents/service.ts";
import type { Ctx } from "../types.ts";

const FILES = /^(ls|cat|head|tail|wc|grep|sort|diff|mkdir|echo|pwd)( |$)/;

/** `pnpm exec` and `node` can run anything the user can: the list limits what the model asks for, it is not a sandbox (README). */
export const POLICY: Policy = {
  bash: {
    write: [/^pnpm (exec|test|run|check|plan|book|frozen|tasks|judgments|evals|portal:check|contracts:[a-z-]+|devnet:test|sdk:test)( |$)/, /^node( |$)/, /^git (status|diff|log|show|add|commit|mv|rm)( |$)/, FILES, /^cd [A-Za-z0-9_./-]+$/],
    read: [/^git (diff|log|show|status)( |$)/, FILES],
  },
  denyWrite: [/^books\/frozen\//, /(^|\/)src\/generated\//, /^\.git(\/|$)/, /^\.claude\//, /^runs\//],
};

/**
 * The maker's and the checker's default models. The maker is gpt-6.1-sol by Aaron's ruling (10 November 2026: "we need
 * to be using sol 6.1 for coding"). Both are flags.
 */
export const MAKER_MODEL = "gpt-6.1-sol";
export const CHECKER_MODEL = "gpt-6-luna";

/** Aaron, 10 November 2026: "we can only use 6.1 or 6.0 class models". Anything else is refused before a call is made. */
export const allowedModel = (id: string): boolean => !id.startsWith("gateway/") || /^gateway\/gpt-6(\.1)?-[a-z0-9-]+$/.test(id); // a test's fake provider is not the gateway

/** `provider/id`, or a bare id (taken to be the gateway's). */
export const qualify = (id: string): string => (id.includes("/") ? id : `gateway/${id}`);
export const defaultModel = (ctx: Ctx): string => qualify(ctx.env.LOOP_MODEL ?? MAKER_MODEL);
export const defaultCheckerModel = (ctx: Ctx): string => qualify(ctx.env.LOOP_CHECKER_MODEL ?? CHECKER_MODEL);

/**
 * The models: tests hand in a fake provider. Otherwise one OpenAI-compatible gateway (LOOP_MODEL_BASE_URL, default
 * https://llm.capxul.com/v1) whose key is read, when a request is made, from the environment variable named by
 * LOOP_MODEL_KEY_ENV (default LLM_ROUTER_API_KEY). The key is never stored, logged or written anywhere.
 */
export const modelsOf = (ctx: Ctx, wanted: readonly string[] = []): Models => {
  if (ctx.models) return ctx.models;
  const ids = [...new Set([...wanted, defaultModel(ctx), defaultCheckerModel(ctx)].map((m) => m.replace(/^gateway\//, "")))];
  return modelsFrom({ gateway: {
    baseUrl: ctx.env.LOOP_MODEL_BASE_URL ?? "https://llm.capxul.com/v1", apiKeyEnv: ctx.env.LOOP_MODEL_KEY_ENV ?? "LLM_ROUTER_API_KEY",
    models: ids.map((id) => ({ id, contextWindow: 200_000, maxTokens: 16_000, compat: { supportsStore: false, supportsDeveloperRole: false } })),
  } });
};
