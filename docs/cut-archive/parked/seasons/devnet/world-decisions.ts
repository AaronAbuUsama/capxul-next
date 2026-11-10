// Moved out of the built book by the cut, 10 November 2026, from books/target/devnet/world-decisions.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md. Seasons were dropped for now by Aaron's answer to devnet.seasons
// (aaron.seasons-dropped, cut.seasons); the code that follows is as it was when the book last held them.

export const decision_devnet_seasons_on_a_world = dec({
  id: "devnet.seasons-on-a-world",
  title: "Seasons become an optional schedule on a world, deferred, not removed",
  question: "What happens to seasons now that a world is first-class?",
  options: [{ label: "optional-schedule", text: "A season is an optional schedule on a world (start from a saved snapshot, a rate, jumps, an end in a reset). The eleven `dev season` commands and their records stay as they are and are not built first; they address a world by name when they are. aaron.seasons is not changed." }],
  chosen: "optional-schedule",
  why: "docs/mission/worlds.md, section 7, decision 3: defer. aaron.seasons ruled only that a shared world runs in seasons; the schedule and the commands are the book's own.",
  affects: [f.system_capxul, f.concept_devnet, d.table_worlds],
});
