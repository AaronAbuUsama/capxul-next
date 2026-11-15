# Drift checks on `staging`

Drift records of the shared platform on AWS, each the artifact of a CI run: after platform runs 13 and 15
(`drift-run13.json`, `drift-run15.json`) and a scheduled `drift.yml` run (`drift-scheduled-43625577747.json`). All
clean: 34 resources over `CapxulBenchHost` and `CapxulPlatform`, one setting skipped because AWS's volume attachment
has no read. They are the proof of roadmap items 2.2 and 2.5.
