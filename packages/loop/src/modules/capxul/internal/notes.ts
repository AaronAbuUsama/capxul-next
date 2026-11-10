/**
 * Notes from a person to a working agent, as this repository's runs take them. Only a builder is steered: a checker's
 * check stays its own, so it can be watched and stopped and nothing else. A note reaches an agent through the door of
 * the process that plays its run (modules/door), which `playJob` opens and writes into the run's status file.
 */
import { say } from "../../agents/service.ts";
import { knock, type DoorAt, type Note, type Said } from "../../door/service.ts";
import { alive, readInfo } from "../../runs/service.ts";
import type { Ctx, Job } from "../types.ts";
import { runDir } from "./where.ts";

/** The agents a person may write to: the builder of a round, and the researcher. */
const STEERABLE = /^(make\.\d+|research)$/;

/** The owner's side: put the note into the agent's conversation, or say why not. */
export const takeNote = async (job: Job, n: Note): Promise<Said> => {
  if (!STEERABLE.test(n.agent)) return { ok: false, said: `${n.agent} is a checker: it can be watched and stopped, not steered, so its check stays independent` };
  const said = await say(job.run.host, { key: n.agent, text: n.text, mode: n.mode });
  job.ctx.say(`a note for ${n.agent} (${n.mode}): ${said.said}`);
  return said;
};

/** Any process's side: find the run's door and hand the note through it. */
export const sendNote = async (ctx: Ctx, id: string, n: Note): Promise<Said> => {
  let info;
  try { info = readInfo(runDir(ctx, id)); } catch (e) { return { ok: false, said: e instanceof Error ? e.message : String(e) }; }
  const door = info.extra["door"] as DoorAt | undefined;
  if (info.status !== "running" || !alive(info.pid) || !door) return { ok: false, said: `run ${id} is not being played now: nothing was sent` };
  return knock(door, n);
};
