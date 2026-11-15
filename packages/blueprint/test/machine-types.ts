// Compile-time checks of the machine format (src/machine.ts): each line marked @ts-expect-error must fail to compile,
// so `tsc -p .` fails if the format ever stops making `otherwise` cover exactly the states a move cannot start from.
// Never run, only compiled. The names are a made-up door's, not the blueprint's.
import * as Machine from "../src/machine.ts";

export const fits = Machine.make({
  name: "door",
  key: "door",
  states: ["shut", "open", "locked"],
  start: { state: "shut", by: "door.fit", event: "door_fitted" },
  moves: {
    open: {
      from: ["shut"],
      to: "open",
      by: "door.open",
      event: "door_opened",
      otherwise: { open: "unchanged", locked: { refusal: "DoorLocked" } },
    },
    lock: {
      from: ["shut", "open"],
      to: "locked",
      by: "door.lock",
      event: "door_locked",
      otherwise: { locked: "unchanged" },
    },
  },
});

export const missing = Machine.make({
  name: "door",
  key: "door",
  states: ["shut", "open", "locked"],
  start: { state: "shut", by: "door.fit", event: "door_fitted" },
  moves: {
    open: {
      from: ["shut"],
      to: "open",
      by: "door.open",
      event: "door_opened",
      // @ts-expect-error: `locked` is neither in `from` nor in `otherwise`.
      otherwise: { open: "unchanged" },
    },
  },
});

export const extra = Machine.make({
  name: "door",
  key: "door",
  states: ["shut", "open", "locked"],
  start: { state: "shut", by: "door.fit", event: "door_fitted" },
  moves: {
    open: {
      from: ["shut"],
      to: "open",
      by: "door.open",
      event: "door_opened",
      // @ts-expect-error: `shut` is in `from`, so `otherwise` may not name it.
      otherwise: { shut: "unchanged", open: "unchanged", locked: { refusal: "DoorLocked" } },
    },
  },
});

export const stranger = Machine.make({
  name: "door",
  key: "door",
  states: ["shut", "open", "locked"],
  start: { state: "shut", by: "door.fit", event: "door_fitted" },
  moves: {
    open: {
      from: ["shut"],
      // @ts-expect-error: `ajar` is no state of the machine.
      to: "ajar",
      by: "door.open",
      event: "door_opened",
      otherwise: { open: "unchanged", locked: { refusal: "DoorLocked" } },
    },
  },
});

export const nowhere = Machine.make({
  name: "door",
  key: "door",
  states: ["shut", "open", "locked"],
  // @ts-expect-error: the start is no state of the machine.
  start: { state: "ajar", by: "door.fit", event: "door_fitted" },
  moves: {
    open: {
      from: ["shut"],
      to: "open",
      by: "door.open",
      event: "door_opened",
      otherwise: { open: "unchanged", locked: { refusal: "DoorLocked" } },
    },
  },
});

// `step` takes only the machine's states and moves.
// @ts-expect-error: `ajar` is no state.
fits.step("ajar", "open");
// @ts-expect-error: `kick` is no move.
fits.step("shut", "kick");
