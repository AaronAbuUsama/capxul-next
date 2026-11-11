# @capxul/sandbox

Boxes: containers off Aaron's Mac that anyone creates, works in and destroys. A box has the repository's toolchain
(node, pnpm, git, Foundry), the repository at one commit of `integration/build` with every package installed, and no
internet. A checkout goes in, and its new commits come back, as git. Aaron's rulings of 11 November 2026: agents work
in a sandbox off his Mac, as a dev environment and not a gate; generic, so a single agent can make and destroy its own;
a guard against runaway containers; a light CLI in package.json. Nothing here knows about the loop.

```bash
pnpm sandbox up feat-x --dir var/runs/r1/lane --owner run:r1 --ttl 2h   # start (or find) a box; put the checkout's commits in it
pnpm sandbox exec feat-x --cwd /path/in/box -- pnpm test                # run anything; output streams, the exit code is passed on
pnpm sandbox push|pull feat-x <checkout>                                # make the box's copy match / bring its commits back
pnpm sandbox ls [--json]                                                # every box: owner, state, age, expiry
pnpm sandbox down feat-x | --owner run:r1 | --all
pnpm sandbox reap [--dry-run]                                           # take down what is past its expiry or not running
```

## The runaway guard

1. **On Cloudflare, so it holds when the Mac is gone** (`worker/index.ts`): every box has an alarm at its expiry that
   destroys it (2 hours by default, 6 at most), stops after 30 idle minutes, and the account runs at most 10 at once
   (`max_instances`). A registry object lists every box, so `ls` and `reap` see those whose creator is gone.
2. **`pnpm sandbox reap`**: what is past its expiry or not running.
3. **The loop** (packages/loop): a run owns its boxes (`run:<id>`); they go down however the run ends, and the loop
   host takes down the boxes of runs no process is playing, every 5 minutes.

## Where things are

| Path | What it is |
|---|---|
| `src/main.ts` | The CLI's composition root: picks the launcher, prints, exits. |
| `src/modules/box` | A box: the server inside it, pi-durable's `ExecutionEnv` over HTTP, the git round trip, the launchers and `reap`. |
| `src/modules/cli` | The commands, argv in and a result out. |
| `src/bin/box.ts` | The server's entry inside the image. |
| `image/Dockerfile`, `image/build.sh` | The image (linux/amd64), built from `origin/integration/build` and this checkout's box server. |
| `worker/index.ts`, `worker/wrangler.jsonc` | The Worker `capxul-loop-sandbox`: `/box/<name>/start\|stop\|…`, `/boxes`; every request needs `Authorization: Bearer <BOX_KEY>`. |
| `deploy.sh` | Builds and pushes the image, deploys the Worker, sets `BOX_KEY`, writes `var/sandbox/box.json` (address and key, mode 600, git-ignored) in the main checkout. |

**Which launcher.** `SANDBOX=docker:<tag>` runs boxes in local Docker (for testing the image), `SANDBOX=url:<address>`
uses one box already running, and otherwise the Worker named in `var/sandbox/box.json`.

**Limits.** A checkout whose lockfile asks for a package the image lacks fails at `push` with pnpm's words: deploy
again to rebuild from the current `integration/build`. Watching files is not offered over the link. Instance
`standard-4` (4 vCPU, 12 GiB, 20 GB).

**Tests.** `pnpm sandbox:test`: pi-durable's environment conformance suite and the git round trip against a box server
in the test process, and every CLI command. `LOOP_BOX_IMAGE=<tag>` (box tests) and `SANDBOX_TEST_IMAGE=<tag>` (CLI)
run the same against Docker containers of the image.
