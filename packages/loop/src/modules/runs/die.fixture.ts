// Played in a child process by runs.test.ts: three steps, and the process kills itself (SIGKILL, no cleanup) inside step b the first time.
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createModels } from "@earendil-works/pi-ai/models";
import { openHost } from "../agents/service.ts";
import { play, type Run } from "./service.ts";

export const script = (counter: string, marker: string) => async (run: Run): Promise<void> => {
  for (const n of ["a", "b", "c"]) {
    await run.step(n, async () => {
      appendFileSync(counter, `${n}\n`);
      if (n === "b" && !existsSync(marker)) { writeFileSync(marker, ""); process.kill(process.pid, "SIGKILL"); }
      return n;
    });
  }
  await run.end("ready", ["done"]);
};

export const open = (dir: string) => () => openHost({ file: join(dir, "run.sqlite"), models: createModels(), env: {}, policy: { bash: { write: [], read: [] }, denyWrite: [] } });

if (process.argv[2] === "child") {
  const [dir, counter, marker] = process.argv.slice(3) as [string, string, string];
  await play({ dir, id: "r1", subject: "t", open: open(dir), script: script(counter, marker) });
}
