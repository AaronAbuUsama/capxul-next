// Reads the plan's explanation files: plan/outline.md, plan/milestones/<id>.md and plan/tasks/<id>.md. The one place that
// lists them, shared by packages/plan/src/main.ts and the portal's loader. Reading only.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { PlanFiles } from "./modules/plan/types.ts";

const folder = (dir: string): Readonly<Record<string, string>> =>
  existsSync(dir)
    ? Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".md")).sort().map((f) => [f.slice(0, -3), readFileSync(join(dir, f), "utf8")] as const))
    : {};

/** The files under `root`/plan. */
export const planFilesOf = (root = "."): PlanFiles => ({
  outline: existsSync(join(root, "plan/outline.md")) ? readFileSync(join(root, "plan/outline.md"), "utf8") : null,
  milestones: folder(join(root, "plan/milestones")),
  tasks: folder(join(root, "plan/tasks")),
});
