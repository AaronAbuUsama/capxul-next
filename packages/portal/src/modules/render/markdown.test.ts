import assert from "node:assert/strict";
import { test } from "node:test";

import { inline, markdown } from "./internal/markdown.ts";

test("headings, paragraphs, bullet and numbered lists, with a wrapped line joined to its item", () => {
  const html = markdown("### Part\n\nOne line\nand another.\n\n- first\n  wrapped\n- second\n\n1. one\n2. two\n");
  assert.equal(html, '<div class="md"><h3>Part</h3><p>One line and another.</p><ul><li>first wrapped</li><li>second</li></ul><ol><li>one</li><li>two</li></ol></div>');
});

test("inline code, bold, italics and links; everything else is escaped", () => {
  assert.equal(inline("**bold** and *soft* and `x < y`"), "<strong>bold</strong> and <em>soft</em> and <code>x &lt; y</code>");
  assert.equal(inline("<script>alert(1)</script> & more"), "&lt;script&gt;alert(1)&lt;/script&gt; &amp; more");
  assert.equal(inline("[the site](https://example.org/a?b=1&c=2)"), '<a href="https://example.org/a?b=1&amp;c=2" rel="noopener">the site</a>');
  assert.equal(inline("`**not bold**`"), "<code>**not bold**</code>", "nothing inside code is Markdown");
});

test("a repository path is shown as a path, in code or as a link, and is never linked", () => {
  assert.equal(inline("`docs/mission/cloud.md`"), '<code class="path">docs/mission/cloud.md</code>');
  assert.equal(inline("`pnpm plan show`"), "<code>pnpm plan show</code>");
  assert.equal(inline("see [the book](docs/design-book.md)"), 'see the book <code class="path">docs/design-book.md</code>');
  assert.doesNotMatch(inline("[x](javascript:alert(1))"), /<a /);
});
