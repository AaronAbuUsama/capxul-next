// The command line's grammar (docs/design/blueprint.md, part 12, decision 8; roadmap item 3.9): what `capxul` adds to
// the operations' own commands. Each operation is `capxul <thing> <verb>`, its thing's folder and its verb's file
// (src/generated/commands.ts); its flags are its payload's fields. Declarations only: packages/cli builds the command
// line from them, and nothing here is an operation of Capxul.

/**
 * The command line's own commands, beside the operations' (none of them is an operation). Until real sign-in
 * (phase 8), `login` keeps the account's address and the operator's token in the caller's profile, a file only its
 * owner may read, and prints neither; the environment's variables, when set, stand over the profile.
 */
export const CLI_COMMANDS = {
  login: "Signs in to an account: keeps its address and the operator's token in the profile.",
  logout: "Signs out: forgets the profile's token.",
  use: "Sets the current world by its name, so a world's command needs no --world.",
} as const;

export type CliCommand = keyof typeof CLI_COMMANDS;

/**
 * The flags every command may take besides its payload's fields; no field may take one of these names. `--world`
 * names a world (its endpoint is what `world.show` answers for it, signed with the operator's token), over the world
 * `use` set; `--as` acts as a person of the world's cast; `--json` prints one line of JSON even on a terminal;
 * `--input` reads the payload's fields from a JSON file; `--operator` picks the operator whose token signs an
 * account call.
 */
export const CLI_FLAGS = {
  world: "world",
  as: "as",
  json: "json",
  input: "input",
  operator: "operator",
} as const;

/**
 * How a command prints its answer: a readable view on a terminal, and one line of JSON (the answer encoded with the
 * operation's own schemas) when its output is not a terminal or with `--json`. Either way the process exits with the
 * blueprint's exit code for a refusal (`Errors.exitCode`), 1 for anything else that failed, and 0 on success.
 */
export const CLI_OUTPUTS = ["readable", "json"] as const;

export type CliOutput = (typeof CLI_OUTPUTS)[number];
