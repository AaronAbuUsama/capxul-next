/** Native Pi Durable 1.5.0 demo; no proposed @capxul/workflow APIs.
 * node --experimental-strip-types --no-warnings packages/loop/examples/structured-output.ts
 * Add --faux to prove invalid-argument rejection without a network call.
 * Uses its own temporary SQLite file and has no filesystem/shell tools.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { StringEnum } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import {
  createRegistry, defineDoc, defineExtension, defineTool, GenerationTask,
  Harness, hook, ToolResultEntry,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { arr, obj, str, type Static } from "@earendil-works/pi-schema";
import { modelsFrom } from "../src/modules/agents/internal/models.ts";

const schema = obj({
  agent: StringEnum(["Orpheus"]),
  verdict: StringEnum(["approve", "changes"]),
  findings: arr(str()),
  summary: str(),
});
type Review = Static<typeof schema>;
const Result = defineDoc<{ value: Review | null }>({
  kind: "demo.orpheus-result", version: 1, scope: "conversation",
  history: "latest", fork: "initial", initial: () => ({ value: null }),
  checkpointWhen: () => true,
});
const context = BACKGROUND_CONTEXT;
const fauxMode = process.argv.includes("--faux");
const modelId = "gpt-6.1-sol";
const keyName = process.env.LOOP_MODEL_KEY_ENV ?? "LLM_ROUTER_API_KEY";
if (!fauxMode && !process.env[keyName]) throw new Error(`Set ${keyName}, or run --faux.`);
const file = join(mkdtempSync(join(tmpdir(), "pi-orpheus-")), "run.sqlite");
let executions = 0;
const submit = defineTool({
  name: "submit_review",
  description: "Submit Orpheus's final review using the required schema.",
  parameters: schema,
  constrainedSampling: { type: "json_schema", strict: "require" },
  structuredOutputSchema: schema,
  replay: "safe",
  execute: async (args, api, ctx) => {
    executions++;
    // Tool arguments have already passed Pi's validation. Store a durable result.
    await api.commit(async tx => {
      (await tx.doc(Result, api.conversationId)).value = args;
    }, ctx);
    console.log(JSON.stringify({ event: "validated-result", value: args }));
    return {
      output: [{ type: "text", text: "Review recorded." }],
      structuredOutput: args,
      details: { result: args }, // structuredOutput itself is not in the transcript.
      control: { terminate: true },
    };
  },
});
const registry = createRegistry();
registry.install(defineExtension({
  name: "orpheus-demo",
  tools: [submit],
  hooks: [hook(GenerationTask, {
    afterResponse(message) {
      if (message.stopReason !== "error") return;
      const raw = message.errorMessage ?? "unknown model error";
      const secret = process.env[keyName];
      const error = secret ? raw.replaceAll(secret, "[redacted]") : raw;
      console.error(JSON.stringify({ event: "model-error", error: error.slice(0, 800) }));
    },
    beforeProviderRequest(request) {
      if (request.model.api !== "openai-completions") return;
      const payload = request.payload as {
        tools?: { function?: { name?: string; strict?: boolean } }[];
      };
      const tool = payload.tools?.find(t => t.function?.name === submit.name);
      console.log(JSON.stringify({ event: "provider-request", model: modelId,
        tool: submit.name, strict: tool?.function?.strict === true }));
      return { payload: { ...payload,
        tool_choice: { type: "function", function: { name: submit.name } } } };
    },
  })],
}));
const faux = fauxProvider();
const fauxModels = createModels();
const models = fauxMode ? fauxModels : modelsFrom({ gateway: {
  baseUrl: process.env.LOOP_MODEL_BASE_URL ?? "https://llm.capxul.com/v1",
  apiKeyEnv: keyName,
  models: [{ id: modelId, maxTokens: 1024, compat: {
    supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true,
  } }],
} });
if (fauxMode) {
  fauxModels.setProvider(faux.provider);
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall(submit.name, {
      agent: "Orpheus", verdict: "maybe", findings: [], summary: "Invalid verdict.",
    }), { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxToolCall(submit.name, {
      agent: "Orpheus", verdict: "approve", findings: [], summary: "Supplied checks pass.",
    }), { stopReason: "toolUse" }),
  ]);
}
let harness = await Harness.open(await openNodeSqliteStorage(file), {
  models, registry, identity: { attribution: null },
  settings: { retry: { maxRetries: 0 }, stream: { timeoutMs: 30_000, maxRetries: 0 } },
}, context);
console.log(JSON.stringify({ event: "demo", mode: fauxMode ? "faux" : "live", file }));
const deadline = setTimeout(() => { console.error("Demo exceeded 45 seconds."); process.exit(1); }, 45_000);
try {
  const agent = await harness.createConversation({ ownership: { kind: "ownerless" }, agent: {
    model: { provider: fauxMode ? "faux" : "gateway", modelId: fauxMode ? "faux-1" : modelId },
    instructions: "You are Orpheus. This is a tiny structured-output demonstration, not a repository review. Use submit_review for your final result.",
    maxTurns: 3, tools: [submit],
  } }, context);
  const input = await agent.submit({ type: "input", requestId: "review-1",
    content: "Supplied facts: all checks passed and no blocking findings exist. Submit an approve verdict, no findings, and a short summary. Set agent to Orpheus." }, context);
  const settled = await input.wait(context);
  console.log(JSON.stringify({ event: "submission-settled", status: settled.status,
    ...(settled.status !== "done" && "reason" in settled ? { reason: settled.reason } : {}) }));
  const saved = await harness.snapshot(Result, agent.id, context);
  assert.equal(saved?.value?.verdict, "approve", "No approved structured result was stored.");
  assert.equal(executions, 1);
  if (fauxMode) {
    const entries = (await agent.entries({}, 100, undefined, context)).items;
    const rejected = entries.filter(e => ToolResultEntry.is(e) && e.model?.[0]?.role === "toolResult" && e.model[0].isError).length;
    assert.equal(rejected, 1);
    console.log(JSON.stringify({ event: "invalid-arguments-rejected", rejected, executions }));
  }
  await harness.close(context);
  harness = await Harness.open(await openNodeSqliteStorage(file), { models, registry, readOnly: true }, context);
  const reopened = await harness.snapshot(Result, agent.id, context);
  assert.deepEqual(reopened, saved);
  console.log(JSON.stringify({ event: "sqlite-reopened", mode: fauxMode ? "faux" : "live",
    conversation: agent.id, file, value: reopened?.value }));
} finally {
  clearTimeout(deadline);
  await harness.close(context);
}
