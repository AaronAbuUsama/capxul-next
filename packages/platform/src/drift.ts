// The platform's drift check: what the pinned Alchemy sees, plus the one thing it cannot.
//
// 1. Settings: Alchemy's own drift scan (Alchemist.Drift.scan) of every stack the platform is made of: the platform
//    (alchemy.run.ts) and, on AWS, the bench host (host.run.ts). It re-reads every resource of the stage and compares
//    it with what the last deploy recorded: a container stopped or gone, a DNS record edited, a volume or network
//    missing, a new version of the tunnel's ingress, an inbound rule added to the security group, a machine resized.
// 2. Code: for every container the platform recorded, `docker diff` against its image (src/code-drift.ts). Alchemy's
//    container read reports the image a container was made from, not what is in it now, so code replaced inside a
//    running container is invisible to step 1, as Worker code replaced by hand was in spikes/state.
//
// The check is clean only when both are. The pinned `alchemy drift` exits 0 even when it finds drift and misses the
// code half (records/spike/04-drift.txt); the entry, src/run-drift.ts, exits 2 on drift.
import * as Alchemist from "alchemy/Alchemist";
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { codeChanges } from "./code-drift.ts";
import { STACK } from "./names.ts";
import { recordedOutputs } from "./state.ts";

/** A stack file and the stack it declares; the drift check scans each. */
export interface Scanned {
  readonly entrypoint: string;
  readonly stack: string;
}

export interface DriftReport {
  readonly stage: string;
  readonly checkedAt: string;
  readonly outcome: "passed" | "drifted";
  readonly clean: boolean;
  readonly stacks: ReadonlyArray<string>;
  readonly resources: number;
  readonly settings: ReadonlyArray<{
    readonly stack: string;
    readonly fqn: string;
    readonly status: string;
    readonly reason?: string | undefined;
  }>;
  readonly code: ReadonlyArray<{ readonly container: string; readonly changed: ReadonlyArray<string> }>;
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

/** Code files changed in one container since it was created; a container that cannot be read counts as changed. */
const changedIn = (context: string, container: string) =>
  Effect.map(run("docker", ["--context", context, "diff", container]), ({ exitCode, stdout }) =>
    exitCode === 0 ? codeChanges(stdout) : ["(docker diff failed: the container is not there)"],
  );

// A stack that does not load, or a resource that cannot be read, is a check that failed, not drift: the check stops
// and its entry exits 1. Alchemy types both failures as `any`, so they are taken as defects here.
const scanOne = (stage: string, scanned: Scanned) =>
  Effect.gen(function* () {
    const stack = yield* Alchemist.importStack(scanned.entrypoint);
    // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- Alchemy's scan fails with `any`; the orDie below takes it as a defect.
    const scan = yield* Alchemist.Drift.scan({ stack, stage });
    return {
      // As Alchemist.Drift.hasDrift decides it: a resource changed or gone. "skipped" is one the provider cannot read.
      drifted: Arr.some(scan.resources, (r) => r.status === "drifted" || r.status === "missing"),
      resources: scan.resources.length,
      settings: Arr.map(
        Arr.filter(scan.resources, (r) => r.status !== "in-sync"),
        ({ fqn, status, reason }) => ({ stack: scanned.stack, fqn, status, reason }),
      ),
    };
  }).pipe(Effect.orDie);

export const check = (stage: string, stacks: ReadonlyArray<Scanned>) =>
  Effect.gen(function* () {
    const scans = yield* Effect.forEach(stacks, (s) => scanOne(stage, s));
    const platform = Arr.findFirst(stacks, (s) => s.stack === STACK);
    const recorded = Option.isNone(platform)
      ? undefined
      : yield* recordedOutputs(platform.value.entrypoint, platform.value.stack, stage);
    const code =
      recorded === undefined
        ? []
        : yield* Effect.forEach(
            recorded.containers,
            (container) => Effect.map(changedIn(recorded.context, container), (changed) => ({ container, changed })),
            { concurrency: 4 },
          );
    const changedCode = Arr.filter(code, (c) => c.changed.length > 0);
    const clean = !Arr.some(scans, (s) => s.drifted) && changedCode.length === 0;
    const now = yield* DateTime.now;
    return {
      stage,
      checkedAt: DateTime.formatIso(now),
      outcome: clean ? "passed" : "drifted",
      clean,
      stacks: Arr.map(stacks, (s) => s.stack),
      resources: Arr.reduce(scans, 0, (sum, s) => sum + s.resources),
      settings: Arr.flatMap(scans, (s) => s.settings),
      code: changedCode,
    } satisfies DriftReport;
  });
