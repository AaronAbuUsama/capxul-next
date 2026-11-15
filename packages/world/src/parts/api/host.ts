// Core run off Cloudflare, beside the machine that makes the world: a rehearsal's seam (packages/runner,
// `--core=local`). A world's Core normally is the Worker its stack deploys (Core.ts). A caller that provides a
// `CoreHost` runs it itself instead: the stack then deploys no Core Worker, the world's door is where the host says
// Core answers, and the host starts that Core once the world's parts exist and stops it when the world goes.
//
// Everything else of the world is unchanged: its database, chain, index, bundler and door are on Cloudflare and Neon.
// A Core run this way can reach a bench Cloudflare cannot, which is all it is for; it proves nothing about Core on
// Cloudflare.
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import type { World } from "../../things/world/values.ts";
import type { BenchGrant } from "../../stack/settings.ts";

/** What a hosted Core of one world is given: what a deploy would bind into the Worker (Core.ts). */
export interface HostedCore {
  readonly world: World;
  /** The token Core accepts as the owner operator's (decisions.md, 36). */
  readonly operatorToken: Redacted.Redacted;
  /** The world's bench and its site token there; none for a world with no bench. */
  readonly bench: Option.Option<BenchGrant>;
  /** The credential of the API user the site door makes on each of the world's sites. */
  readonly siteKey: Redacted.Redacted;
  readonly siteSecret: Redacted.Redacted;
}

export interface CoreHost {
  /** Where the Core of `stage` will answer, decided before the world is deployed, the same every time it is asked. */
  readonly urlOf: (stage: string) => Effect.Effect<string>;
  /** Starts the world's Core at the address `urlOf` gave. The world's `core` step then waits for it to answer. */
  readonly start: (core: HostedCore) => Effect.Effect<void, string>;
  /** Stops the world's Core, if it runs here. */
  readonly stop: (stage: string) => Effect.Effect<void>;
  /** What every record of a world made with this host must say about where its Core ran. */
  readonly label: string;
}

/** The host of every world's Core made in this program; none, as normal, when Core is the world's own Worker. */
export const CoreHost = Context.Reference<Option.Option<CoreHost>>("@capxul/world/parts/api/host/CoreHost", {
  defaultValue: () => Option.none(),
});
