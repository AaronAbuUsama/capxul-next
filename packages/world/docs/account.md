# Serve the account's operations

### The platform (roadmap steps 1.6 and 1.12)

`src/account` serves the blueprint's platform group with Effect's Rpc server at `PLATFORM_PATH`, on the loopback of
the machine that holds the Cloudflare and Neon keys (packages/blueprint, src/things/world/values.ts): in the runner's
own process (`packages/runner`, `src/worlds/platform.ts`), or by `./run.sh platform serve [--port 8790]`. Its sign-in
and its spans are Core's middlewares; the first operator is `WORLD_OWNER` with `CAPXUL_PLATFORM_TOKEN`, the second
`WORLD_SECOND_OWNER` with `CAPXUL_SECOND_PLATFORM_TOKEN`.

| Operation | What it does |
|---|---|
| `world.create` | Refuses a real grade and a start before the seed (with an hour of room) before anything exists; then this package's create, with the chain's clock just after the seed and the owner operator's own token bound into Core (decisions 36); then the cast on the chain (`cast.ts`: dana, eli, sam and olga get a Safe claimed through Companies House's devnet claim role and 10,000 test USDC from the faucet, pat none; test accounts 4 to 8), the world's start block at its clock, its facts in its database (`packages/core/migrations/0003_world.sql`) and `world_created` as its record's first entry. It answers once Core has answered its health check ten times in a row. A failure after the claim destroys the world. |
| `world.show` | The shared state (owner, expiry, parked, door) and the world's database (contracts, clock, record head, cast; grade and parent from the record's latest `world_created`); its companies as its Core reads them (`GET /companies`, Core's `companiesOf`, which moves each site on towards ready). |
| `world.snapshot.save` | Owner only. Each of the world's company sites backed up on its bench under the snapshot's name (`src/things/site/snapshot.ts`: the site door's `POST /world/backup`, which answers at once, then `GET /world/backup/<snapshot>` until it is saved, within 12 minutes), a Neon branch of the world's branch with no compute (its expiry is lifted first: Neon will not fork a branch that has one), the chain's whole state saved in the world's R2 bucket under the snapshot's name (the door's `POST /chain/snapshot/<name>`), and a row in `platform.snapshots`; then `snapshot_saved`. A world with companies and no bench is a fault to save. |
| `world.snapshot.restore` | A template's to anyone, any other snapshot's to its owner; never past the source's expiry. A new world whose branch forks the snapshot's and whose chain adopts the saved state (`GET /chain/snapshot/<name>` of the source's door); its parent and clock rewritten, and its chain's next block mined at that clock's time, so the chain reads the world's one clock (the chain was loaded with the snapshot's head and runs on from it: `clock` proof); each site the snapshot saved made again in it from its backup, under its own label, on the new world's clock and with its site credential (the site door's `POST /world/restore`, with the source world's token shown too), and its companies pointed at their new sites; then its own `world_created`. |

What the platform keeps of its own is in the schema `platform` of the registry's branch: `platform.spans` (every
platform call's spans), `platform.calls` (the world each successful call acted on, whose record holds its events) and
`platform.snapshots`. A world's take-down deletes its snapshot branches before its own (`dropSnapshots`), so a world
restored from a snapshot must go first, which its expiry makes so.
