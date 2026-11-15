// Every producer of our telemetry (docs/design/blueprint.md, part 10): each process's `service.name`, the one
// attribute of its resource that says who it is. Each name uses the glossary's word (part 12), with today's word
// beside it while the renames run (roadmap item 3.8). Generated from it, later: each process's resource, with the
// schema URL of ./conventions.ts.

/** One producer. */
export interface Producer {
  /** Its `service.name`. */
  readonly service: string;
  /** What it is, in the glossary's words. */
  readonly is: string;
  /** What it is called today, where that differs. */
  readonly today: string | null;
}

/** Every producer, by a short name code uses (`Producers.producers.api.service`). */
export const producers = {
  api: {
    service: "capxul-api",
    is: "the server that carries out a world's operations",
    today: "Core (packages/core)",
  },
  runner: { service: "capxul-runner", is: "what runs and judges journeys", today: null },
  world: {
    service: "capxul-world",
    is: "what makes, resets and destroys worlds, and serves the account's world operations",
    today: null,
  },
  sites: {
    service: "capxul-sites-client",
    is: "the client of the site service, which makes, takes, saves and resets company sites",
    today: "the platform client (packages/platform)",
  },
  sdk: { service: "capxul-sdk", is: "the typed client of a world's endpoint", today: null },
  cli: { service: "capxul-cli", is: "the command line, Capxul's one surface", today: null },
  collector: {
    service: "capxul-collector",
    is: "where telemetry is sent, stamped and routed to the sink",
    today: "the telemetry door",
  },
  cost: { service: "capxul-cost", is: "the daily cost job", today: null },
  gate: { service: "capxul-gate", is: "the pass every pull request clears, rungs 1 to 5", today: "pnpm check" },
  agents: {
    service: "claude-code",
    is: "an agent's cloud session, whose telemetry Claude Code exports itself (decision T6)",
    today: null,
  },
} as const satisfies { readonly [short: string]: Producer };
