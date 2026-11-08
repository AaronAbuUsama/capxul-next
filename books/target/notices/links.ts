// Links from notices to the records of board, a concept it depends on that is being designed at the
// same time. Each link is board's own record, by its conventional export name, as soon as
// board/data.ts loads and exports it; until then it is a bare reference by the conventional id,
// which the build reports as `dangling`. `PENDING` is the whole set. The transition names are the
// frozen text's (`board_seat_transitioned` reports `seated`; a Board proposal is born waiting for its
// Directors); board's designer may name them otherwise, and then these follow. Every other link of
// this concept is a plain static import. When board lands, these become static imports.
//
// Equity is designed at the same time too, but its data.ts has landed with the records notices needs,
// so equity.ts imports them directly.
//
// This module is not in ./index.ts's `modules`: it re-exports links, never records of its own.

import type { Kind, Ref, TransitionRef } from "../../../packages/book/src/index.ts";

/** A sibling module's exports, or none while it does not exist or does not load yet. */
const load = async (path: string): Promise<Record<string, unknown>> => {
  try {
    return (await import(path)) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const pick = <K extends Kind>(from: Record<string, unknown>, exportName: string, kind: K, id: string): Ref<K> => {
  const found = from[exportName] as { _kind?: unknown } | undefined;
  return found && found._kind === kind ? (found as Ref<K>) : { _kind: kind, id };
};

/** A machine's transition by name, or a bare reference `<machine id>.<name>` while the machine is not there. */
const pickTransition = (from: Record<string, unknown>, exportName: string, machineId: string, name: string): TransitionRef => {
  const found = from[exportName] as { _kind?: unknown; t?: Record<string, TransitionRef> } | undefined;
  const t = found && found._kind === "machine" ? found.t?.[name] : undefined;
  return t ?? { _kind: "transition", id: `${machineId}.${name}`, machine: machineId, name };
};

const boardData = await load("../board/data.ts");

// ── board: Directors' seats and Board proposals ─────────────────────────────────────────────

/** A Director's seat on an Organization's Board: who was seated, from which member, and when it landed. */
export const table_board_seats = pick(boardData, "table_board_seats", "table", "board-seats");
/** A seat landed on chain: the member's Safe now signs the company Safe (`board_seat_transitioned`, seated). */
export const transition_board_seat_seat = pickTransition(boardData, "machine_board_seat", "board-seat", "seat");
/** A Board proposal: the company Safe transaction, its summary, its proposer and the Organization. */
export const table_proposals = pick(boardData, "table_proposals", "table", "proposals");
/** A Board proposal is born, waiting for its Directors' approvals (`proposal_transitioned`, from no state). */
export const transition_proposal_propose = pickTransition(boardData, "machine_proposal", "proposal", "propose");

/** The pending links: concept, export name and conventional id. */
export const PENDING = [
  ["board", "table_board_seats", "board-seats"],
  ["board", "machine_board_seat.t.seat", "board-seat.seat"],
  ["board", "table_proposals", "proposals"],
  ["board", "machine_proposal.t.propose", "proposal.propose"],
] as const;
