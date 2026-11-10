/**
 * GENERIC. Durable agents over pi-durable: open a storage, register the coding tools with a policy that confines them to
 * a directory, pick a model, ask one agent one question and get its last message back. Nothing here knows about Capxul;
 * this module is what would be lifted into a library (README.md).
 */
import type { Context } from "@earendil-works/chord";
import type { Models } from "@earendil-works/pi-ai";
import type { Conversation, Extension, Harness, Registry, Submission, ToolRegistration } from "@earendil-works/pi-durable";

/** A model entry as `~/.pi/agent/models.json` writes it; the fields are pi-ai's `Model`. */
export interface ModelEntry { id: string; name?: string; reasoning?: boolean; input?: ("text" | "image")[]; cost?: { input: number; output: number; cacheRead: number; cacheWrite: number }; contextWindow?: number; maxTokens?: number; compat?: Record<string, unknown> }
/** An OpenAI-compatible provider: the endpoint, the NAME of the variable that holds its key (null when the endpoint needs none), its models. */
export interface ProviderConfig { baseUrl: string; apiKeyEnv: string | null; models: ModelEntry[] }

/** Which tools an agent gets: `write` is read, write, edit and a limited bash; `read` is read and a bash that only reads git. */
export type Profile = "write" | "read";

/** The confinement policy (README: it is a policy on tool calls, not a security boundary). */
export interface Policy {
  /** A bash command is run only if every `&&`/`;`/`|` segment of it matches one of these. */
  readonly bash: Record<Profile, readonly RegExp[]>;
  /** Paths (relative to the directory) the file tools may not write even inside it. */
  readonly denyWrite: readonly RegExp[];
  /** Tools beyond the coding ones that an agent may call, by name. Each is its own guard: the policy only lets it through. */
  readonly tools?: readonly string[];
  /** What to do instead, added to the refusal of a command that matches: so a refused agent does not try the same thing another way. */
  readonly hints?: readonly (readonly [RegExp, string])[];
}

export interface HostOptions {
  /** The SQLite file of the run: everything durable lives in it. */
  readonly file: string;
  readonly models: Models;
  /** The environment agents' commands see, and nothing else: no inherited variables. */
  readonly env: Readonly<Record<string, string>>;
  readonly policy: Policy;
  /** Look without driving: opens the storage for reading, recovers nothing, writes nothing. */
  readonly readOnly?: boolean;
  /** pi's own retries of one model request: how many, and the first wait in milliseconds (it doubles). Default 3 and 2,000. */
  readonly retry?: { readonly maxRetries: number; readonly baseDelayMs: number };
}

export interface Host { readonly harness: Harness; readonly registry: Registry; readonly parts: Readonly<Record<Profile, { extensions: Extension[]; tools: ToolRegistration[] }>>; readonly root: Conversation; readonly context: Context; /** Notes sent to an agent that `ask` has yet to see settle, by the agent's key. */ readonly notes: Map<string, Submission[]>; close(): Promise<void> }

export interface Ask {
  /** Names the agent within the run. The same key after a restart finds the same conversation and the same question. */
  readonly key: string;
  /** `provider/id`, as the models config names it. */
  readonly model: string;
  readonly system: string;
  readonly prompt: string;
  readonly cwd: string;
  readonly profile: Profile;
  readonly maxTurns?: number;
  readonly timeoutMs?: number;
  /** When this file exists the agent is aborted and the call rejects with `stopped`. */
  readonly stopFile?: string;
  /**
   * When the model fails beyond pi's own retries (a gateway that is down), wait this long and continue the same
   * conversation, once per entry. Empty or absent: a model failure is the answer.
   */
  readonly modelWaitsMs?: readonly number[];
  /** Tools beyond the coding ones, for example an MCP server's (`mcpTools`). */
  readonly tools?: readonly ToolRegistration[];
}

/** `detail` says more about an `error` when the harness knows it: the gateway's own message for a model failure. */
export interface Answer { ok: boolean; text: string; json?: unknown; costUsd: number; tokens: number; conversation: number; error?: string; detail?: string }

/** A note from a person to a working agent. `steer` joins after its current tool call; `queue` waits for its turn to end. */
export interface Note { readonly key: string; readonly text: string; readonly mode: "steer" | "queue" }
