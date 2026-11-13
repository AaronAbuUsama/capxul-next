# The thin line, extracted

This folder holds the input for roadmap step 1.1 ([docs/roadmap.md](../roadmap.md)): what the old blueprint under
`blueprint/` records for the thin line's twelve operations. [operations.md](operations.md) is for people and
[operations.json](operations.json) holds the same content for a program. Both are extracted, not designed: every
value is read from a record, an example or a decision, and each operation names its sources by file and line.
Nothing here is the new contract, and no program reads these files. They were written once, by a preparing agent,
from `master` at commit `92ac4f2`, and are not kept in step with the blueprint afterwards.
