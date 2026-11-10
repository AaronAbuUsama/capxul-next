// The world's durable processes: making a world (the supervisor does the heavy work, the process records it), and parking a hosted world's idle sites.

import { budget, defineWorkflow } from "../../../packages/book/src/index.ts";
import { concept_devnet } from "../shared/foundation.ts";
import { integration_devnet_control } from "../shared/external.ts";
import { integration_site_service } from "../plugs/integrations.ts";
import { rpc_devnet_worlds_create } from "./world-rpcs.ts";
import { machine_world, table_command_records, table_world_registrations, table_worlds } from "./world-data.ts";

const NOTE = "docs/mission/worlds.md";

export const workflow_devnet_worlds_create = defineWorkflow({
  id: "devnet.worlds.create",
  title: "Bring a new world up: chain, service, clock, record, stand-ins",
  about:
    "Started by `world create`. One process per world: it asks the supervisor to make the chain instance (from the template's saved chain state, or with the contracts deployed, 25 s in the old product), the service and its Postgres, the clock in the mode and " +
    "rate asked, the record's first entry `born` (naming the parent when the world is a restore), the stand-ins (mail sink, Bridge, prices) and the people's and agents' keys; then moves the world to running. If the template has a site backup per company, " +
    "each is restored under the new address. A world that does not come up stays creating with the reason and can be made again; nothing it made is shared with another world (devnet.worlds-never-see-each-other).",
  concept: concept_devnet,
  priority: "critical",
  trigger: { after: rpc_devnet_worlds_create },
  instance: { per: table_worlds },
  steps: [
    { name: "make", about: "Asks the supervisor to make the chain, service, clock and stand-ins." },
    { name: "born", about: "Appends the record's `born` entry with the parent, if any." },
    { name: "start", about: "Moves the world to running." },
  ],
  reads: [table_worlds],
  writes: [table_worlds, table_command_records],
  drives: [machine_world.t.start],
  invokes: [],
  emits: [],
  calls: [integration_devnet_control.c.worldCreate],
  chain: [],
  idempotency: "One process per world id; the supervisor's creation is idempotent by id.",
  timeoutMs: 180_000,
  retries: { max: 2, backoff: "fixed" },
  budget: budget("background"),
  was: [`${NOTE} (section 4)`],
});

export const workflow_devnet_worlds_park_idle = defineWorkflow({
  id: "devnet.worlds.park-idle",
  title: "Park a hosted world's idle sites",
  about:
    "A hosted world that has made no call for the stated time (30 minutes, an assumption to be measured) has its sites parked: the bench stops serving them and keeps their data, and the next call wakes them. This is what lets a developer's local devnet " +
    "keep companies on the hosted bench without paying for idle ones. It never touches a world that is not registered, and never parks a world with a running clock that a viewer is watching.",
  concept: concept_devnet,
  priority: "normal",
  trigger: { cron: "*/10 * * * *" },
  instance: "singleton",
  steps: [
    { name: "find", about: "Finds registered worlds idle past the time." },
    { name: "park", about: "Asks the site service to park their sites and marks the world parked." },
  ],
  reads: [table_worlds, table_world_registrations],
  writes: [table_worlds, table_world_registrations],
  drives: [machine_world.t.park],
  invokes: [],
  emits: [],
  calls: [integration_site_service.c.parkSites],
  chain: [],
  idempotency: "A parked world is not parked again.",
  timeoutMs: 120_000,
  retries: { max: 2, backoff: "fixed" },
  budget: budget("background"),
  was: ["books/target/plugs/decisions.ts (plugs.service-calls-site)"],
});
