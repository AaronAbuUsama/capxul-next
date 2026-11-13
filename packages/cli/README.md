# cli

The one Capxul command line (roadmap step 1.10), on Effect's CLI module. Every blueprint operation is a command
derived from the blueprint: its path is the operation's name split at its dots, and its flags are its payload's
fields. It calls Core through `packages/sdk` and prints the answer the SDK gave. Nothing here names an operation,
so an operation added to the blueprint is a command with no change to this package.

```sh
export CAPXUL_PLATFORM_URL=… CAPXUL_PLATFORM_TOKEN=… CAPXUL_DOOR_URL=… CAPXUL_DOOR_TOKEN=…
pnpm --filter @capxul/cli capxul world create --world town --grade private --lifetime-minutes 60 \
  --clock '{"mode":"frozen","startAt":null}'
pnpm --filter @capxul/cli capxul doc create --input supplier.json --as sam
capxul --help    # every group and the operations under it
```

## Input

- One flag per payload field, in kebab case (`lifetimeMinutes` is `--lifetime-minutes`). A flag's text is the field's
  JSON value when it is JSON the field accepts (`60`, `false`, `null`, `["eli"]`, `{"mode":"frozen"}`), and
  otherwise the text itself, as a string.
- `--input <file>`: a JSON file of the payload's fields. A field's own flag overrides the file.
- `--as <person>` on a world's commands: the person of the world's cast the call acts as; left out, the owner.
- The payload is decoded with the operation's own schema before any call; one that does not decode is refused.
- The doors' addresses and credentials come from the environment, as the SDK's Config reads them. A command reads
  only its own door's.

## Output

One line of JSON on standard output, the SDK's answer encoded with the operation's own schemas, fields in the
schemas' order: `{"operation":"world.show","outcome":"success","success":{…}}` or
`{"operation":"world.show","outcome":"refusal","refusal":{"_tag":"NotImplemented","operation":"world.show"}}`.
`readAnswer` decodes such a line back.

The process exits 0 on success, with the blueprint's exit code for a refusal (`Errors.exitCode`: 2 to 6), and 1 for
anything else: input that was refused, a door that is not configured, no answer, a server that died.

| File | What it holds |
|---|---|
| `src/door.ts` | The door: `capxul`, `run` (the command line with given arguments), `exitCodeOf`, and below. |
| `src/commands.ts` | The command tree, derived from the SDK's operation names, and each command's call. |
| `src/input.ts` | The flags of a payload and the `--input` file: the input edge, where JSON text is read. |
| `src/output.ts` | The answer's line and `readAnswer`: the output edge, where JSON text is written. |
| `src/bin.ts` | The `capxul` process: an entry file that runs the command line and sets the exit code. |

## Checks

`pnpm types` and `pnpm test`. `test/commands.test.ts`: every blueprint operation has a command at its path and every
command is one or a group of them; every payload field has its own flag. `test/round-trip.test.ts`: all twelve
operations through the SDK and through the command line against the SDK's `TestDoor`, from flags and from a file,
give the same answers, refusals and successes alike; `NotSignedIn` with exit code 3; a payload that does not decode
is refused before any call; and the `capxul` process itself prints the same line and exits 6 for `NotImplemented`.
