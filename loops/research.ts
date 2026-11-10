// A variation: one agent, read-only, a written answer. Run it with:  pnpm loop run <task id> --script research
import { agent, answered, blocked, lane, researchPrompt, sandbox, type Job } from "../packages/loop/src/index.ts";

export default async function research(job: Job): Promise<void> {
  await lane(job, { install: false });                 // a fresh worktree to read; nothing to install
  const box = await sandbox(job);
  const said = await agent(job, "research", { role: "researcher", readOnly: true, prompt: researchPrompt(job.task, box.env.CAPXUL_CHAIN_RPC ?? "") });
  const answer = said.json as { answer?: string; recommendation?: string; sources?: string[] } | undefined;
  if (!said.ok || !answer?.answer) return blocked(job, [`no answer: ${said.error ?? "the last message was not the research json"}`]);
  return answered(job, `${answer.answer}\n\nRecommendation: ${answer.recommendation ?? ""}\nSources: ${(answer.sources ?? []).join(", ")}`);
}
