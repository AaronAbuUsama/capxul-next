# sdk

The typed client of every blueprint operation (roadmap step 1.9). It is derived from the blueprint, never listed
by hand: its operations are the names of the blueprint's two Rpc groups, and each call's payload, success and
refusals are its operation's Rpc. An operation added to the blueprint appears here with no change to this package.
The journeys call the api (`packages/core`) through it, and so does the command line (`packages/cli`).

```ts
import * as Sdk from "@capxul/sdk";

const program = Effect.gen(function* () {
  const capxul = yield* Sdk.make;
  const founded = yield* capxul["org.create"]({ handle: "northwind", ... }, { as: "dana" });
});

// The endpoints from the environment: CAPXUL_PLATFORM_URL, CAPXUL_PLATFORM_TOKEN, CAPXUL_DOOR_URL, CAPXUL_DOOR_TOKEN,
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
- It sends the endpoint's credential as `Bearer <token>` in the blueprint's `CREDENTIAL_HEADER`, and the person the
  call acts as, if any (`{ as: "dana" }`), in `PERSON_HEADER`. Rpc over HTTP with JSON, a POST to the endpoint.
- It checks the payload against its operation's schema first, and refuses one that does not fit with the
  blueprint's `PayloadRejected` without sending anything.
- `{ operator: "second" }` signs an account call with the second operator's token; `{ at: view.door }` sends a
  world's operation to that world's endpoint (`WORLD_PATH` under it) with the operator's token. Both go through
  `ReachDoors` (`Sdk.reach(spec)` or `Sdk.reachFromConfig`); a client made without it refuses them with
  `NotSignedIn` (`no_credential`).

## Chain reads, the journeys' `Capxul`, and tests

`client.chain` holds the blueprint's chain reads over the endpoint's read-only chain JSON-RPC (`CHAIN_PATH`); the
header of `src/chain.ts` says how. A client lives as long as the endpoints' layer it was made in: use it inside it.
`Sdk.layer(Capxul)` is the journeys' `Capxul` service (`packages/scenarios/src/client.ts`), built from the SDK's
`Full` client; the runner passes the tag in, so the SDK does not import the journeys. `TestDoor`
(`src/test-door.ts`) serves both groups in this process for tests.

## Checks

`pnpm types` and `pnpm test`: the SDK's operations equal the blueprint's and the client fits `Capxul`
(`test/operations.test.ts` does not compile otherwise); every operation round-trips over HTTP to a `TestDoor`, with
its span and trace (`test/round-trip.test.ts`); `at`, the second operator, `PayloadRejected` and every chain read
(`test/reach.test.ts`).
