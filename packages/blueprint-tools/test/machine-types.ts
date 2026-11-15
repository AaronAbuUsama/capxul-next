// Compile-time checks of the machine format (src/language/lifecycle.ts): each line marked @ts-expect-error must fail
// to compile, so `tsc -p .` fails if the format ever stops making `otherwise` cover exactly the states a move cannot
// start from, or accepting a refused-state schema other than the states its moves refuse from. Never run, only
// compiled. The declarations are a made-up door's, not the blueprint's: each stands in for a verb, an event or a
// refusal by the one field the format reads of it.
import * as Schema from "effect/Schema";
import * as Machine from "../src/language/lifecycle.ts";

const States = Schema.Literals(["shut", "open", "locked"]);
const RefusedFrom = Schema.Literals(["locked"]);
const verb = (name: string) => ({ rpc: { _tag: name } });
const tagged = (tag: string) => ({ identifier: tag });
const fit = verb("door.fit");
const open = verb("door.open");
const lock = verb("door.lock");
const fitted = tagged("door_fitted");
const opened = tagged("door_opened");
const locked = tagged("door_locked");
const DoorLocked = tagged("DoorLocked");

export const fits = Machine.make({
  name: "door",
  key: "door",
  states: States,
  refused: RefusedFrom,
  start: { state: "shut", by: fit, event: fitted },
  moves: {
    open: {
      from: ["shut"],
      to: "open",
      by: open,
      event: opened,
      otherwise: { open: "unchanged", locked: { refusal: DoorLocked } },
    },
    lock: {
      from: ["shut", "open"],
      to: "locked",
      by: lock,
      event: locked,
      otherwise: { locked: "unchanged" },
    },
  },
});

export const missing = Machine.make({
  name: "door",
  key: "door",
  states: States,
  refused: Schema.Literals([]),
  start: { state: "shut", by: fit, event: fitted },
  moves: {
    open: {
      from: ["shut"],
      to: "open",
      by: open,
      event: opened,
      // @ts-expect-error: `locked` is neither in `from` nor in `otherwise`.
      otherwise: { open: "unchanged" },
    },
  },
});

export const extra = Machine.make({
  name: "door",
  key: "door",
  states: States,
  refused: RefusedFrom,
  start: { state: "shut", by: fit, event: fitted },
  moves: {
    open: {
      from: ["shut"],
      to: "open",
      by: open,
      event: opened,
      // @ts-expect-error: `shut` is in `from`, so `otherwise` may not name it.
      otherwise: { shut: "unchanged", open: "unchanged", locked: { refusal: DoorLocked } },
    },
  },
});

export const stranger = Machine.make({
  name: "door",
  key: "door",
  states: States,
  refused: Schema.Literals([]),
  start: { state: "shut", by: fit, event: fitted },
  moves: {
    open: {
      from: ["shut"],
      // @ts-expect-error: `ajar` is no state of the machine.
      to: "ajar",
      by: open,
      event: opened,
      otherwise: { open: "unchanged", locked: "unchanged" },
    },
  },
});

export const nowhere = Machine.make({
  name: "door",
  key: "door",
  states: States,
  refused: RefusedFrom,
  // @ts-expect-error: the start is no state of the machine.
  start: { state: "ajar", by: fit, event: fitted },
  moves: {
    open: {
      from: ["shut"],
      to: "open",
      by: open,
      event: opened,
      otherwise: { open: "unchanged", locked: { refusal: DoorLocked } },
    },
  },
});

export const unrefused = Machine.make({
  name: "door",
  key: "door",
  states: States,
  // @ts-expect-error: the moves refuse from `locked`, which `refused` does not name.
  refused: Schema.Literals([]),
  start: { state: "shut", by: fit, event: fitted },
  moves: {
    open: {
      from: ["shut"],
      to: "open",
      by: open,
      event: opened,
      otherwise: { open: "unchanged", locked: { refusal: DoorLocked } },
    },
  },
});

export const overRefused = Machine.make({
  name: "door",
  key: "door",
  states: States,
  // @ts-expect-error: no move refuses from `shut`.
  refused: Schema.Literals(["shut", "locked"]),
  start: { state: "shut", by: fit, event: fitted },
  moves: {
    open: {
      from: ["shut"],
      to: "open",
      by: open,
      event: opened,
      otherwise: { open: "unchanged", locked: { refusal: DoorLocked } },
    },
  },
});

// `step` takes only the machine's states and moves.
// @ts-expect-error: `ajar` is no state.
fits.step("ajar", "open");
// @ts-expect-error: `kick` is no move.
fits.step("shut", "kick");
