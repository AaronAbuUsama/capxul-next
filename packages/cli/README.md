# cli

The one Capxul command line, on Effect's CLI module, generated from the blueprint (roadmap items 1.10 and 3.9;
decision 8 in [part 12 of the blueprint plan](../../docs/design/blueprint.md)). Every operation is a command at
`capxul <thing> <verb>`, as the blueprint's `commands` table names it (`doc.create` is `capxul document create`), and
its flags are its payload's fields. It calls the api through `packages/sdk` and prints the SDK's answer. Nothing here
names an operation, so an operation added to the blueprint is a command with no change to this package.

```sh
printf '%s\n' "$TOKEN" | capxul login --account https://account.example   # the token is read from standard input
capxul use town                                    # the current world
capxul world create --world town --grade private --lifetime-minutes 60 --clock '{"mode":"frozen","startAt":null}'
capxul document create --input supplier.json --as sam
capxul logout
```

## Signing in and finding a world

- `login --account <url>` keeps the account's address and the operator's token in the profile, a file under
  `CAPXUL_HOME` (by default `~/.capxul`) only its owner may read. It never prints the token. `logout` forgets the
  token; `use <world>` sets the current world.
- An account's command goes to the account, signed with the operator's token. Its payload's `world` field is its
  `--world`; left out, the world `use` set fills it.
- A world's command calls the world `--world` names, or else the one `use` set: it asks the account where that world
  answers (`world.show`) and calls there, signed with the operator's token. With neither, it is a usage error.
- The environment's variables stand over the profile: `CAPXUL_PLATFORM_URL` and `CAPXUL_PLATFORM_TOKEN` name the
  account; `CAPXUL_DOOR_URL` and `CAPXUL_DOOR_TOKEN` name the world a world's command calls when `--world` is not
  given; `CAPXUL_SECOND_PLATFORM_TOKEN` is the second operator's token.

## Input

- One flag per payload field, in kebab case (`lifetimeMinutes` is `--lifetime-minutes`). A flag's text is the field's
  JSON value when the field accepts it (`60`, `false`, `null`, `["eli"]`), and otherwise the text itself.
- `--input <file>`: a JSON file of the payload's fields. A field's own flag overrides it.
- `--operator first|second` picks the operator whose token signs the call; `--as <person>`, on a world's command,
  the person of the world's cast the call acts as. The blueprint's `CLI_FLAGS` lists what each kind of command
  reserves.
- The payload is decoded with the operation's own schema before any call; one that does not decode is refused.

## Output

On a terminal, a readable view of the answer, generated from the operation's schemas. With `--json`, or when the
output is not a terminal, one line of JSON: `{"operation":"world.show","outcome":"success","success":{…}}` or
`{"operation":…,"outcome":"refusal","refusal":{"_tag":"NotImplemented",…}}`. `readAnswer` decodes such a line back.
The process exits 0 on success, with the blueprint's exit code for a refusal (`Errors.exitCode`), and 1 for anything
else: a usage error, input that was refused, no answer.

The runner sends journeys through the command line with `callVia` (`--via=cli`), in this process, with every
variable set; the header of `src/call.ts` says how and why.

## Checks

`pnpm types` and `pnpm test`: the grammar (`test/grammar.test.ts`, `test/commands.test.ts`), the profile and finding
a world (`test/profile.test.ts`), the output and exit codes (`test/output.test.ts`), the same answers as the SDK from
flags, a file and the `capxul` process (`test/round-trip.test.ts`), and `callVia` (`test/call.test.ts`).
