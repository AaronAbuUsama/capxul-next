// The shared records of the target book: the system, components, concepts, environments, errors,
// integrations, contracts and the architecture's decisions; landings.ts maps every old area onto
// them. books/target/index.ts adds each concept's records to these.

import * as foundation from "./foundation.ts";
import * as vocabulary from "./vocabulary.ts";
import * as external from "./external.ts";
import * as decisions from "./decisions.ts";
import * as landings from "./landings.ts";
import * as tooling from "./tooling.ts";
import * as portal from "./portal.ts";
import * as swarm from "./swarm.ts";
import * as time from "./time.ts";

/** Records carried by a parent (a machine's transitions, an integration's calls, a contract's parts) come with it. */
const CHILDREN = new Set(["transition", "call", "function", "chainEvent"]);

/** A module's exported records, once each. Plain exports (OPERATION_OWNERS, CONCEPTS) are not records. */
export const recordsOf = (modules: readonly object[]): unknown[] => [
  ...new Set(
    modules
      .flatMap((m) => Object.values(m as Record<string, unknown>))
      .filter(
        (u) =>
          typeof u === "object" && u !== null && !Array.isArray(u) && "_kind" in u && "id" in u &&
          typeof (u as { id: unknown }).id === "string" && !CHILDREN.has((u as { _kind: string })._kind),
      ),
  ),
];

export const sharedModules = [foundation, vocabulary, external, decisions, landings, tooling, portal, swarm, time] as const;
export const sharedRecords = recordsOf(sharedModules);
