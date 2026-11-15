# The stand-in rehearsal (13 November 2026)

`bin/rehearse.sh pr-p2` ran once from nothing to nothing in a Claude cloud container (`PLATFORM_HOST=standin`,
`PLATFORM_EDGE=none`). Every line quoted is in this folder; `summary.json` holds each step's exit code, the one it
should have and its duration (`"outcome": "passed"`). The deploy on AWS came after (roadmap 2.2,
[../staging/](../staging/)).

| Question | Result | Record |
|---|---|---|
| Is the platform deployed by Alchemy as one stack, and is a second deploy a no-op? | Yes. `Done: 15 succeeded`, 9.2 s with the bench image built (cold, in `pr-p1`: 160.8 s); again: `Plan: no changes`, 11.1 s | `01-deploy.txt` |
| A company site made with a token scoped to its world, the door key read from the shared state? | Yes. Refusals `token-missing`, `token-signature-invalid`, `token-expired`, `site-label-invalid`, `site-quota-reached`; another world's token sees no sites; the site, made in 100.8 s, reads its world and its world's clock | `02-site.txt` |
| Does the drift check catch changed settings and code replaced by hand, exit non-zero, and come back clean after a repair? | Yes. Three hand changes (a DNS record, the worker stopped, a line in the running site service's `door.py`): the pinned `alchemy drift` saw 2 and exited 0; ours saw 3 and exited 2; clean again after the repair | `03-drift.txt`, `drift-*.json` |
| Does destroy leave nothing? | Yes. No container, volume, network, image or context of the stage, nothing in the shared state, no record under `worlds.abuusama.dev` | `04-destroy.txt`, `00-zone-before.txt` |
