// time.no-direct-reads, as a plain scan (decisions devnet.one-world-clock and time.no-direct-reads). Pure: the entry reads files.

/** rebound: replaced at runtime by the world clock. real-on-purpose: time.real-elapsed's measures and protections. world: reads the world clock.
 *  owed: business time still on the host, with its owner; it passes the scan but keeps inv:time.no-direct-reads false until none remain. */
export type Label = "rebound" | "real-on-purpose" | "world" | "owed";
/** One labelled read: the whole trimmed source line, and how many lines of the file are exactly that line (default 1). */
export type Read = { file: string; line: string; hits?: number; label: Label; why: string; owner?: string };
/** Clock work a decision promises that no scanned line shows, such as a pinned app's read still to be pointed at the world. */
export type OwedWork = { id: string; owner: string; what: string };
/** include: path globs scanned (`*` is one path segment); exclude: prefixes of tooling that is not product code, each with its reason.
 *  module: the one clock module (time.no-direct-reads); reads inside it are the door itself and take no label. */
export type Allowlist = { include: string[]; exclude: Record<string, string>; module: string; reads: Read[]; work?: OwedWork[] };
export type Problem = { at: string; why: string };

const LABELS: readonly Label[] = ["rebound", "real-on-purpose", "world", "owed"];
const JS = [/\bDate\.now\(/, /\bnew Date\(\s*\)/, /\bperformance\.now\(/];
const PY = [/\bdatetime\.(now|utcnow|today)\(/, /\bdate\.today\(/, /\btime\.(time|time_ns)\(/];
// SQL's clock, in Postgres and MariaDB spellings. `now()` counts unless it is a method or member (`x.now()`); `<now()` counts.
const SQL = [/(?<![\w.$])now\(\s*\)/i, /\b(current_timestamp|current_date|current_time|localtimestamp|localtime)\b/i,
  /\b(clock_timestamp|transaction_timestamp|statement_timestamp|timeofday|sysdate|utc_timestamp|utc_date|curdate|curtime)\s*\(/i];
const CODE = /\.(ts|tsx|mts|cts|js|mjs|cjs|py|sql)$/;

const glob = (pattern: string, file: string): boolean =>
  new RegExp(`^${pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]+")}`).test(file);

export const inScope = (file: string, allow: Pick<Allowlist, "include" | "exclude">): boolean =>
  allow.include.some((pattern) => glob(pattern, file)) && !Object.keys(allow.exclude).some((prefix) => file.startsWith(prefix)) &&
  !/(^|\/)(node_modules|tests?|generated)\//.test(file) && !/\.(test|native)\.[cm]?[jt]sx?$/.test(file) && CODE.test(file);

/** Every line of a scanned file that reads the host's clock. SQL patterns apply everywhere: SQL lives in .sql, TypeScript and Python strings. */
export function hostReads(file: string, text: string): { line: number; text: string }[] {
  const patterns = file.endsWith(".py") ? [...PY, ...SQL] : file.endsWith(".sql") ? SQL : [...JS, ...SQL];
  return text.split("\n").flatMap((line, index) => {
    // An injected clock function named `now` (await now()) is the caller's clock, not a host read.
    const code = line.replace(/await now\(\)/g, "");
    return patterns.some((p) => p.test(code)) ? [{ line: index + 1, text: line.trim() }] : [];
  });
}

/** Each host read must be labelled by an entry naming its whole line, and each entry must label exactly its count of lines. */
export function checkTime(files: { path: string; text: string }[], allow: Allowlist): { problems: Problem[]; owed: (Read | OwedWork)[] } {
  const problems: Problem[] = [], seen = new Map<Read, number>();
  for (const read of allow.reads) {
    if (!LABELS.includes(read.label)) problems.push({ at: read.file, why: `label ${read.label} is not one of ${LABELS.join(", ")}` });
    if (!read.why?.trim()) problems.push({ at: read.file, why: `the read "${read.line}" has no reason` });
    if (allow.module && read.file.startsWith(allow.module)) problems.push({ at: read.file, why: "the clock module needs no labels; remove the entry" });
    if (read.label === "owed" && !read.owner) problems.push({ at: read.file, why: `owed read "${read.line}" names no owner` });
  }
  for (const work of allow.work ?? []) if (!work.owner?.trim() || !work.what?.trim()) problems.push({ at: work.id, why: "owed work needs an owner and what is owed" });
  for (const [prefix, why] of Object.entries(allow.exclude)) if (!why?.trim()) problems.push({ at: prefix, why: "an excluded path needs its reason" });
  for (const { path, text } of files) {
    if (allow.module && path.startsWith(allow.module)) continue;
    for (const hit of hostReads(path, text)) {
      const entry = allow.reads.find((read) => read.file === path && read.line === hit.text);
      if (entry) seen.set(entry, (seen.get(entry) ?? 0) + 1);
      else problems.push({ at: `${path}:${hit.line}`, why: `unlabelled host clock read: ${hit.text.slice(0, 120)}` });
    }
  }
  for (const read of allow.reads) {
    const count = seen.get(read) ?? 0, expected = read.hits ?? 1;
    if (count === 0) problems.push({ at: read.file, why: `allowlist entry "${read.line.slice(0, 80)}" labels no read; remove it` });
    else if (count !== expected) problems.push({ at: read.file, why: `"${read.line.slice(0, 80)}" occurs on ${count} lines, labelled for ${expected}; label each new read` });
  }
  return { problems, owed: [...allow.reads.filter((read) => read.label === "owed"), ...(allow.work ?? [])] };
}
