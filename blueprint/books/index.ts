import * as refusalGaps from "./refusal-gaps.ts";
import * as stateGaps from "./state-gaps.ts";
// Books' records: its tables, machines and events, its door (the money-fact procedures), one file
// per area (annotations, assets, facts), its durable work (the added-token scan), its operations
// and its decisions. The chart of accounts, the cost centres and the entries are ERPNext's, on each
// Organization's site (books.chart-owner); nothing here holds a copy of them.

import * as data from "./data.ts";
import * as procedures from "./procedures.ts";
import * as annotations from "./annotations.ts";
import * as assets from "./assets.ts";
import * as facts from "./facts.ts";
import * as processes from "./processes.ts";
import * as operations from "./operations.ts";
import * as decisions from "./decisions.ts";

export const modules = [refusalGaps, stateGaps,
  data,
  procedures,
  annotations,
  assets,
  facts,
  processes,
  operations,
  decisions,
] as const;
