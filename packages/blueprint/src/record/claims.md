# Acceptance claims of the domain `record`

Rendered from `claims.ts` here and the declarations by `pnpm claims`. Do not edit it by hand: a test fails when
this file and its sources differ. What the runner checks on every call, and the starting worlds a claim is in,
are in [claims.md](../../claims.md).

## Count

| Operation | Claims | Old, word for word | Old, rewritten | New | Old, not kept |
|---|---|---|---|---|---|
| `record.export` | 4 | 1 | 0 | 3 | 0 |

## 1. `record.export`

- Served by: the world group.
- Refusals: `NotWorldOwner`, `ExportNotAllowed`, `NotImplemented`, and `NotSignedIn` from sign-in.
- Emits: none.
- Budget: 1,500 ms, provisional, excluding waking a parked world. Basis: one indexed read of the world's database; the pipeline spike's record.export read every entry within its 500 ms budget.

1. An export carries the lineage and every entry once. *(thin line)*
   - In: `restored`.
   - Observes: record.export of the restored world answers a lineage naming the first world, `m3` and its record position, and entries 1 to the head, each once, in order: the first world's entries up to that position, entry for entry as record.export at the first world's door answers them, then `world_created`.
   - Old: `acc:record.export/c-bd1acd26102d2d92`, kept word for word.
2. The record is the world's events: every event a successful call emitted is one entry, in order, carrying exactly what the event carried, and a refused call or a read adds none.
   - In: `paid`.
   - Observes: For every call made in making the starting world (the `calls` fact) in the world exported, record.export holds that call's declared events under its trace id, carrying what its declaration computes from the call's payload and answer, in the order the calls were made; a refused call and a report.run hold none. A call made in another world, the one whose snapshot a restored world was made from, left its events there: the restored world's record holds under its trace either exactly those events (copied with the snapshot, when the call came before its position) or none. The journey's own successful calls at the exported world's door add their declared events likewise, in the order they were made.
   - Old: none; this claim is new.
3. Only the world's owner may export the record.
   - In: `fresh`.
   - Observes: record.export as dana is refused with NotWorldOwner.
   - Refusals: `NotWorldOwner`.
   - Old: none; this claim is new.
4. A range answers only the entries from and to the positions asked, and a range past the head answers none.
   - In: `paid`.
   - Observes: record.export from 2 to 3 answers entries 2 and 3; from the head plus one answers no entries and the same head.
   - Old: none; this claim is new.
