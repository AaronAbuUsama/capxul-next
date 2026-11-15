# What was learned building the world

## What was learned on the way

- **A Durable Object stays where it was first made.** Before the hub's objects were placed in western Europe, a world's
  chain object was made where its first caller was (this container, near IAD), and Ponder in western Europe spent 9 s of
  its 12 s start on 22 calls to the chain through it (the first hub worlds, 14 November 2026). Every object of the hub is
  now made with `locationHint: "weur"` (`src/things/cluster/values.ts`); a hint places an object only when it is first made, so the
  trial worlds' names `w-f1` to `w-f5` keep objects (emptied) in the US.
- **Cloudflare's count of a hub's active containers lags.** Right after the last world was forgotten each application
  still showed one active instance; about 16 s later none (`records/hub.proof.json`).

- **Neon refuses to fork a branch that has an expiry of its own** ("Branches with an expiration date cannot have
  child branches"). A world that another is made from therefore has its Neon expiry taken off; its record says so,
  and the sweeper alone deletes it, at the same recorded expiry. A fork must be destroyed before its parent.
- **The real index runs as it is, except for its configuration.** `ponder/ponder.config.ts` names the same six
  contracts and block handler, with `reorgWindow: 0` (the seeded chain keeps nine blocks, and Ponder's default looks
  180 s back), a one-second poll, and addresses from the contracts' deployment record. The seed's own history holds
  no event the real app handles, so the events shown are the faucet's mint and a payment.
- **A fork carries its parent's index.** Ponder resumes from the forked `ponder` schema; the chain's state is copied
  after the database is forked, so the chain is never behind the index. Fork a quiet world.
- **The Docker daemon of an agent's container cannot push.** See Images above.
- **anvil answers `null` to `anvil_setBalance`**, which the world's chain call takes for no answer, so the bundler's
  setup judges the faucet by reading the balance back.
- **The bundler's first start takes several start calls, as in the spike.** On a new container application a start
  is refused or lost for a while after the deploy, and the Durable Object starts alto again every second, for up to
  240 s, until it serves the EntryPoint. The committed record's first start took 2 start calls and 11.2 s; the
  other runs of the bundler proof in this session took 4 to 13 (17.7 to 28.4 s).
- **The bundler keeps the chain address of its first start.** The door gives alto the chain's quiet address built
  from the request's host, which is right for a call through the door's public address (the create's) and wrong for
  one over a service binding, so a later start uses the first one. It holds the door's token, so it is kept apart
  from the record that `/bundler/status` gives out.
- **The accounts are shared with other builders.** While these proofs ran, another builder's worlds were made and
  destroyed in the same accounts, and failed the account-wide "same as before" check of six proof runs; see What is
  proven. Two failures had nothing to do with the bundler, and the next run of each passed: one `commands` run's
  deploy was refused by Cloudflare while creating the Core Worker (`WorkerNotFound`), and in one `sweep` run one of
  its three simultaneous worlds' chains never answered within the chain step's 180 s. Each create removed what it had
  made. On the line with the real Core, two runs of the bundler proof had the chain's container go away during the
  proof's own use, just after the create, and Cloudflare then refused to start it again ("There is no container
  instance that can be provided to this Durable Object, try again later"). The chain did not try that start again; it
  now does (Containers, above).
- **A refused start often looks accepted.** Cloudflare takes the start call and then fails the first call to the
  container after it with the refusal, or lets the container go within seconds. The index's start used to end at the
  accepted call, so its refusals failed `POST /index/start` outside its Durable Object and were seen only as a step that
  took longer; in `run-e710b3`, `world.create 5`, all 59 of those calls failed for the step's 180 s and nothing said
  why. A start now holds only once the container answers, and each refusal is in the record.
- **Two runs of the snapshot proof failed before one passed**, after the change, both in the create of its first
  world. In one, the index step ran out of its 5 minutes; its account was not kept then (a timed-out index step now
  carries the index's own record in its failure, `src/parts/indexer/starts.ts`, since that record is destroyed with the
  world). In the other, the bundler's setup read back 0 wei after `anvil_setBalance` 17 s after the chain first
  answered, as if the chain had restarted from its seed: its container gone before its first save (every 20 s). Each
  create removed what it had made; the third run passed.
- **Ponder's start was mostly round trips to Neon.** Ponder ran wherever Cloudflare placed it, an ocean from the
  world's branch in aws-eu-west-2: 17 to 21 s of its 22 to 24 s to ready went to 73 to 87 database calls (Ponder's own
  `ponder_database_method_duration`, read from its `/metrics` into the index's record: `create_trigger` 6 s for 14,
  `migrate` 5.4 s for 28). Placed in western Europe (`constraints.regions`), the same calls take about 3 s.
