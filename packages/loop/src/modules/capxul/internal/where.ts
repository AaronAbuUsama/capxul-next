/** Where a checkout's runs are, and the folder of one of them. Asking for a run that is not there is an error with its name, never a new folder. */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "../types.ts";

/** Working data, git-ignored, out of the top level; or the folder `LOOP_RUNS` names (a reader can look at another checkout's). */
export const runsDir = (ctx: Ctx): string => ctx.env.LOOP_RUNS ?? join(ctx.root, "var", "runs");
export const baseOf = (ctx: Ctx): string => ctx.env.LOOP_BASE ?? "integration/build";

/** The folder of an existing run. Throws, naming the run and where it was looked for, when there is none. */
export const runDir = (ctx: Ctx, id: string): string => {
  const dir = join(runsDir(ctx), id);
  if (id === "" || !existsSync(join(dir, "status.json"))) throw new Error(`there is no run ${id === "" ? "(no id given)" : id} in ${runsDir(ctx)}; \`pnpm loop status\` lists the runs`);
  return dir;
};
