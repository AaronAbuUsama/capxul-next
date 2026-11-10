/**
 * GENERIC. The door of a run that is being played.
 *
 * One process owns a run's storage: the one that plays it. Only that process can put a note into an agent's
 * conversation. So while it plays, it opens a door on this machine, and another process (the host a page attaches to)
 * hands notes through it. A run that is not being played has no door: nothing can be sent to it, and the sender is told.
 *
 * The door is HTTP on 127.0.0.1 with a token made for this play and written where only this machine's user reads it
 * (the run's `status.json`). A request without the token, or one that a web page sent (it carries an `Origin`), is
 * refused: a page somewhere else cannot steer an agent by posting to localhost.
 */

/** A note from a person to a working agent. `steer`: it joins after the agent's current tool call. `queue`: it waits for the agent's turn to end. */
export interface Note { readonly agent: string; readonly text: string; readonly mode: "steer" | "queue" }

/** What became of a note, in words a person reads. */
export interface Said { readonly ok: boolean; readonly said: string }

/** Where a door is, and the token that opens it. Kept in the run's status file while the run is played. */
export interface DoorAt { readonly port: number; readonly token: string }

export interface DoorDeps {
  /** Puts the note into the agent's conversation, or says why not. The owner's policy lives here. */
  readonly note: (n: Note) => Promise<Said>;
}

export interface Door { readonly at: DoorAt; close(): Promise<void> }

/** The longest note, in characters. */
export const MAX_NOTE = 4000;
export const TOKEN_HEADER = "x-loop-door";
