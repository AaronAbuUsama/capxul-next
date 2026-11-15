# Pin or publish an image

### Images

`capxulworld-anvil`, `capxulworld-ponder` and `capxulworld-alto` are shared by every world and belong to the platform.
Each is pinned in `src/stack/images.ts`: the digest it was published as, and a fingerprint of what it was built from.
The fingerprint reads only the files its Dockerfile can see (its `.dockerignore` followed), and reads each `node_modules`
folder as the lockfile and settings it is installed from, so it takes milliseconds and is the same however, or
whether, `node_modules` is installed. A deploy whose fingerprint matches the pin deploys the image by digest and hashes
no build context; `./run.sh images` prints each pin, the fingerprint now and whether they match.

Before the pins, Alchemy hashed each build context file by file on every deploy (Alto's 237 MB of `node_modules`
20.9 s, Ponder's 10.8 s: `spikes/world-speed`, 1.2), and named the image by that hash, which changes with how
`node_modules` was installed: in a container whose install differs, a create spent 39.6 s (Alto) and 26.8 s (Ponder) hashing and asking the registry, found no
such image and tried to build it (`records/speed/before-create-ewb1.*`, failed at the build: this container's Docker has
no daemon). With the pins, the deploy is 35.6 s and the create 81.0 s with no `node_modules` installed at all
(`records/speed/after-create-*`), against a deploy of 60.6 s and a create of 95.4 s before (`spikes/world-speed`,
`e1-create-wsb2`). The `patience` proof's four creates, run before and after: deploy 53.8 to 61.4 s before, 29.0 to
33.2 s after; create 92.5 to 108.1 s before, 48.5 to 81.0 s after (`records/p-pat-*.json`, and the same files at
`5693fc61`); what is left of a create is mostly the index's and the bundler's first starts, which Cloudflare refuses
for a while on a new container application.

When an image's inputs change (the indexer's code, a lockfile, a Dockerfile), its fingerprint no longer matches, and
the deploy logs so and builds by context as before: Alchemy tags the build with a hash of its inputs and reuses a tag
the registry already lists. The index's image copies `ponder/node_modules`: after a change to `ponder/package.json`,
run `pnpm install --ignore-workspace` in `ponder/`; the bundler's image copies `images/alto/node_modules` the same way.
Then pin it again: put the digest the deploy's log names ("using pre-pushed", "registry cache hit" or the push) and
the fingerprint `./run.sh images` prints into `PINS`.

In an agent's container the Docker daemon has no route out, so such a deploy builds the image and then fails at the
push. `images/publish.sh <repository:tag>...`, with the tags the failed deploy's log names, pushes them through the
session's proxy with curl; the next deploy then needs no Docker.

### Re-pin, and redeploy the standing cluster, with `cluster.yml`

The images are the hub's, not a world's: a world deploys no image, and a `world` run on the standing cluster (fleet)
builds none, so its log names no digest. A stale pin costs time only when a hub is deployed, and an agent's container
may have no Docker engine at all. So an image whose inputs changed is built and published by redeploying a hub on a
GitHub runner, with the manual workflow `.github/workflows/cluster.yml` (Actions, "cluster", "Run workflow"; started by the
conductor or Aaron, never by a builder):

1. Give it the cluster (default fleet) and a lifetime from now (e.g. `14 days`). It keeps the cluster's operator, as
   the world command's show of it reads it, and refuses while the hub's ledger holds a world unless `force` is set, since a redeploy can
   replace the containers those worlds run in.
2. It installs `ponder/` and `images/alto/` node_modules, prints `./run.sh images`, brings the cluster up, and keeps
   as the run's artifact the deploy's log (`up.log`), the pins before and after, and every line of the log that names
   an image or a digest (`digests.txt`, also in the run's summary).
3. Then a pull request re-pins: for each image whose inputs had changed, the digest `digests.txt` names for it and
   the fingerprint `images-after.json` prints, into `PINS` in `src/stack/images.ts`. After it, `./run.sh images`
   reports every image `current`.

The same run carries everything else new in the cluster's stack to fleet (a new chain image after the seed changes, a
bundler fix), so it is also how the standing cluster is brought up to date.
