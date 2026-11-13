// time.no-direct-reads, as a plain scan (decisions devnet.one-world-clock and time.no-direct-reads). Pure: the entry reads files.

/** rebound: replaced at runtime by the world clock. real-on-purpose: time.real-elapsed's measures and protections. world: reads the world clock.
 *  owed: business time still on the host, with its owner; it passes the scan but keeps inv:time.no-direct-reads false until none remain. */
export type Label = "rebound" | "real-on-purpose" | "world" | "owed";
export type Read = { file: string; match: string; label: Label; why: string; owner?: string };
export type Allowlist = { scope: string[]; reads: Read[] };
export type Problem = { at: string; why: string };

const LABELS: readonly Label[] = ["rebound", "real-on-purpose", "world", "owed"];
const TS = [/\bDate\.now\(/, /\bnew Date\(\)/, /\bperformance\.now\(/];
const PY = [/\bdatetime\.now\(/, /\bdatetime\.utcnow\(/, /\btime\.time\(/, /\bdate\.today\(/];
const SQL = [/(?:^|[\s=,(])now\(\)/i, /\bcurrent_timestamp\b/i, /\bcurrent_date\b/i, /\blocaltimestamp\b/i, /\bclock_timestamp\(/i];

export const inScope = (file: string, scope: readonly string[]): boolean =>
  scope.some((prefix) => file.startsWith(prefix)) && !/(^|\/)(node_modules|tests?|generated)\//.test(file) && !/\.test\.ts$/.test(file) && /\.(ts|py|sql)$/.test(file);

/** Every line of a scanned file that reads the host's clock. SQL patterns apply to .sql files and to SQL inside TypeScript. */
export function hostReads(file: string, text: string): { line: number; text: string }[] {
  const patterns = file.endsWith(".py") ? PY : file.endsWith(".sql") ? SQL : [...TS, ...SQL];
  return text.split("\n").flatMap((line, index) => {
    // An injected clock function named `now` (await now()) is the caller's clock, not a host read.
    const code = line.replace(/await now\(\)/g, "");
    return patterns.some((p) => p.test(code)) ? [{ line: index + 1, text: line.trim() }] : [];
  });
}

/** Each host read must be labelled by one allowlist entry, and each entry must still label a read. */
export function checkTime(files: { path: string; text: string }[], allow: Allowlist): { problems: Problem[]; owed: Read[] } {
  const problems: Problem[] = [], used = new Set<Read>();
  for (const read of allow.reads) {
    if (!LABELS.includes(read.label)) problems.push({ at: read.file, why: `label ${read.label} is not one of ${LABELS.join(", ")}` });
    if (!read.why?.trim()) problems.push({ at: read.file, why: `the read matching "${read.match}" has no reason` });
    if (read.label === "owed" && !read.owner) problems.push({ at: read.file, why: `owed read "${read.match}" names no owner` });
  }
  for (const { path, text } of files) {
    for (const hit of hostReads(path, text)) {
      // The longest matching entry labels the line, so a short match cannot shadow a longer, more specific one.
      const entry = allow.reads.filter((read) => read.file === path && hit.text.includes(read.match)).sort((a, b) => b.match.length - a.match.length)[0];
      if (entry) used.add(entry);
      else problems.push({ at: `${path}:${hit.line}`, why: `unlabelled host clock read: ${hit.text.slice(0, 120)}` });
    }
  }
  for (const read of allow.reads) if (!used.has(read)) problems.push({ at: read.file, why: `allowlist entry "${read.match}" labels no read; remove it` });
  return { problems, owed: allow.reads.filter((read) => read.label === "owed") };
}
