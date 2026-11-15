# How a world's api is hosted and reaches its parts

### Core's slot, or a host of Core

A caller may run every world's Core itself instead (`src/parts/api/host.ts`, `CoreHost`, provided around the platform):
the stack then deploys no Core Worker but keeps Core's secrets (`operator-token`, `site-key`, `site-secret`), the
world's door is where the host says its Core will answer, the `core` step starts it there before waiting for its
health, and every take-down stops it. The runner's `--core=local` rehearsal is the one host (`packages/runner`,
`src/local/`); a world made with it says so in every record the runner writes.



`src/parts/api/Api.ts` is the one place that says what runs as Core: `packages/core`'s Worker, handed the world's own
facts through Core's `CoreDeployment` (never its own stage's): the world's branch through `WorldDatabase`, the
world's token (the door's `door-token`, which Core's world door and
its chain reads accept), the owner operator's token (`operator-token`: Core's platform door, and the world's door as
its owner, blueprint decisions 36), a service binding to the world's door for the chain, and, when the world has a
bench, the site door's address, the world's site token and the credential of the API user the door makes on each site
(`site-key`, `site-secret`). Every token is an `Alchemy.Random` of the stage, bound as a secret and read back from the
state (`World.doorToken`, `World.operatorToken`), never an output. `CORE_MIGRATIONS` is Core's `migrations/`. A world
is ready once Core answers 200 on `CORE_HEALTH`, Core's `/health`. A caller can also provide its own `Core` for one run.

The proof that a world made by `world create` answers every blueprint operation at its door is the runner's door
check, run against such a world: `packages/runner/records/w-c1/door.json` (`passed`: all twelve answered
`NotImplemented` through the SDK, every span, outcome and events check held, the spans read from the world's own
database). Core's `/chain` answered `eth_blockNumber` from the world's chain and refused `eth_sendTransaction` with
JSON-RPC's -32601 (run by hand, not recorded).


### How Core reaches the bundler

The bundler is reached exactly as the chain is: through the world's door, under the world's token. The chain is at
`<door>/<token>/rpc` and the bundler beside it at `<door>/<token>/bundler` (`BUNDLER_PATH`), speaking ERC-4337
JSON-RPC (`eth_sendUserOperation`, `eth_getUserOperationReceipt`, `eth_estimateUserOperationGas`,
`pimlico_getUserOperationGasPrice` and the rest). The world's handle carries it as `world.bundlerUrl`, a `Redacted`
like `world.rpcUrl`, with `world.entryPoint` and `world.paymaster` beside it; the command line prints all three
(`show`, `create`), the token hidden unless `--reveal`. A Core that reaches its chain through the world's door, by a
service binding to the door Worker and the door's token (`/<token>/rpc`), reaches the bundler over the same binding
with the same token at `/<token>/bundler`: no new binding or secret. Once alto has started, a later start uses the
chain address of its first start (the create's, through the door's public address), so a call that arrives over a
service binding starts it correctly. Core needs nothing else: the EntryPoint (`ENTRY_POINT`) and the test paymaster
(`TEST_PAYMASTER`) are the same in every world and exported by the package's door, with `bundlerCall`, one JSON-RPC
call to a world's bundler. A UserOperation sponsored by the test paymaster names it in `paymaster` with
`paymasterData` `0x`; the paymaster checks nothing. A call to the bundler wakes a stopped chain and starts alto if it
is stopped (about 8 s, `records/spike-bundler`).
