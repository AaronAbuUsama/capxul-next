/** Model access: OpenAI-compatible providers from a config (the shape of `~/.pi/agent/models.json`), keys read by variable NAME. */
import { createModels, createProvider, envApiKeyAuth, type ApiKeyAuth, type Model, type Models } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { ProviderConfig } from "../types.ts";

/** An endpoint that asks for no key (a proxy on this machine): the client still sends one, and this is it. Nothing is read from anywhere. */
const noKey = (name: string): ApiKeyAuth => ({ name, resolve: async () => ({ auth: { apiKey: "no-key-needed" }, source: "this endpoint needs no key" }) });

/** Builds the `Models` for these providers. A key is resolved from its environment variable when a request is made, never stored. */
export const modelsFrom = (providers: Readonly<Record<string, ProviderConfig>>): Models => {
  const models = createModels();
  for (const [id, p] of Object.entries(providers)) {
    const list = p.models.map((m): Model<"openai-completions"> => ({
      id: m.id, name: m.name ?? m.id, api: "openai-completions", provider: id, baseUrl: p.baseUrl, reasoning: m.reasoning ?? false, input: m.input ?? ["text"],
      cost: m.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: m.contextWindow ?? 128_000, maxTokens: m.maxTokens ?? 16_000, ...(m.compat ? { compat: m.compat } : {}),
    }));
    models.setProvider(createProvider({ id, name: id, baseUrl: p.baseUrl, auth: { apiKey: p.apiKeyEnv === null ? noKey(id) : envApiKeyAuth(id, [p.apiKeyEnv]) }, models: list, api: openAICompletionsApi() }));
  }
  return models;
};

