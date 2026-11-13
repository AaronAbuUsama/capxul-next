// The command line's door: the `capxul` command derived from the blueprint, how to run it with given arguments,
// and the exit code for what a command failed with. `src/bin.ts` runs it as a process.
import * as Command from "effect/cli/Command";
import { capxul } from "./commands.ts";

export { capxul, exitCodeOf, type CapxulCommand, type Failure, type Services } from "./commands.ts";
export { fieldsOf, RESERVED, valueOf, type Field } from "./input.ts";
export { answerLine, readAnswer, type Answer } from "./output.ts";

/** The command line's version, shown by `--version`. */
export const VERSION = "0.0.0";

/** Runs `capxul` with these arguments (without the program's own name). */
export const run = Command.runWith(capxul, { version: VERSION });
