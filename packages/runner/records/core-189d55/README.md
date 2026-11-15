# core-189d55

`./run.sh scenarios --one-stage --expect=not-implemented` on 13 November 2026, step 1.5's proof: all 54 registered
scenarios (the 53 claims and the example) in one fresh stage, each failing on the `NotImplemented` Core's empty
handlers answered, every call passing every check. `summary.json` is `passed`; each scenario's record (`failed`, by
design) is a line of `scenarios.jsonl`; `leftovers.txt` shows the accounts empty afterwards.
