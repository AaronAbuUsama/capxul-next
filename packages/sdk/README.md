# sdk

The typed client of every blueprint operation (roadmap step 1.9). It is derived from the blueprint, never listed
by hand: its operations are the names of the blueprint's two Rpc groups, and each call's payload, success and
refusals are its operation's Rpc. An operation added to the blueprint appears here with no change to this package.
The scenarios call Core through it, and so does the command line (`packages/cli`).

```ts
import * as Sdk from "@capxul/sdk";

const program = Effect.gen(function* () {
  const capxul = yield* Sdk.make;
  const founded = yield* capxul["org.create"]({ handle: "northwind", ... }, { as: "dana" });
});

// The doors from the environment: CAPXUL_PLATFORM_URL, CAPXUL_PLATFORM_TOKEN, CAPXUL_DOOR_URL, CAPXUL_DOOR_TOKEN,
// and for other operators, other worlds and the chain, CAPXUL_SECOND_PLATFORM_TOKEN and CAPXUL_CHAIN_URL (optional).
program.pipe(
  Effect.provide(Layer.mergeAll(Sdk.platformDoorFromConfig, Sdk.worldDoorFromConfig, Sdk.reachFromConfig)),
  Effect.provide(FetchHttpClient.layer),
);
```

## What a call does

- It answers the operation's declared success, decoded as its type (a `Founded` is a `Founded`).
- It fails with one of the operation's declared refusals, or `NotSignedIn` from sign-in, as typed errors. A call
  that got no answer, or that the server died in, is a defect: nothing a caller can act on.
- It opens a caller-side span named after the operation (`kind: "client"`), and sends that span's trace in the
  blueprint's `traceparent` header, so the server's spans fall under the caller's trace. A runner that installs a
  tracer gets the caller's timing of every call from it.
- It sends the door's credential as `Bearer <token>` in the blueprint's `CREDENTIAL_HEADER`, and the person the
  call acts as, if any (`{ as: "dana" }`), in `PERSON_HEADER`. Rpc over HTTP with JSON, a POST to the door's URL.
- It checks the payload against its operation's schema first, and refuses one that does not fit with the
  blueprint's `PayloadRejected` without sending anything.
- `{ operator: "second" }` signs a platform call with the second operator's token; `{ at: view.door }` sends a
  world's operation to that world's door (`WORLD_PATH` under it) with the operator's token. Both go through
  `ReachDoors` (`Sdk.reach(spec)` or `Sdk.reachFromConfig`); a client made without it refuses them with
  `NotSignedIn` (`no_credential`).

## Chain reads

`client.chain` holds the blueprint's chain reads (`Chain.reads`), each `(payload, { at?, operator? })`, over the
world door's read-only chain JSON-RPC (`CHAIN_PATH`): the client's own world's, or `at` another's. viem encodes the
contract calls and decodes answers and logs from the blueprint's Solidity signatures; it never reaches the network,
which is Effect's HttpClient. Each answer is decoded with its read's schema, addresses and hashes in lower case. A
read that gets no answer dies. Each read is a caller-side span, `chain.<read>`.

The client lives as long as the doors' layer it was made in: use it inside that layer.

## The scenarios' `Capxul`

`Sdk.layer(Capxul)` is the scenarios' `Capxul` service (`packages/scenarios/src/client.ts`), built from the SDK's
`Full` client (every operation and `chain`). The SDK does not import the scenarios; the runner passes their tag in. `test/operations.test.ts` does not
compile unless the two shapes are the same.

| File | What it holds |
|---|---|
| `src/door.ts` | The door: everything below. |
| `src/operations.ts` | The names, read from the blueprint's groups, and the types of a call: `Payload`, `Success`, `Refusal`, `Client`. |
| `src/client.ts` | `make`, `platformClient`, `worldClient`, `layer` and `callByName`: the typed client, its caller-side spans and `PayloadRejected`. |
| `src/chain.ts` | The chain reads over a world's chain JSON-RPC. |
| `src/transport.ts` | `PlatformDoor` and `WorldDoor`: one Rpc client per group, from a `Target` (a URL and a token) or from Config; `ReachDoors`: the second operator, another world's door and a chain. |
| `src/test-door.ts` | `TestDoor`: both groups served in this process, for tests (below). |

## TestDoor

A door served in this process, for tests, until Core lands: the blueprint's two groups over HTTP at `/platform` and
`/world`, and when asked a chain JSON-RPC at `/chain`, with a sign-in that accepts one token. Every handler either refuses with `NotImplemented`, as Core's empty
handlers do, or answers its operation's first blueprint example. It keeps what it saw of each call (`Calls`). It is
built from the same groups, so it serves every operation without a change here. It is not a server of Capxul.

## Checks

`pnpm types` and `pnpm test`. `test/operations.test.ts`: the SDK's operations equal the blueprint's, each in its
group, and the client fits `Capxul`. `test/round-trip.test.ts`: all twelve operations over HTTP to a `TestDoor`,
each coming back as its typed `NotImplemented`, or as its declared success decoded; `NotSignedIn` for a wrong
token; a caller-side span per call whose trace and person reached the server; the doors from Config.
`test/reach.test.ts`: a call `at` another door, the second operator, `PayloadRejected` with nothing sent, and every
chain read against a served chain JSON-RPC.
