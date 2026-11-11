import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { agentNamed, defineAgent, loadAgents, resolveAgent, type AgentDefinition, type Vocabulary } from "./service.ts";

const KNOWN: Vocabulary = { tools: ["read", "write", "bash"], shells: ["write", "read"], sandboxes: ["none", "light"] };
const SOUND: AgentDefinition = { name: "maker", description: "Makes a thing.", model: "m-1", instructions: "./maker.md", tools: ["read", "write", "bash"], shell: "write" };

/** A folder of definitions as a person would keep it: a file an agent, the instructions and a skill beside them. */
const folder = (files: Record<string, unknown>): string => {
  const dir = mkdtempSync(join(tmpdir(), "loop-definitions-"));
  mkdirSync(join(dir, "skills/careful"), { recursive: true });
  writeFileSync(join(dir, "maker.md"), "---\nname: maker\ntools: Read\n---\n\nYou make one thing.\n\nThen you stop.\n");
  writeFileSync(join(dir, "skills/careful/SKILL.md"), "---\ndescription: \"Check twice before you write.\"\n---\n\nThe long text an agent reads when it uses the skill.\n");
  writeFileSync(join(dir, "skills/unsaid.md"), "No front matter here.\n");
  for (const [name, d] of Object.entries(files)) writeFileSync(join(dir, name), typeof d === "string" ? d : `export default ${JSON.stringify(d)};\n`);
  return dir;
};

test("a folder of definitions is loaded: each file's default export, its paths followed from the file, its defaults filled in", async () => {
  const dir = folder({ "maker.ts": { ...SOUND, skills: ["./skills/careful/SKILL.md"], sandbox: "light" }, "looker.ts": { ...SOUND, name: "looker", side: "checker", tools: ["read"], shell: "read" } });
  const { agents, problems } = await loadAgents(dir, KNOWN);
  assert.deepEqual(problems, []);
  assert.deepEqual(agents.map((a) => a.name), ["looker", "maker"]);
  const maker = agentNamed(agents, "maker")!;
  assert.equal(maker.instructions, "You make one thing.\n\nThen you stop.");          // the front matter is another reader's
  assert.deepEqual(maker.skills, [{ name: "careful", description: "Check twice before you write.", file: join(dir, "skills/careful/SKILL.md") }]);
  assert.deepEqual([maker.side, maker.sandbox, maker.file], ["maker", "light", join(dir, "maker.ts")]);
  assert.equal(agentNamed(agents, "looker")!.side, "checker");
  assert.equal(agentNamed(agents, "nobody"), undefined);
  assert.deepEqual(await loadAgents(join(dir, "not-there"), KNOWN), { agents: [], problems: [] });
  assert.equal(defineAgent(SOUND), SOUND);                                             // a definition is the data it was written as
});

test("a definition that is not sound is a problem that says which and why, and that agent is left out", async () => {
  const dir = folder({
    "a-twin.ts": SOUND, "maker.ts": SOUND, "broken.ts": "throw new Error('no such thing');\n", "empty.ts": "export const other = 1;\n",
    "wrong.ts": { name: "Wrong One", model: "", instructions: "./gone.md", tools: ["read", "fly", "read"], shell: "root", side: "both", sandbox: "heavy", skills: ["./skills/unsaid.md", "./skills/gone.md"] },
  });
  const { agents, problems } = await loadAgents(dir, KNOWN), said = problems.join("\n");
  assert.deepEqual(agents.map((a) => [a.name, a.file]), [["maker", join(dir, "a-twin.ts")]]);
  for (const why of [
    /maker \(.*maker\.ts\): .*a-twin\.ts already defines an agent of that name/, /broken\.ts: it cannot be loaded: no such thing/, /empty\.ts: its default export is not a definition/,
    /wrong\.ts\): a definition's name is lower-case letters, digits and dashes/, /it has no description/, /it names no model/, /its side is maker or checker/, /there is no tool named fly: the tools are read, write, bash/,
    /it lists a tool twice/, /its shell is one of write, read/, /its sandbox is one of none, light/, /its instructions are not at .*gone\.md/, /the skill at .*unsaid\.md has no description/, /its skill is not at .*skills\/gone\.md/,
  ]) assert.match(said, why);
  assert.deepEqual(resolveAgent({ ...SOUND, tools: [] }, join(dir, "x.ts"), KNOWN).problems, [`maker (${join(dir, "x.ts")}): it lists no tools`]);
});
