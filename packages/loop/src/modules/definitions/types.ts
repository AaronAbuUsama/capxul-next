/**
 * GENERIC. An agent as a record. One definition says everything about one agent: its name, its model, its standing
 * instructions, the tools it is handed, what its shell may run, its skills and the sandbox it needs. A definition is
 * plain data (no functions, no patterns), so a run can record the one an agent ran under, a page can show it, and a
 * screen can write one.
 *
 * Nothing here knows which tools, shells or sandboxes exist: the caller says (`Vocabulary`), and a definition that names
 * something else is a problem, found when it is loaded and never when an agent is half-way through its work.
 */

/** What a person writes, in a file of its own (`defineAgent`). Paths are relative to that file. */
export interface AgentDefinition {
  /** Lower-case letters, digits and dashes. A script asks for the agent by this name. */
  readonly name: string;
  /** One line a roster can show: what this agent is for. */
  readonly description: string;
  /** The model it uses when the run names no other for its side: a gateway's id (`gpt-6.1-sol`) or `provider/id`. */
  readonly model: string;
  /**
   * Which of a run's two model choices replaces `model`: the maker's or the checker's. A run keeps the two apart so a
   * review is on a different model from the work it reviews. Absent: the maker's.
   */
  readonly side?: Side;
  /** Its standing instructions: a markdown file. A front matter block at its top is dropped. */
  readonly instructions: string;
  /** The tools it is handed, by name, and no others: a tool that is not listed is refused when it is called. */
  readonly tools: readonly string[];
  /** What its shell may run (bash, and a command it records): the name of one of the caller's lists. */
  readonly shell: string;
  /** Its skills: each a `SKILL.md`. The agent is told each one's name and description and reads the file when it uses it. */
  readonly skills?: readonly string[];
  /** The least sandbox it needs, by the caller's name for it. Absent: it needs none. */
  readonly sandbox?: string;
}

export type Side = "maker" | "checker";

/** A skill as an agent is told of it. The body stays in its file. */
export interface Skill { readonly name: string; readonly description: string; readonly file: string }

/** A definition after it was loaded: every path followed, every default filled in. */
export interface Agent {
  readonly name: string;
  readonly description: string;
  readonly model: string;
  readonly side: Side;
  /** The instructions' text. */
  readonly instructions: string;
  readonly tools: readonly string[];
  readonly shell: string;
  readonly skills: readonly Skill[];
  readonly sandbox?: string;
  /** The definition's own file. */
  readonly file: string;
}

/** What a caller can hand out, by name. A definition may name only these. `sandboxes` goes from the least to the most. */
export interface Vocabulary {
  readonly tools: readonly string[];
  readonly shells: readonly string[];
  readonly sandboxes: readonly string[];
}

/** What loading a folder found: the agents that are sound, and why each of the others is not. */
export interface Loaded { readonly agents: readonly Agent[]; readonly problems: readonly string[] }
