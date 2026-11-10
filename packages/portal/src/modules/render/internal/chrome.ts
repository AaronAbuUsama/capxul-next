/** The frame around every page: the head, the top bar and the footer. */
import { jsonFile, mdFile } from "#src/modules/site/service.ts";
import type { Page, Ref, Site } from "#src/modules/site/types.ts";

import { SCRIPT_FILE, STYLE_FILE } from "../types.ts";
import { esc, fileHref, hrefTo, plural } from "./html.ts";

const FONTS =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Space+Grotesk:wght@500;600&display=swap";

/** The top-bar entry a page lights up. */
const activeOf = (page: Page): string => {
  switch (page.type) {
    case "overview": return "Overview";
    case "plan": return "Plan";
    case "questions": return "Questions";
    case "architecture": return "Architecture";
    case "build": return "Build";
    case "catalogue": return page.nav;
    case "concept":
    case "operation": return "Concepts";
    case "record": return page.concept ? "Concepts" : "Docs";
  }
};

const head = (site: Site, page: Page): string => [
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  `<title>${esc(page.title)} · Capxul portal</title>`,
  '<meta name="generator" content="@capxul/portal">',
  `<meta name="commit" content="${esc(site.commit)}">`,
  ...(page.recordKey === "" ? [] : [
    `<meta name="record" content="${esc(page.recordKey)}">`,
    `<meta name="record-hash" content="${esc(page.recordHash)}">`,
  ]),
  `<link rel="stylesheet" href="${esc(FONTS)}">`,
  `<link rel="stylesheet" href="${esc(fileHref(page.id, STYLE_FILE))}">`,
  `<link rel="alternate" type="text/markdown" href="${esc(fileHref(page.id, mdFile(page.id)))}">`,
  `<link rel="alternate" type="application/json" href="${esc(fileHref(page.id, jsonFile(page.id)))}">`,
  `<script defer src="${esc(fileHref(page.id, SCRIPT_FILE))}"></script>`,
].join("\n");

const topBar = (site: Site, page: Page, nav: readonly Ref[]): string => {
  const active = activeOf(page);
  const items = nav.map((ref) => {
    const pill = ref.label === "Questions" && site.waiting > 0 ? ` <span class="nav-count" data-total="${site.waiting}" id="nav-questions-count">${site.waiting}</span>` : "";
    return `<a class="nav-item${ref.label === active ? " is-active" : ""}" href="${esc(hrefTo(page.id, ref))}">${esc(ref.label)}${pill}</a>`;
  });
  const home = hrefTo(page.id, { label: "", page: "index", anchor: "" });
  return `<header class="top"><div class="top-in">` +
    `<a class="brand" href="${esc(home)}"><span class="brand-mark"></span><span class="brand-name">Capxul</span><span class="brand-pill">portal</span></a>` +
    `<nav class="nav" aria-label="Sections">${items.join("")}</nav>` +
    `<p class="status"><span class="dot"></span><span>Built from <code>${esc(site.commit)}</code>, ${plural(site.problems, "problem")}</span></p>` +
    `</div></header>`;
};

const footer = (site: Site, page: Page): string =>
  `<footer class="foot"><div class="foot-in"><span>Generated from <code>${esc(page.source)}</code> at commit <code>${esc(site.commit)}</code>.</span>` +
  `<span>This page as <a href="${esc(fileHref(page.id, mdFile(page.id)))}">Markdown</a> or ` +
  `<a href="${esc(fileHref(page.id, jsonFile(page.id)))}">JSON</a></span></div></footer>`;

/** One whole HTML file. `nav` is the top bar's entries; `body` is the page between the bar and the footer. */
export const shell = (site: Site, page: Page, nav: readonly Ref[], body: string): string =>
  `<!doctype html>\n<html lang="en">\n<head>\n${head(site, page)}\n</head>\n<body>\n${topBar(site, page, nav)}\n${body}\n${footer(site, page)}\n</body>\n</html>\n`;
