# cli

The one Capxul command line (roadmap step 1.10), on Effect's CLI module. Every blueprint operation is a command
derived from the blueprint: its path is the operation's name split at its dots, and its flags are its payload's
fields. It calls the api (`packages/core`) through `packages/sdk` and prints the answer the SDK gave. Nothing here
names an operation, so an operation added to the blueprint is a command with no change to this package.

Where it is going: the one surface of Capxul, `capxul <thing> <verb>`, generated from the blueprint (decision 8,
[part 12 of the blueprint plan](../../docs/design/blueprint.md)). None of that is built yet; this README says what
runs today.

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
- `--operator first|second` on every command: the operator whose token signs an account call, or a call `--at`
  another world's endpoint; left out, the first. `--at <door>` on a world's commands: another world's endpoint, as
  `world.show` answers it. Either goes through the SDK's `reachFromConfig`, which reads all four variables and
  `CAPXUL_SECOND_PLATFORM_TOKEN` for the second operator; a call that reaches only its own endpoint reads only its two.
- The payload is decoded with the operation's own schema before any call; one that does not decode is refused.
- The endpoints' addresses and credentials come from the environment, as the SDK's Config reads them.

## Output

One line of JSON on standard output, the SDK's answer encoded with the operation's own schemas, fields in the
schemas' order: `{"operation":"world.show","outcome":"success","success":{…}}` or
`{"operation":"world.show","outcome":"refusal","refusal":{"_tag":"NotImplemented","operation":"world.show"}}`.
`readAnswer` decodes such a line back.

The process exits 0 on success, with the blueprint's exit code for a refusal (`Errors.exitCode`: 2 to 6), and 1 for
anything else: input that was refused, an endpoint that is not configured, no answer, a server that died.

The runner sends journeys through the command line with `callVia` (`--via=cli`), in this process; the header of
`src/call.ts` says how and why.

## Checks

`pnpm types` and `pnpm test`: every operation has a command and every payload field a flag (`test/commands.test.ts`);
every operation gives the same answers through the command line as through the SDK, from flags and from a file, and
the `capxul` process prints the same line and exits with the blueprint's code (`test/round-trip.test.ts`); `callVia`
answers as the SDK's call does (`test/call.test.ts`).
