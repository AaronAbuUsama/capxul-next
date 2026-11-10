/**
 * How the policy reads a command line: as the shell would, without running it. Text inside quotes or a here-document is
 * one word, given to the program; only what the shell itself acts on (the cuts between commands, redirections,
 * substitutions) is taken out and judged. So `node -e 'x => y'` and `grep -E 'a|b' f` are each one command, and `>` in a
 * program's text is not a redirection.
 */

/** One command of a line: its words with the quotes removed, where its output is sent, and what the shell would do that the policy never allows. */
export interface Command {
  readonly words: readonly string[];
  readonly redirects: readonly string[];
  readonly forbidden?: string;
}

/** Undefined when a quote or a here-document is left open. */
export const commandsOf = (line: string): Command[] | undefined => {
  const out: Command[] = [];
  let words: string[] = [], redirects: string[] = [], word = "", started = false, quote = "", forbidden: string | undefined, toFile = false;
  const heredocs: string[] = [];
  const endWord = () => {
    if (started) { if (toFile) { redirects.push(word); toFile = false; } else words.push(word); }
    word = ""; started = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length || redirects.length || forbidden) out.push({ words, redirects, ...(forbidden ? { forbidden } : {}) });
    words = []; redirects = []; forbidden = undefined;
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote === "'") { if (c === "'") quote = ""; else word += c; continue; }
    if (quote === '"') {
      if (c === '"') { quote = ""; continue; }
      if (c === "\\" && i + 1 < line.length) { word += line[++i]!; continue; }
      if (c === "`" || (c === "$" && line[i + 1] === "(")) forbidden ??= "command substitutions are not allowed";
      word += c; continue;
    }
    if (c === "\n" && heredocs.length) {
      // the here-document's body is the program's input: one word for the command that asked for it
      for (const tag of heredocs.splice(0)) {
        const end = line.indexOf(`\n${tag}`, i);
        if (end < 0) return undefined;
        words.push(line.slice(i + 1, end));
        i = end + tag.length;
        while (i + 1 < line.length && line[i + 1] !== "\n") i++;
      }
      endCommand(); continue;
    }
    if (c === "'" || c === '"') { quote = c; started = true; continue; }
    if (c === "\\" && i + 1 < line.length) { word += line[++i]!; started = true; continue; }
    if (c === " " || c === "\t") { endWord(); continue; }
    const two = line.slice(i, i + 2);
    if (two === "&&" || two === "||") { endCommand(); i++; continue; }
    if (c === ";" || c === "|" || c === "\n" || c === "&") { endCommand(); continue; }
    if (c === "`" || (c === "$" && line[i + 1] === "(")) { forbidden ??= "command substitutions are not allowed"; word += c; started = true; continue; }
    if ((c === "<" || c === ">") && line[i + 1] === "(") { forbidden ??= "process substitutions are not allowed"; word += c; started = true; continue; }
    if (two === "<<" && line[i + 2] !== "<") {
      endWord();
      const m = /^<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line.slice(i));
      if (!m) { forbidden ??= "this here-document is not allowed"; i++; continue; }
      heredocs.push(m[2]!); i += m[0].length - 1; continue;
    }
    if (c === "<") { forbidden ??= "input redirection is not allowed: name the file as an argument, or use the read tool"; continue; }
    if (c === ">") {
      if (/^\d$/.test(word) && started) { word = ""; started = false; } else endWord();   // 2> belongs to the redirection
      if (line[i + 1] === ">") i++;
      if (line[i + 1] === "&") { i++; while (/\d/.test(line[i + 1] ?? "")) i++; continue; }   // 2>&1
      while (line[i + 1] === " ") i++;
      toFile = true; continue;
    }
    word += c; started = true;
  }
  if (quote || heredocs.length) return undefined;
  endCommand();
  return out;
};
