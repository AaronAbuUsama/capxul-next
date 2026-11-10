/** What may be shown of a text: secret-looking values are replaced, then the text is cut. Applied to every free text in a view. */
const SHAPES: readonly RegExp[] = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/g,
  /\b(?:ghp|gho|ghu|ghs|github_pat|glpat|xox[abprs])[-_A-Za-z0-9]{8,}/g,
  /\bAKIA[0-9A-Z]{12,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]+){0,2}/g,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b[A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSW(?:OR)?D|CREDENTIAL|AUTH)[A-Za-z0-9_]*\s*[=:]\s*\S+/gi,
  /\b(?:[0-9a-f]{32,}|[A-Za-z0-9+]{40,}={0,2})\b/g,   // not `/`, `_` or `-`: a long path is not a key
];
/** Names of environment variables whose values are never shown. */
const SECRET_NAME = /KEY|TOKEN|SECRET|PASS|CRED|AUTH|PRIVATE|COOKIE|SESSION/i;

/** The values of the environment that look like secrets, longest first, for `scrub` to look for in a text. */
export const secretsOf = (env: Readonly<Record<string, string | undefined>>): readonly string[] =>
  Object.entries(env).flatMap(([k, v]) => (SECRET_NAME.test(k) && typeof v === "string" && v.length >= 8 ? [v] : [])).sort((a, b) => b.length - a.length);

export const scrub = (text: string, secrets: readonly string[], cap: number): string => {
  let out = text.replace(/\s+/g, " ").trim().replace(/\b([0-9a-f]{7})[0-9a-f]{33}\b/g, "$1");   // a commit shows as its short form
  for (const s of secrets) out = out.split(s).join("[hidden]");
  for (const shape of SHAPES) out = out.replace(shape, "[hidden]");
  return out.length <= cap ? out : `${out.slice(0, cap - 1)}…`;
};

/** `scrub` for a text of several lines: each line keeps its place, nothing secret-looking is left, and the whole is cut at `cap` with a note of how much was cut. */
export const scrubText = (text: string, secrets: readonly string[], cap: number): string => {
  let out = text;
  for (const s of secrets) out = out.split(s).join("[hidden]");
  for (const shape of SHAPES) out = out.replace(shape, "[hidden]");
  return out.length <= cap ? out : `${out.slice(0, cap)}\n… ${out.length - cap} more characters`;
};
