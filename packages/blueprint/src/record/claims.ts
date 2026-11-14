// The acceptance claims of record.export. Rendered into claims.md.
import { claim, kept, type ClaimsOf } from "../claims/claim.ts";
import { NotWorldOwner } from "../errors.ts";
import { startingWorlds as w } from "../starting-worlds.ts";
import * as Record from "./operations.ts";

export const exportRecord: ClaimsOf = {
  operation: Record.exportRecord,
  claims: [
    claim(
      "An export carries the lineage and every entry once.",
      w.restored,
      "record.export of the restored world answers a lineage naming the first world, `m3` and its record position, and entries 1 to the head, each once, in order: the first world's entries up to that position, entry for entry as record.export at the first world's door answers them, then `world_created`.",
      { origin: kept("record.export/c-bd1acd26102d2d92"), thinLine: true },
    ),
    claim(
      "The record is the world's events: every event a successful call emitted is one entry, in order, carrying exactly what the event carried, and a refused call or a read adds none.",
      w.paid,
      "For every call made in making the starting world (the `calls` fact) in the world exported, record.export holds that call's declared events under its trace id, carrying what its declaration computes from the call's payload and answer, in the order the calls were made; a refused call and a report.run hold none. A call made in another world, the one whose snapshot a restored world was made from, left its events there: the restored world's record holds under its trace either exactly those events (copied with the snapshot, when the call came before its position) or none. The journey's own successful calls at the exported world's door add their declared events likewise, in the order they were made.",
    ),
    claim(
      "Only the world's owner may export the record.",
      w.fresh,
      "record.export as dana is refused with NotWorldOwner.",
      {
        refusals: [NotWorldOwner],
      },
    ),
    claim(
      "A range answers only the entries from and to the positions asked, and a range past the head answers none.",
      w.paid,
      "record.export from 2 to 3 answers entries 2 and 3; from the head plus one answers no entries and the same head.",
    ),
  ],
  dropped: [],
};
