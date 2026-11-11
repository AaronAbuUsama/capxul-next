## What
Short scripts in loops/ that read as the workflow: a lane, a sandbox (none, a light chain, or a heavy world with a site), a maker, the gates, the checkers and the rounds. A runner that makes each run durable and resumable from files, gives it its own working copy, claims and closes its task in the plan, and never merges unless the gates pass. It reuses the earlier swarm design's roles and hand-back shapes.
## Why
Aaron asked for it: just enough machinery in the repository that the coordinator, a person, Claude or Codex can start a task, watch it and steer it, without swarmD and without the coordinator starting every thread by hand.
## Done when
- pnpm loop run <task> takes a real task from the plan to ready-to-merge or blocked, with nobody starting agents by hand
- A run killed half way resumes and finishes
- A script is short enough to read in a minute
