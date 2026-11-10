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
      ...waiting.filter((id) => !shown.includes(id)).map((id) => `${id}: waits in the book, not on the Questions page`),
      ...shown.filter((id) => !waiting.includes(id)).map((id) => `${id}: on the Questions page, does not wait in the book`),
      `the Questions page lists ${shown.length} in its order, the judgments list ${waiting.length} in the book's`,
    ];
};

export const stands = (files: ReadonlyMap<string, string>, operations: readonly string[]): readonly string[] =>
  operations.flatMap((id) => {
    const stand = read(files, `data/operation/${id}.json`)?.["stand"];
    const name = isFields(stand) ? stand["stand"] : undefined;
    return typeof name === "string" && STANDS.has(name) ? [] : [`operation/${id}: no stand`];
  });

/** The rows of every `eval/<kind>` page, counted: they must be exactly the evals the book derives. */
export const evals = (files: ReadonlyMap<string, string>, expected: number): readonly string[] => {
  const listed = [...files.keys()].filter((file) => /^data\/eval\/[^/]+\.json$/.test(file)).reduce((n, file) => {
    const sections = read(files, file)?.["sections"];
    return n + (Array.isArray(sections) ? sections : []).reduce((m: number, s: unknown) => m + (isFields(s) && Array.isArray(s["rows"]) ? s["rows"].length : 0), 0);
  }, 0);
  return listed === expected ? [] : [`the eval catalogue lists ${listed} evals, the book derives ${expected}`];
};

/** The Plan page's JSON twin lists every task of the plan once, by state. */
export const planTasks = (files: ReadonlyMap<string, string>, expected: number | null): readonly string[] => {
  if (expected === null) return [];
  const groups = read(files, "data/plan.json")?.["groups"];
  const listed = (Array.isArray(groups) ? groups : []).reduce((n: number, g: unknown) => n + (isFields(g) && Array.isArray(g["tasks"]) ? g["tasks"].length : 0), 0);
  return listed === expected ? [] : [`the Plan page lists ${listed} tasks, the plan holds ${expected}`];
};
