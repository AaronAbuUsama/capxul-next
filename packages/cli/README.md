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
- `--operator first|second` on every command: the operator whose token signs a platform call, or a call `--at`
  another world's door; left out, the first. `--at <door>` on a world's commands: another world's door, as
  `world.show` answers it. Either reaches its door through the SDK's `reachFromConfig`, which reads all four
  variables and `CAPXUL_SECOND_PLATFORM_TOKEN` for the second operator; a call that reaches only its own door reads
  only that door's two.
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
| `src/call.ts` | `callVia`: one call made through the command line in this process, answering what its line holds. |
| `src/bin.ts` | The `capxul` process: an entry file that runs the command line and sets the exit code. |

## A call through the command line, in this process

`callVia(doors)(name, payload, options)` makes one SDK-shaped call through the command line: `argsOf` writes the
arguments of the command that makes it (its path, `--<flag>=<text>` for each payload field, encoded with the
operation's own payload schema, then `--as`, `--operator`, `--at`), `run` runs the command line on them with `doors`
as its environment, and `readAnswer` reads its one printed line back. It answers the line's success or fails with its
refusal; a command that printed no line is a defect, as an unanswered SDK call is. The runner uses it to run the thin
line's journeys through the command line (packages/runner, `--via=cli`).

It runs `run` in this process rather than spawning `capxul` once per call, by choice: the parsing, the call through
the SDK and the printed line are the same code the process runs, a journey makes hundreds of calls, and the runner's
HTTP client (which resends what Cloudflare's edge answers during a world's warm-up) and the call's trace both reach
the SDK's call unchanged, so Core's spans fall under the trace the runner records and the generic checks find them.
That the process prints the same line as `run` and exits with the blueprint's code is `test/round-trip.test.ts`'s.

A payload that is not of its operation's schema has no arguments: `argsOf` rejects it with the SDK's own check
(`Sdk.checkPayload`), `PayloadRejected`, as the SDK's call does, and the command line never runs. A person cannot type
such a payload anyway: the command line takes the payload's JSON form, which its schema decodes (trimming text, for
one), so the found-Northwind journey's two `PayloadRejected` tries are answered there, before the command line.

## Checks

`pnpm types` and `pnpm test`. `test/commands.test.ts`: every blueprint operation has a command at its path and every
command is one or a group of them; every payload field has its own flag. `test/round-trip.test.ts`: all twelve
operations through the SDK and through the command line against the SDK's `TestDoor`, from flags and from a file,
give the same answers, refusals and successes alike; `NotSignedIn` with exit code 3; a payload that does not decode
is refused before any call; and the `capxul` process itself prints the same line and exits 6 for `NotImplemented`.
`test/call.test.ts`: `callVia` answers every operation exactly as the SDK's call does, `--as`, `--operator` and `--at`
included, a second operator with no token or a wrong one too; a payload not of its schema is `PayloadRejected` as the
SDK's; a call's arguments are its path, one flag per field and its options.
