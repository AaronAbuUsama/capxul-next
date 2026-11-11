/** Reading the plan's Markdown files: their `##` sections, bullets and first sentences. Reading only; nothing is rewritten. */

export interface Section { readonly heading: string; readonly body: string }

/** The `## ` sections of a file, in order. A `# ` title, and anything before the first `## `, is not a section. */
export const sectionsOf = (md: string): readonly Section[] => {
  const out: { heading: string; lines: string[] }[] = [];
  for (const line of md.split("\n")) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) out.push({ heading: h[1] ?? "", lines: [] });
    else if (!/^#\s/.test(line)) out[out.length - 1]?.lines.push(line);
  }
  return out.map((s) => ({ heading: s.heading, body: s.lines.join("\n").trim() }));
};

export const sectionBody = (md: string, heading: string): string =>
  sectionsOf(md).find((s) => s.heading.toLowerCase() === heading.toLowerCase())?.body ?? "";

/** The `- ` bullets of a section body, one string each (a wrapped bullet is joined). */
export const bulletsOf = (body: string): readonly string[] =>
  body.split("\n").reduce<string[]>((out, line) => {
    const b = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    if (b) return [...out, b[1] ?? ""];
    return line.trim() !== "" && out.length > 0 && /^\s+/.test(line) ? [...out.slice(0, -1), `${out[out.length - 1]} ${line.trim()}`] : out;
  }, []);

/** The first `n` sentences of a body's opening paragraph, as plain text. */
export const sentences = (body: string, n: number): string => {
  const first = body.split(/\n\s*\n/)[0]?.replace(/\s+/g, " ").trim() ?? "";
  const parts = first.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) ?? [first];
  return parts.slice(0, n).join("").trim();
};

/** A task file's stub, from the words of its `add` command. */
export const taskFile = (what: string, why: string, doneWhen: readonly string[], needs: readonly string[]): string =>
  [`## What`, what.trim(), `## Why`, why.trim(), `## Done when`, ...doneWhen.map((d) => `- ${d.trim()}`), ...(needs.length ? ["## Needs", ...needs.map((n) => `- ${n}`)] : [])].join("\n") + "\n";
