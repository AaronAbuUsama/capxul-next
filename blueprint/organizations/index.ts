// The organizations concept's modules, for blueprint/index.ts (the shape of shared/index.ts).

import * as data from "./data.ts";
import * as procedures from "./procedures.ts";
import * as setups from "./setups.ts";
import * as workspaces from "./workspaces.ts";
import * as members from "./members.ts";
import * as invitations from "./invitations.ts";
import * as apps from "./apps.ts";
import * as processes from "./processes.ts";
import * as flows from "./flows.ts";
import * as operations from "./operations.ts";
import * as decisions from "./decisions.ts";

export const modules = [
  data,
  procedures,
  setups,
  workspaces,
  members,
  invitations,
  apps,
  processes,
  flows,
  operations,
  decisions,
] as const;
