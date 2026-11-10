/**
 * Syntax highlighting at generation time: a small tokenizer for JSON, the command line and TypeScript. Each token
 * becomes a span with a `tk-*` class, coloured on the fixed dark panel; `assets/site.js` uses the same classes for
 * the one block that is built in the browser. Everything is escaped, so code from the book cannot become markup.
 */
import { esc } from "./html.ts";

export type Language = "json" | "bash" | "ts" | "text";

/** A token class and the pattern that finds it at the cursor. The first rule that matches wins. */
type Rule = readonly [cls: string, pattern: RegExp];

const STRING = /"(?:[^"\\\n]|\\.)*"/y;
const RULES: Readonly<Record<Language, readonly Rule[]>> = {
  json: [
    ["com", /\/\/[^\n]*/y],
    ["key", /"(?:[^"\\\n]|\\.)*"(?=\s*:)/y],
    ["ph", /"<[^"\n]*>"/y],
    ["str", STRING],
    ["num", /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y],
    ["kw", /\b(?:true|false|null)\b/y],
  ],
  bash: [
    ["com", /#[^\n]*/y],
    ["prompt", /(?<=^|\n)\$ /y],
    ["str", STRING],
    ["str", /'[^'\n]*'/y],
    ["flag", /(?<=^|\s)--?[A-Za-z][A-Za-z0-9-]*/y],
    ["arg", /<[^>\n]+>|\[[^\]\n]+\]/y],
  ],
  ts: [
    ["com", /\/\/[^\n]*/y],
    ["str", STRING],
    ["str", /'[^'\n]*'/y],
    ["key", /[A-Za-z_$][A-Za-z0-9_$]*(?=\??:)/y],
    ["kw", /\b(?:type|const|declare|await|import|from|export|interface|readonly|function|return|new)\b/y],
    ["type", /\b(?:string|number|boolean|null|undefined|unknown|Record|Array|true|false)\b/y],
    ["num", /\b\d+(?:\.\d+)?\b/y],
  ],
  text: [],
};

/** The code as HTML: each token in its span, everything else as it is. */
export const highlight = (code: string, language: Language): string => {
  const rules = RULES[language];
  let out = "";
  let plain = "";
  let at = 0;
  while (at < code.length) {
    let taken = "";
    let cls = "";
    for (const [name, pattern] of rules) {
      pattern.lastIndex = at;
      const found = pattern.exec(code);
      if (found && found[0] !== "") {
        taken = found[0];
        cls = name;
        break;
      }
    }
    if (taken === "") {
      plain += code[at] ?? "";
      at++;
      continue;
    }
    out += `${esc(plain)}<span class="tk-${cls}">${esc(taken)}</span>`;
    plain = "";
    at += taken.length;
  }
  return out + esc(plain);
};

/** A block of code on the dark panel, under a small label that says what it is. */
export const codeBlock = (label: string, language: Language, code: string): string =>
  `<figure class="code"><figcaption class="code-label">${esc(label)}</figcaption>` +
  `<pre class="code-body"><code>${highlight(code, language)}</code></pre></figure>`;
