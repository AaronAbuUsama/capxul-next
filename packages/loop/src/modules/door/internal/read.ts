/** A request's body as a note, or why it is not one. Pure. */
import { MAX_NOTE, type Note } from "../types.ts";

export const noteOf = (body: string): Note | string => {
  let j: unknown;
  try { j = JSON.parse(body); } catch { return "the body is not JSON"; }
  const n = (j && typeof j === "object" ? j : {}) as { agent?: unknown; text?: unknown; mode?: unknown };
  if (typeof n.agent !== "string" || n.agent === "") return "the note names no agent";
  if (typeof n.text !== "string" || n.text.trim() === "") return "the note says nothing";
  if (n.text.length > MAX_NOTE) return `a note is at most ${MAX_NOTE} characters`;
  if (n.mode !== "steer" && n.mode !== "queue") return "mode is steer or queue";
  return { agent: n.agent, text: n.text.trim(), mode: n.mode };
};
