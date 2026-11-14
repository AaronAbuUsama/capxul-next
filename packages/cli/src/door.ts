// The command line's door: the `capxul` command derived from the blueprint, how to run it with given arguments, one
// call made through it in this process, and the exit code for what a command failed with. `src/bin.ts` runs it as a
// process.
import * as Command from "effect/cli/Command";
import { capxul, VERSION } from "./commands.ts";

export { callVia, type Doors } from "./call.ts";
export { capxul, exitCodeOf, VERSION, type CapxulCommand, type Failure, type Services } from "./commands.ts";
export { argsOf, fieldsOf, RESERVED, valueOf, type Field } from "./input.ts";
export { answerLine, readAnswer, type Answer } from "./output.ts";

/** Runs `capxul` with these arguments (without the program's own name). */
export const run = Command.runWith(capxul, { version: VERSION });
