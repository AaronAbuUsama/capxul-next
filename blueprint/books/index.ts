import * as stateGaps from "./state-gaps.ts";
// Books' records for the target book: its tables, machines and events, its door, one file per
// area (the chart, annotations, assets, facts, the feed, reports, the export), its durable work
// (the price sync, the added-token scan and the head sync), its Core SDK flows, its 17 operations
// and its decisions. frappe.ts holds the ERPNext document shapes the feed and the head sync hand a
// head; it has no records.

import * as data from "./data.ts";
import * as procedures from "./procedures.ts";
import * as annotations from "./annotations.ts";
import * as assets from "./assets.ts";
import * as facts from "./facts.ts";
import * as processes from "./processes.ts";
import * as operations from "./operations.ts";
import * as decisions from "./decisions.ts";

export const modules = [stateGaps,
  data,
  procedures,
  annotations,
  assets,
  facts,
  processes,
  operations,
  decisions,
] as const;
