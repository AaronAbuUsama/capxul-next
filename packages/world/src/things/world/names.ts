// What a caller may call a world and its owner. The patterns are the blueprint's (WorldName, OperatorName): one
// source for both, so a world this package makes always has a name and an owner the contract accepts.
import { Values } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InvalidOwner, InvalidWorldName } from "../../common/failures.ts";
import { nameOf } from "../../stack/names.ts";

/** The world's name without the stage prefix, checked; a name with the prefix is taken without it. */
export const checkName = (given: string) =>
  Schema.decodeEffect(Values.WorldName)(nameOf(given)).pipe(
    Effect.mapError(() =>
      InvalidWorldName.make({
        given,
        message: "a world's name is 2 to 15 lower case letters, digits or dashes, starting with a letter",
      }),
    ),
  );

/** The owner's name, checked. */
export const checkOwner = (given: string) =>
  Schema.decodeEffect(Values.OperatorName)(given).pipe(
    Effect.mapError(() =>
      InvalidOwner.make({
        given,
        message: "an owner's name is 1 to 40 lower case letters, digits or dashes, starting with a letter",
      }),
    ),
  );
