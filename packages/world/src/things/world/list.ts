// Every world the shared state holds, as a listing shows it.
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { recordedStages } from "../../stack/engine.ts";
import { isWorldStage } from "../../stack/names.ts";
import { classify, type Finding } from "./expiry.ts";

/** One world as a listing shows it. */
export interface Listed {
  readonly world: string;
  readonly owner: string | null;
  readonly expiresAt: string | null;
  readonly status: string | null;
  readonly state: Finding["kind"];
}

const listed = (world: string, finding: Finding): Listed => {
  switch (finding.kind) {
    case "unreadable":
      return { world, owner: null, expiresAt: null, status: null, state: finding.kind };
    case "no-expiry":
      return { world, owner: finding.owner, expiresAt: null, status: null, state: finding.kind };
    default:
      return {
        world,
        owner: finding.owner,
        expiresAt: finding.expiresAt,
        status: finding.status ?? "up",
        state: finding.kind,
      };
  }
};

/** Every world the shared state holds, with its owner, its expiry and whether that has passed. */
export const list = Effect.gen(function* () {
  const now = yield* DateTime.now;
  const stages = Arr.filter(yield* recordedStages, ({ stage }) => isWorldStage(stage));
  return yield* Effect.forEach(stages, ({ stage, output }) =>
    Effect.map(classify(now, output), (finding) => listed(stage, finding)),
  );
}).pipe(Effect.withSpan("world.list"));
