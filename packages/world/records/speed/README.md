# Speed records: the image pins and the one clock

## The image pins (`src/stack/images.ts`)

Before the pins, Alchemy hashed each image's build context file by file on every deploy (Alto's 237 MB of
`node_modules` 20.9 s, Ponder's 10.8 s: `spikes/world-speed`, 1.2) and named the image by that hash, which changes
with how `node_modules` was installed. In a container whose install differed, a create spent 39.6 s (Alto) and 26.8 s
(Ponder) hashing and asking the registry, found no such image and tried to build it: `before-create-ewb1.*`, failed at
the build, since that container's Docker had no daemon.

With the pins, the deploy took 35.6 s and the create 81.0 s with no `node_modules` installed at all
(`after-create-ewa1.*`), against 60.6 s and 95.4 s before (`spikes/world-speed`, `e1-create-wsb2`). The `patience`
proof's four creates, run before and after: deploy 53.8 to 61.4 s before and 29.0 to 33.2 s after; create 92.5 to
108.1 s before and 48.5 to 81.0 s after (`../p-pat-*.json`, and the same files at `5693fc61`). What was left of a
create then was mostly the index's and the bundler's first starts.

## The one clock

Before a restore mined its first block at the world's time, the restored chain was 19.7 s behind the api's clock
(`clock-before.proof.json`); with that block, but before a wake kept the chain's clock, one run was 3.7 s behind
(`clock-align-only.proof.json`). With both, `../clock.proof.json` passed: within a second after the restore and after
a stop and a wake.

`patience-sigterm.log` is the log of the `patience` proof's run once every stop of Ponder was SIGTERM, on which
Ponder exited in 0.2 to 0.5 s and its next start was ready 7.5 to 11.4 s after it was accepted (9.2 to 19.1 s when
it was killed instead).
