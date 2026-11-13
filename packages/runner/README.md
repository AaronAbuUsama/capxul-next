# runner

The scenario runner (roadmap step 1.2). It runs the scenarios of `packages/scenarios` against a world through
Core's door, supplying each its `Capxul` client, and applies the same generic checks to every call: the declared
events, the call's spans, and its timings, caller side and server side, recorded next to the operation's budget and
never enforced. It writes one JSON run record per run under `records/`.

| Folder | What it holds |
|---|---|
| `records/spike/` | The pipeline spike's three green runs, the Proof of roadmap step 0.7. |
