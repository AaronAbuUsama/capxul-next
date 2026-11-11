import * as stateGaps from "./state-gaps.ts";
// The sites concept's modules, for blueprint/index.ts.

import * as data from "./data.ts";
import * as sites from "./sites.ts";
import * as door from "./door.ts";
import * as processes from "./processes.ts";
import * as operations from "./operations.ts";
import * as decisions from "./decisions.ts";
import * as evidence from "./evidence.ts";
import * as journeys from "./journeys.ts";
import * as thinLine from "./thin-line.ts";
import * as features from "./features.ts";
import * as watch from "./watch.ts";
import * as screens from "./screens.ts";

export const modules = [stateGaps, data, sites, door, processes, operations, decisions, evidence, journeys, thinLine, features, watch, screens] as const;
