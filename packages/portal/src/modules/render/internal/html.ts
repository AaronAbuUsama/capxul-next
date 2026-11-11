/** The smallest pieces every renderer uses: escaping, links between files of the site, chips. */
import { htmlFile, relative } from "#src/modules/site/service.ts";
import type { Ref } from "#src/modules/site/types.ts";

export const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Escaped text, with `code` spans drawn as code. */
export const prose = (s: string): string => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");

export const count = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
export const plural = (n: number, one: string, many = `${one}s`): string => `${count(n)} ${n === 1 ? one : many}`;

/** The link from the page `at` to another page of the site, or to an anchor on it. An anchor on `at` itself is just `#anchor`. */
export const hrefTo = (at: string, ref: Ref): string =>
  ref.page === at && ref.anchor !== "" ? `#${ref.anchor}` : `${relative(htmlFile(at), htmlFile(ref.page))}${ref.anchor === "" ? "" : `#${ref.anchor}`}`;
/** The link from the page `at` to any file of the site. */
export const fileHref = (at: string, file: string): string => relative(htmlFile(at), file);

export const link = (at: string, ref: Ref, cls = ""): string =>
  `<a${cls === "" ? "" : ` class="${cls}"`} href="${esc(hrefTo(at, ref))}">${esc(ref.label)}</a>`;
export const chip = (text: string, cls = "chip"): string => `<span class="${cls}">${esc(text)}</span>`;

export const ARROW =
  '<svg class="arrow" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 7h10M8 3l4 4-4 4"/></svg>';

/** A heading with its anchor, an optional caption under it, then the section's body. Empty bodies draw nothing. */
export const section = (id: string, title: string, body: string, caption = ""): string =>
  body === "" ? "" :
    `<section class="block"><h2 id="${esc(id)}">${esc(title)}</h2>${caption === "" ? "" : `<p class="caption">${prose(caption)}</p>`}${body}</section>`;

/** `Concepts / Payments / payment send`: each part is HTML already. */
export const crumbs = (parts: readonly string[]): string =>
  `<nav class="crumbs" aria-label="Breadcrumb">${parts.join('<span class="sep">/</span>')}</nav>`;

export const table = (heads: readonly string[], rows: readonly string[], cls = ""): string =>
  `<div class="table-wrap"><table class="table${cls === "" ? "" : ` ${cls}`}"><thead><tr>${heads.map((h) => `<th>${h}</th>`).join("")}</tr></thead>` +
  `<tbody>${rows.join("")}</tbody></table></div>`;
