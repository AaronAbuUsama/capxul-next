// The one place that decides what runs in a world's Core slot. Until packages/core lands, it is the stand-in
// (./StandIn.ts); swapping in the real Core is this file alone: import its Worker in place of StandInCore, and point
// CORE_MIGRATIONS at its migrations.
import * as Context from "effect/Context";
import type { CoreSlot } from "../stack/stack.ts";
import StandInCore from "./StandIn.ts";

/** What fills a world's Core slot when the caller provides nothing else. */
export const defaultCore: CoreSlot = StandInCore;

/** The `.sql` files applied to a world's database when it is created, unless the caller names its own. */
export const CORE_MIGRATIONS = `${import.meta.dirname}/../../migrations`;

/** What fills a world's Core slot. A caller with a Core of its own provides it here. */
export const Core = Context.Reference<CoreSlot>("@capxul/world/core/Core", { defaultValue: () => defaultCore });
