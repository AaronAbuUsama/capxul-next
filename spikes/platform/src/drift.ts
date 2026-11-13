// The platform's drift check: what the pinned Alchemy sees, plus the one thing it cannot.
//
// 1. Settings: Alchemy's own drift scan (Alchemist.Drift.scan). It re-reads every resource of the stage and compares
//    what it reads with what the last deploy recorded: a container that is stopped or gone, a DNS record whose
//    content or flags changed, a volume or network that is missing, a tunnel configuration with a new version.
// 2. Code: for every container the stage recorded, `docker diff` against its image, keeping only paths that hold code
//    (the site door, the bench's apps and its Python environment). Alchemy's container read reports the image the
//    container was created from, not what is in it now, so code changed inside a running container is invisible to
//    step 1, as Worker code replaced by hand was in spikes/state. Compiled-Python caches are ignored.
//
// The result is clean only when both are. The pinned `alchemy drift` exits 0 even when it finds drift; the entry
// (src/run-drift.ts) exits 2.
import * as Alchemist from "alchemy/Alchemist";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { STACK } from "./names.ts";

const CODE_ROOTS = ["/opt/door/", "/home/frappe/frappe-bench/apps/", "/home/frappe/frappe-bench/env/"];
const IGNORED = /(__pycache__|\.pyc$)/;

const Recorded = Schema.Struct({ context: Schema.String, containers: Schema.Array(Schema.String) });

export interface DriftReport {
  readonly stage: string;
  readonly clean: boolean;
  readonly settings: ReadonlyArray<{ fqn: string; status: string; reason?: string | undefined }>;
  readonly code: ReadonlyArray<{ container: string; changed: ReadonlyArray<string> }>;
}

/** Runs a command and returns its exit code and standard output. */
const run = (command: string, args: ReadonlyArray<string>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const child = yield* spawner.spawn(ChildProcess.make(command, [...args], { stdout: "pipe", stderr: "ignore" }));
      const stdout = yield* child.stdout.pipe(Stream.decodeText, Stream.mkString);
      return { exitCode: Number(yield* child.exitCode), stdout };
    }),
  );

/**
 * Code files changed in one container since it was created from its image. `docker diff` lists every changed path,
 * directories included; only leaves are kept (a directory is listed when a file under it changed), so a directory
 * whose only change is a new Python cache does not count.
 */
const codeChanges = (context: string, container: string) =>
  Effect.map(run("docker", ["--context", context, "diff", container]), ({ exitCode, stdout }) => {
    if (exitCode !== 0) return ["(docker diff failed: the container is not there)"];
    const entries = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^[ACD] \//.test(line));
    const paths = entries.map((line) => line.slice(2));
    const isLeaf = (path: string) => !paths.some((other) => other.startsWith(`${path}/`));
    return entries.filter((line) => {
      const path = line.slice(2);
      return CODE_ROOTS.some((root) => path.startsWith(root)) && !IGNORED.test(path) && isLeaf(path);
    });
  });

export const check = (entrypoint: string, stage: string) =>
  Effect.gen(function* () {
    const stack = yield* Alchemist.importStack(entrypoint);
    const scan = yield* Alchemist.Drift.scan({ stack, stage });
    const settings = scan.resources.map(({ fqn, status, reason }) => ({ fqn, status, reason }));
    const recorded = yield* Effect.scoped(
      Effect.gen(function* () {
        const state = yield* Alchemist.State.store({ type: "configured", entrypoint });
        return yield* state.getOutput({ stack: STACK, stage });
      }),
    ).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Recorded)));
    const code = yield* Effect.forEach(
      recorded.containers,
      (container) => Effect.map(codeChanges(recorded.context, container), (changed) => ({ container, changed })),
      { concurrency: 4 },
    );
    const changedCode = code.filter((c) => c.changed.length > 0);
    return {
      stage,
      clean: !Alchemist.Drift.hasDrift(scan) && changedCode.length === 0,
      settings: settings.filter((s) => s.status !== "in-sync"),
      code: changedCode,
    } satisfies DriftReport;
  });
