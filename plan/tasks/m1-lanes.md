## What
Each thread works in its own git worktree on its own branch and is merged into integration/build by the coordinator once the checks pass, as the repository's layout rule already says. The plan records the branch of each thread.
## Why
Several agents shared one working tree. It caused locked commits, a plan tool that crashed while another agent was mid-edit, and a test that wrote into Aaron's answers file.
## Done when
- No two threads write in the same working tree
- A merge that fails a check is refused
