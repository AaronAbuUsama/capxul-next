import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSite, htmlFile } from "#src/modules/site/service.ts";
import { fixtureAssets, fixtureInput, WAITING } from "#src/testing.ts";

import { highlight } from "./internal/highlight.ts";
import { paragraphs, rich, sentences } from "./internal/prose.ts";
import { renderSite } from "./service.ts";
import { SCRIPT_FILE, STYLE_FILE } from "./types.ts";

const site = buildSite(fixtureInput());
const files = renderSite(site, fixtureAssets);
const html = (page: string): string => files.get(htmlFile(page)) ?? assert.fail(`no page ${page}`);

test("one HTML file per page, one stylesheet and one script", () => {
  assert.equal(files.size, site.pages.length + 2);
  for (const page of site.pages) assert.ok(files.has(htmlFile(page.id)), `no file for ${page.id}`);
  assert.equal(files.get(STYLE_FILE), fixtureAssets.css);
  assert.equal(files.get(SCRIPT_FILE), fixtureAssets.js);
});

test("every page is a whole document with the six sections in its top bar and its two twins linked", () => {
  for (const page of site.pages) {
    const text = html(page.id);
    assert.ok(text.startsWith("<!doctype html>"), `${page.id} is not a document`);
    for (const label of ["Overview", "Questions", "Concepts", "Architecture", "Build", "Docs"]) assert.ok(text.includes(`>${label}`), `${page.id}: no ${label} in the bar`);
    assert.ok(text.includes('rel="alternate"') && text.includes(".md") && text.includes(".json"), `${page.id}: no twins`);
    assert.ok(text.includes('<meta name="commit" content="abc1234">'), `${page.id}: no commit`);
  }
});

test("no link starts at the host's root, so the site works from a folder and from file://", () => {
  for (const [file, text] of files) {
    if (!file.endsWith(".html")) continue;
    assert.equal(/\s(?:href|src)="\//.test(text), false, `${file} has a root-relative link`);
  }
  assert.ok(html("operation/org.member.invite").includes('href="../../assets/style.css"'));
  assert.ok(html("index").includes('href="assets/style.css"'));
});

test("text from the blueprint is escaped", () => {
  assert.equal(html("index").includes("<script>alert"), false);
  for (const page of site.pages) assert.equal(/<td[^>]*>[^<]*<(?!\/?(?:a|span|code|b|em|br|div|ul|li|ol|p|table|tr|td|th|thead|tbody|details|summary|strong|small|svg|h3|h4)\b)/.test(html(page.id)), false, `${page.id}: an unknown tag in a cell`);
});

test("the Questions page carries each question with its three ways to answer and works without the script", () => {
  const text = html("review");
  assert.ok(text.includes(`id="q-${WAITING}"`));
  assert.ok(text.includes(`name="option-${WAITING}" value="owners" checked`), "the recommended option is not the one chosen");
  assert.ok(text.includes(`name="option-${WAITING}" value="admins"`), "the other option cannot be chosen");
  for (const act of ["accept", "change", "send"]) assert.ok(text.includes(`data-act="${act}"`), `no button to ${act}`);
  assert.ok(text.includes(`<textarea id="change-${WAITING}"`), "no place to say it another way");
  assert.ok(text.includes("<noscript>"));
  assert.ok(text.includes("An invitation gives a person a way in."));
});

test("an operation page shows the command, the old CLI as reference, the returns and the stand", () => {
  const text = html("operation/org.member.invite");
  assert.ok(text.includes("org member invite"));
  assert.ok(text.includes("reference, old CLI") || text.includes("Reference, old CLI"));
  assert.ok(text.includes("--role"));
  assert.ok(text.includes('id="returns"'));
  assert.ok(text.includes("Where it stands") && text.includes("decision access.who-invites waits for an answer"));
  assert.equal(html("operation/invite.accept").includes("--role"), false);
});

test("a record page carries the record's key and hash", () => {
  const text = html("operation/invite.accept");
  assert.ok(text.includes('<meta name="record" content="operation:invite.accept">'));
  assert.ok(/<meta name="record-hash" content="[0-9a-f]+">/.test(text));
});

test("long text is split into short paragraphs, never inside backticks, brackets or after an abbreviation", () => {
  assert.deepEqual(sentences("One. Two (see K13. Not a stop) goes on. Use `a. B` here, e.g. This one. Last"),
    ["One.", "Two (see K13. Not a stop) goes on.", "Use `a. B` here, e.g. This one.", "Last"]);
  assert.deepEqual(paragraphs("Short text. It stays whole."), ["Short text. It stays whole."]);
  const long = Array.from({ length: 7 }, (_, i) => `Sentence number ${i + 1} says a good deal about the payment and what it changes in the ledger.`).join(" ");
  const parts = paragraphs(long);
  assert.ok(parts.length >= 2 && parts.every((p) => sentences(p).length <= 4), JSON.stringify(parts));
  assert.equal(parts.join(" "), long, "the splitter changed a word");
  assert.deepEqual(paragraphs(long), parts);
});

test("a bracketed citation is drawn quiet, and links when it names a record", () => {
  const cites = new Map([["access.who-invites", "decision/access.who-invites"]]);
  const drawn = rich("index", "Old rule (old S3) and (access.who-invites), not (an ordinary aside) or `(K13)`.", cites);
  assert.ok(drawn.includes('<span class="cite">(old S3)</span>'));
  assert.ok(drawn.includes('<span class="cite">(<a href="decision/access.who-invites/index.html">access.who-invites</a>)</span>'));
  assert.ok(drawn.includes("(an ordinary aside)") && drawn.includes("<code>(K13)</code>"));
  assert.equal(rich("index", "<b> & (x<y)", cites), "&lt;b&gt; &amp; (x&lt;y)");
});

test("code is highlighted by token and escaped", () => {
  const json = highlight('{ "id": "<string>", "n": 3, "ok": true, "s": "a<b" }', "json");
  assert.ok(json.includes('<span class="tk-key">&quot;id&quot;</span>') && json.includes('<span class="tk-ph">&quot;&lt;string&gt;&quot;</span>'));
  assert.ok(json.includes('<span class="tk-num">3</span>') && json.includes('<span class="tk-kw">true</span>') && json.includes('<span class="tk-str">&quot;a&lt;b&quot;</span>'));
  const bash = highlight("# pay\npayment send <to> [amount] --asset USDC", "bash");
  assert.ok(bash.includes('<span class="tk-com"># pay</span>') && bash.includes('<span class="tk-arg">&lt;to&gt;</span>') && bash.includes('<span class="tk-flag">--asset</span>'));
  const ts = highlight("type Input = { amount?: string };\nconst output: Output = await client.pay(input); // go", "ts");
  assert.ok(ts.includes('<span class="tk-kw">type</span>') && ts.includes('<span class="tk-key">amount</span>') && ts.includes('<span class="tk-type">string</span>') && ts.includes('<span class="tk-com">// go</span>'));
  assert.equal(highlight("<script>", "text"), "&lt;script&gt;");
});

test("an operation page shows the call twice, the skeleton, the trace and every eval by kind", () => {
  const text = html("operation/invite.accept");
  for (const id of ['id="call-cli"', 'id="call-sdk"', 'id="run"', 'id="evals-acc"', 'id="evals-ret"']) assert.ok(text.includes(id), `no ${id}`);
  assert.ok(text.includes("generated from the schema, not a recorded response"));
  assert.ok(text.includes("the blueprint names none"), "an empty row of the trace is left out");
  assert.equal(text.includes("All ") && text.includes("evals, with their ids"), false, "the evals are still folded");
  assert.ok(html("review").includes('class="tk-') === false && html("review").includes("answer-json"));
});

test("every count is a link, and Docs is tables, never cards", () => {
  assert.ok(html("index").includes('class="cell cell-link" href="docs/commands/index.html"'));
  assert.ok(html("concept/organizations").includes('class="cell cell-link" href="#tables"'));
  assert.ok(html("build").includes('href="eval/index.html"') || html("build").includes('href="../eval/index.html"'));
  for (const id of ["docs", "docs/events", "docs/errors", "docs/spans", "eval", "eval/acc", "design"]) {
    assert.ok(html(id).includes("<table"), `${id} has no table`);
  }
  assert.equal(html("docs").includes('class="noun"'), false);
  assert.ok(html("design").includes("Direction, hand-written") && html("design").includes('id="silent"'));
});
