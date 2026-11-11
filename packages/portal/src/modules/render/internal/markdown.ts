/**
 * A small Markdown renderer for the plan's files: headings, paragraphs, bullet and numbered lists, inline code, bold,
 * italics and links. Everything is escaped first. A repository path in code, or a link to one, is shown as a path and not
 * linked, because the repository is not served here. No dependency.
 */
import { esc } from "./html.ts";

const PATH = /^[\w.@-]+(?:\/[\w.@<>*-]+)+\/?$/;
const EXTERNAL = /^https?:\/\//;

/** Inline Markdown as HTML. */
export const inline = (text: string): string => {
  const spans: string[] = [];
  // code first, so nothing inside it is read as Markdown; a path is marked as one
  const kept = text.replace(/`([^`]+)`/g, (_, c: string) => {
    spans.push(`<code${PATH.test(c) ? ' class="path"' : ""}>${esc(c)}</code>`);
    return `\u0000${spans.length - 1}\u0000`;
  });
  const html = esc(kept)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, href: string) => {
      const url = href.replaceAll("&amp;", "&");
      return EXTERNAL.test(url) ? `<a href="${esc(url)}" rel="noopener">${label}</a>` : `${label} <code class="path">${esc(url)}</code>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:]|$)/g, "$1<em>$2</em>");
  return html.replace(/\u0000(\d+)\u0000/g, (_, i: string) => spans[Number(i)] ?? "");
};

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBER = /^\s*\d+\.\s+(.*)$/;

/** Markdown as HTML blocks. `### ` and `#### ` become h3 and h4 (a page's own headings sit above them). */
export const markdown = (md: string, cls = "md"): string => {
  const out: string[] = [];
  const lines = md.split("\n");
  let i = 0;
  const list = (tag: "ul" | "ol", shape: RegExp): void => {
    const items: string[] = [];
    while (i < lines.length && shape.test(lines[i] ?? "")) {
      let item = (shape.exec(lines[i] ?? "")?.[1] ?? "").trim();
      i++;
      // a wrapped line belongs to the item above it
      while (i < lines.length && /^\s+\S/.test(lines[i] ?? "") && !BULLET.test(lines[i] ?? "") && !NUMBER.test(lines[i] ?? "")) { item += ` ${(lines[i] ?? "").trim()}`; i++; }
      items.push(`<li>${inline(item)}</li>`);
    }
    out.push(`<${tag}>${items.join("")}</${tag}>`);
  };
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const h = /^(#{3,4})\s+(.+)$/.exec(line);
    if (line.trim() === "") i++;
    else if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").startsWith("```")) { code.push(lines[i] ?? ""); i++; }
      i++;
      out.push(`<div class="code"><pre class="code-body"><code>${esc(code.join("\n"))}</code></pre></div>`);
    } else if (TABLE_ROW.test(line) && TABLE_RULE.test(lines[i + 1] ?? "")) {
      const cells = (row: string): string[] => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i] ?? "")) { rows.push(cells(lines[i] ?? "")); i++; }
      out.push(`<div class="table-wrap"><table class="table"><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>` +
        `${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
    } else if (h) { out.push(`<h${(h[1] ?? "###").length}>${inline(h[2] ?? "")}</h${(h[1] ?? "###").length}>`); i++; }
    else if (BULLET.test(line)) list("ul", BULLET);
    else if (NUMBER.test(line)) list("ol", NUMBER);
    else {
      const para: string[] = [];
      while (i < lines.length && (lines[i] ?? "").trim() !== "" && !BULLET.test(lines[i] ?? "") && !NUMBER.test(lines[i] ?? "") && !/^#{3,4}\s/.test(lines[i] ?? "") && !(lines[i] ?? "").startsWith("```")) { para.push((lines[i] ?? "").trim()); i++; }
      out.push(`<p>${inline(para.join(" "))}</p>`);
    }
  }
  return `<div class="${cls}">${out.join("")}</div>`;
};
