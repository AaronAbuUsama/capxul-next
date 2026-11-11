/** The parts of the check that read the data twins: determinism, the waiting list, each operation's stand, the evals. */

const STANDS = new Set(["specify", "decide", "build", "observe", "done"]);

type Fields = Readonly<Record<string, unknown>>;
const isFields = (u: unknown): u is Fields => typeof u === "object" && u !== null && !Array.isArray(u);

/** A JSON file as an object, or null when it is absent or is not one. */
const read = (files: ReadonlyMap<string, string>, file: string): Fields | null => {
  const text = files.get(file);
  if (text === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return isFields(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const identical = (files: ReadonlyMap<string, string>, again: ReadonlyMap<string, string>): readonly string[] => [
  ...[...files].flatMap(([file, text]) =>
    !again.has(file) ? [`${file}: only in the first generation`] : again.get(file) === text ? [] : [`${file}: differs between two generations`]),
  ...[...again.keys()].filter((file) => !files.has(file)).map((file) => `${file}: only in the second generation`),
];

export const questions = (files: ReadonlyMap<string, string>, waiting: readonly string[]): readonly string[] => {
  const page = read(files, "data/review.json");
  const held = page?.["questions"];
  if (!Array.isArray(held)) return ["data/review.json: no list of questions"];
  const shown = held.map((q: unknown) => (isFields(q) && typeof q["id"] === "string" ? q["id"] : ""));
  return shown.length === waiting.length && shown.every((id, i) => id === waiting[i])
    ? []
    : [
      ...waiting.filter((id) => !shown.includes(id)).map((id) => `${id}: waits on the owner, and is not on the Questions page`),
      ...shown.filter((id) => !waiting.includes(id)).map((id) => `${id}: on the Questions page, and neither a decision that waits nor a need of the owner`),
      `the Questions page lists ${shown.length} in its order, ${waiting.length} wait on the owner`,
    ];
};

export const stands = (files: ReadonlyMap<string, string>, operations: readonly string[]): readonly string[] =>
  operations.flatMap((id) => {
    const stand = read(files, `data/operation/${id}.json`)?.["stand"];
    const name = isFields(stand) ? stand["stand"] : undefined;
    return typeof name === "string" && STANDS.has(name) ? [] : [`operation/${id}: no stand`];
  });

/** The rows of every `eval/<kind>` page, counted: they must be exactly the evals the blueprint derives. */
export const evals = (files: ReadonlyMap<string, string>, expected: number): readonly string[] => {
  const listed = [...files.keys()].filter((file) => /^data\/eval\/[^/]+\.json$/.test(file)).reduce((n, file) => {
    const sections = read(files, file)?.["sections"];
    return n + (Array.isArray(sections) ? sections : []).reduce((m: number, s: unknown) => m + (isFields(s) && Array.isArray(s["rows"]) ? s["rows"].length : 0), 0);
  }, 0);
  return listed === expected ? [] : [`the eval catalogue lists ${listed} evals, the blueprint derives ${expected}`];
};

/** The climb's words must describe its adjacent counts, in both the model and the page people read. */
export const climb = (files: ReadonlyMap<string, string>): readonly string[] => {
  const page = read(files, "data/index.json");
  const cards = page?.["climb"];
  if (!Array.isArray(cards) || cards.length !== 4) return ["Overview: no four climb cards"];
  const failures: string[] = [];
  const questions = read(files, "data/review.json")?.["questions"];
  if (!Array.isArray(questions) || !Array.isArray(page?.["waiting"]) || questions.length !== page["waiting"].length) {
    failures.push("Overview: waiting count differs from Questions");
  }
  const html = files.get("index.html") ?? "";
  // Keep each status paired with the counts in its own rendered card, not
  // just the JSON twin: a renderer can drift while the model stays correct.
  const shown = [...html.matchAll(/<div class="climb-card"><div class="climb-top">[\s\S]*?<span class="climb-status[^"]*">([^<]*)<\/span><\/div><p class="climb-big">([^<]*)<\/p><p class="climb-sub">([^<]*)<\/p>/g)];
  if (shown.length !== 4) failures.push("Overview: no four rendered climb cards");
  const number = (s: unknown): number => Number(String(s).match(/[\d,]+/)?.[0]?.replaceAll(",", "") ?? NaN);
  const format = (n: number): string => n.toLocaleString("en-US");
  for (const [i, card] of cards.entries()) {
    if (!isFields(card)) { failures.push(`Overview: invalid climb card ${i}`); continue; }
    const n = number(card["big"]);
    const waiting = Array.isArray(page?.["waiting"]) ? page["waiting"].length : NaN;
    const problems = Array.isArray(page?.["problems"]) ? page["problems"].length : NaN;
    const gaps = Array.isArray(page?.["gaps"]) ? page["gaps"].length : NaN;
    const wanted = [
      `${format(problems)} ${problems === 1 ? "problem" : "problems"}, ${format(gaps)} ${gaps === 1 ? "gap" : "gaps"}`,
      waiting > 0 ? `${format(waiting)} wait for you` : "Nothing waits for you",
      `${format(n)} at observe or done`, `${format(n)} passing`,
    ][i];
    const rendered = shown[i];
    const renderedCount = number(rendered?.[2]);
    const findings = rendered?.[3]?.match(/^([\d,]+) problems?, ([\d,]+) gaps?,/);
    const renderedWanted = [
      findings ? `${format(number(findings[1]))} ${number(findings[1]) === 1 ? "problem" : "problems"}, ${format(number(findings[2]))} ${number(findings[2]) === 1 ? "gap" : "gaps"}` : "missing finding counts",
      renderedCount > 0 ? `${format(renderedCount)} wait for you` : "Nothing waits for you",
      `${format(renderedCount)} at observe or done`, `${format(renderedCount)} passing`,
    ][i];
    if (card["status"] !== wanted || rendered?.[1] !== renderedWanted ||
        rendered?.[2] !== card["big"] || rendered?.[3] !== card["sub"] || (i === 1 && n !== waiting)) {
      failures.push(`Overview ${String(card["step"])}: status contradicts its count (expected ${wanted})`);
    }
  }
  return failures;
};

/** The Blueprint page: every `generated` marker in its guide became a table, and the record it follows is in the blueprint. */
export const guide = (files: ReadonlyMap<string, string>): readonly string[] => {
  const page = read(files, "data/blueprint.json");
  if (page === null) return ["data/blueprint.json: absent, though the guide is in the repository"];
  const unknown = Array.isArray(page["unknownMarkers"]) ? page["unknownMarkers"].map(String) : [];
  const tables = (Array.isArray(page["sections"]) ? page["sections"] : []).flatMap((s: unknown) =>
    isFields(s) && Array.isArray(s["parts"]) ? s["parts"].filter((p: unknown) => isFields(p) && p["t"] === "table").map((p: Fields) => p["table"]) : []);
  const followed = tables.find((t: unknown) => isFields(t) && t["anchor"] === "followed");
  return [
    ...unknown.map((m) => `docs/blueprint-guide.md: the marker "generated: ${m}" names no table the portal makes`),
    ...(isFields(followed) && Array.isArray(followed["rows"]) && followed["rows"].length > 0 ? [] : ["the Blueprint page follows no record: the operation it names is not in the blueprint"]),
  ];
};
