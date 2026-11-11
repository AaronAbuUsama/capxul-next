# The cloud sandbox

Where a loop run's agents execute: a Cloudflare container per run, behind one Worker (`capxul-loop-sandbox`). Aaron's
ruling of 11 November 2026: agents launch in a sandbox off his Mac, with the right tooling; a dev environment, not a
gate. The Mac keeps only the orchestrator: the process that plays the run, its ledger (`var/runs/<run>/run.sqlite`),
the model calls through the local gateway, the lane's git copy, the push of `lane/<task>` and the merge.

| File | What it is |
|---|---|
| `Dockerfile` | The image: node 24, pnpm (the repository's `packageManager`), git, Foundry 1.8.5, the repository at one commit of `integration/build` with every package installed, and the box server (`src/bin/box.ts`). linux/amd64. |
| `build.sh` | Builds it from `origin/integration/build` (or the ref given) and this checkout's box server; prints the tag. |
| `worker/index.ts`, `wrangler.jsonc` | The Worker: `POST /box/<name>/start`, `/stop`, and every other `/box/<name>/…` forwarded to that box's server. Every request needs `Authorization: Bearer <BOX_KEY>`. |
| `deploy.sh` | Builds, pushes the image to Cloudflare's registry, deploys the Worker, sets `BOX_KEY`, and writes `var/cloud/box.json` (address and key, mode 600, git-ignored) in the main checkout. |

**What a box has.** No internet (`enableInternet: false`): a lane arrives as a git bundle of the commits since the
image's, and its packages come from the image's pnpm store (`pnpm install --offline`). A lane whose lockfile asks for a
package the image lacks fails at the start with pnpm's words: run `deploy.sh` again to rebuild from the current
`integration/build`. A chain from the seeded state runs in the box on 127.0.0.1:18545 (`CAPXUL_CHAIN_RPC`). Instance
`standard-4` (4 vCPU, 12 GiB). A box is destroyed when its run ends; one nobody calls for two hours is stopped by
Cloudflare.

**Not in the box yet.** The capture tools (`record_terminal`, `browser`, `screenshot`, `record_screen`) would run on
the Mac, so a cloud run's agents are told there is no recorder. The heavy sandbox (the Frappe stack) is not in the image.

**Use.** `pnpm loop run|work` use `--sandbox cloud` by default; `--sandbox none` runs on the Mac as before.
`LOOP_BOX=docker:<tag>` runs the same image in local Docker instead of Cloudflare (testing only).
