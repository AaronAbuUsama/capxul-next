## What
spikes/skeleton/core/bin/up.sh starts anvil (8545) and the Core stub (8787) only if they are down. On 11 November both were running from an old agent worktree (.claude/worktrees/agent-a8ae1cb38071da05e, its own state), and the main checkout's eval reused them: B1's hat delivery and sign-in failed and the eval could not run. Make up.sh (and run.sh's prerequisite check) refuse, with a clear message naming the other checkout and the command to stop it, when a process on 8545 or 8787 was started from a different checkout than this one (compare its working directory or its --state path with this checkout's core/state). Touch spikes/skeleton/core/bin/ and spikes/skeleton/run.sh's prerequisite lines only.
## Why
The test stack silently ran another checkout's chain and Core; every eval after B1 failed, and only a careful read of the log showed why.
## Done when
- up.sh refuses a stack started from another checkout, with the message, and still starts and reuses its own; shown by a test script the coordinator can run (bash -n passes; a lane cannot run the stack)
