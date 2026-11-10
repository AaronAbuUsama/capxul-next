// The standard loop: one maker, one or more checkers, rounds. Run it with:  pnpm loop run <task id> --script pair
import { agent, blocked, gate, handback, lane, makerPrompt, ready, review, sandbox, settle, type Finding, type Handback, type Job } from "../packages/loop/src/index.ts";

export default async function pair(job: Job): Promise<void> {
  await lane(job);                                     // a worktree on lane/<task>, cut from integration/build
  await sandbox(job);                                  // none, light or heavy, as --sandbox says
  const checkers = job.opts.checkers ?? job.task.checkers;
  let open: Finding[] = [], last: Handback | undefined, from: string | undefined;

  for (let round = 1; round <= job.opts.rounds; round++) {
    const made = await agent(job, `make.${round}`, { role: "builder", prompt: makerPrompt(job, round, open, last) });
    last = handback(made);
    if (last?.ask) return blocked(job, [`the maker asked: ${last.ask.text}`]);          // a real fork: the coordinator answers

    const gates = await gate(job, `gates.${round}`);                                    // the repository's checks, run by the runner
    const checks = await Promise.all(checkers.map((role) =>                             // each checker: fresh context, read-only tools
      review(job, `${role}.${round}`, { role, round, made, gates, open, ...(from ? { from } : {}) })));

    open = settle(round, open, gates, checks);                                          // failed gates and blocking findings go back
    if (!made.ok) open.push({ id: `F-${round}.0`, severity: "blocking", text: `The maker did not finish: ${made.error}` });
    if (open.length === 0 && checks.every((c) => c.verdict === "approve")) return ready(job);   // push lane/<task>; merge is the coordinator's
    from = made.head;                                                                   // the next review reads only the delta
  }
  return blocked(job, open.map((f) => `${f.id} ${f.check ?? ""}: ${f.text}`.slice(0, 300)));    // out of rounds: stop, with the reasons
}
