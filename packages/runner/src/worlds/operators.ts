// Who owns a run's worlds. A run's two operators are `WORLD_OWNER` and `WORLD_SECOND_OWNER`; side by side
// (RUNNER_SHAPE=shared), each journey with worlds of its own has two more, named for the run's owner and its key, so
// its worlds count against quotas of their own (5 live worlds per owner, the blueprint's WORLD_LIMITS) and journeys
// about worlds never meet each other's worlds in a quota or an inventory. CI's teardown destroys every world whose
// owner is the run's owner or starts with it and a dash (.github/workflows/world.yml).
import * as Str from "effect/String";
import type { Settings } from "../settings.ts";

/** The run's two operators, as its settings name them. */
type RunOperators = Pick<Settings, "owner" | "secondOwner">;

/** The settings of one journey with worlds of its own: its two operators, `<owner>-<key>` and `<owner>-<key>-2`. */
export const operatorsOf = <S extends RunOperators>(settings: S, key: string): S => ({
  ...settings,
  owner: `${settings.owner}-${key}`,
  secondOwner: `${settings.owner}-${key}-2`,
});

/** True when `owner` is one of the run's operators: its two, or one a journey of it was given (`operatorsOf`). */
export const ofTheRun =
  (settings: RunOperators) =>
  (owner: string): boolean =>
    owner === settings.owner || owner === settings.secondOwner || Str.startsWith(`${settings.owner}-`)(owner);
