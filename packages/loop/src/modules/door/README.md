# door (generic)

How a person's note reaches a working agent. One process owns a run's storage, the one that plays it, and only it can
put a note into a conversation. While it plays, it opens a door (`openDoor`): HTTP on 127.0.0.1, a free port, and a
token made for this play. It writes both into the run's `status.json`. Any other process on this machine that can read
that file (the host a page attaches to) hands a note through with `knock`. `types.ts` is the module.

- A note is `{ agent, text, mode }`. `steer`: the agent reads it after its current tool call. `queue`: it reads it when
  its turn ends, and then goes on. What becomes of it comes back in words (`Said`).
- The door refuses a request without the token, and any request a web page sent (it carries an `Origin`), so a page
  somewhere else cannot steer an agent by posting to localhost.
- A run that is not being played has no door. `knock` then says so; nothing is kept for later.
- Who may be written to is the owner's rule (`deps.note`), not the door's.

The page never talks to a door: it calls the host's `note`, and the host knocks.
