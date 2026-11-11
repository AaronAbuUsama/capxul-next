import { isCredentialField } from "./credential-fields.ts";
import { type UrlCredentialSource, redactUrlSecrets } from "./url-secrets.ts";

// Parse scalar labelled values, then classify their names with the shared registry.
const JSON_FIELD =
  /("(?:[^"\\]|\\.)*")(\s*:\s*)("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/gu;

const PROSE_FIELD =
  /(?=(\b([A-Za-z][A-Za-z0-9_-]*(?:[ \t]+[A-Za-z][A-Za-z0-9_-]*){0,3})\s*[:=]\s*((?:Bearer|Basic)[ \t]+[^\s,;"']+|"(?:[^"\\]|\\[\s\S])*(?:"|\\?$)|'(?:[^'\\]|\\[\s\S])*(?:'|\\?$)|[^\s,;&"']+)))/gu;

const EMBEDDED_URL = /(https?:\/\/[^\s"<>]*)/giu;

// Masked before labelled values, which would otherwise consume the BEGIN marker.
const PEM_PRIVATE_KEY =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/gu;

const REQUEST_BODY_LABEL = /^request[ _-]?body$/iu;

function isSecretLabel(name: string): boolean {
  // Preserve the existing unstructured request-body exclusion. Structured
  // bodies use field-level projection instead of this prose compatibility rule.
  return isCredentialField(name) || REQUEST_BODY_LABEL.test(name);
}

const REQUEST_BODY_SCAN_MAX = 4_096;

/**
 * A labelled request body hides its whole JSON value; any other unquoted value
 * hides the rest of its line. A JSON body that does not close within the
 * bounded scan hides the rest of the text, so a cut body fails closed and
 * repeated unbalanced bodies stay linear.
 */
function requestBodyEnd(text: string, start: number): number {
  const newline = text.indexOf("\n", start);
  const lineEnd = newline < 0 ? text.length : newline;
  if (text[start] !== "{" && text[start] !== "[") return lineEnd;
  const limit = Math.min(text.length, start + REQUEST_BODY_SCAN_MAX);
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < limit; index++) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{" || character === "[") depth++;
    else if ((character === "}" || character === "]") && --depth === 0) return index + 1;
  }
  return text.length;
}

const JSON_ENCODING_MAX = 8;

const JSON_NESTING_MAX = 64;

const JSON_KEY = /("(?:[^"\\]|\\.)*")\s*:/gu;

const JSON_CONTAINER_START = /(?:\{\s*["}]|\[\s*[[\]{}"0-9tfn-])/uy;

function hasSecretJsonKey(value: string): boolean {
  for (const match of value.matchAll(JSON_KEY)) {
    try {
      if (match[1] !== undefined && isSecretLabel(JSON.parse(match[1]))) return true;
    } catch {
      // Invalid key escapes are not a parsed JSON field.
    }
  }
  return false;
}

/** Project a complete fragment once. Never retry all of its nested substrings. */
function projectJsonFragment(value: string, encodingDepth: number, overDepth: boolean): string {
  if (overDepth || encodingDepth >= JSON_ENCODING_MAX) return "[REDACTED]";
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return hasSecretJsonKey(value) ? "[REDACTED]" : value;
  }
  try {
    let changed = false;
    const masked = JSON.stringify(parsed, (name, nested: unknown) => {
      if (isSecretLabel(name)) {
        changed ||= nested !== "[REDACTED]";
        return "[REDACTED]";
      }
      if (typeof nested === "string") {
        const projected = maskJsonFragments(nested, encodingDepth + 1);
        changed ||= projected !== nested;
        return projected;
      }
      return nested;
    });
    return changed ? masked : value;
  } catch {
    return "[REDACTED]";
  }
}

/** Scan balanced object/array fragments once, respecting JSON quotes and escapes. */
function maskJsonFragments(value: string, encodingDepth = 0): string {
  if (value.trimStart().startsWith('"')) {
    try {
      const decoded: unknown = JSON.parse(value);
      if (typeof decoded === "string") {
        if (encodingDepth >= JSON_ENCODING_MAX) return '"[REDACTED]"';
        const masked = maskJsonFragments(decoded, encodingDepth + 1);
        return masked === decoded ? value : JSON.stringify(masked);
      }
    } catch {
      // The string is prose or an incomplete JSON string. Scan its fragments.
    }
  }
  let output = "";
  let cursor = 0;
  let start = -1;
  let depth = 0;
  let overDepth = false;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (start < 0) {
      JSON_CONTAINER_START.lastIndex = index;
      if (!JSON_CONTAINER_START.test(value)) continue;
      start = index;
      depth = 1;
      overDepth = false;
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{" || character === "[") {
      depth++;
      overDepth ||= depth > JSON_NESTING_MAX;
    } else if (character === "}" || character === "]") {
      depth--;
      if (depth !== 0) continue;
      output +=
        value.slice(cursor, start) +
        projectJsonFragment(value.slice(start, index + 1), encodingDepth, overDepth);
      cursor = index + 1;
      start = -1;
    }
  }
  if (start >= 0) {
    const fragment = value.slice(start);
    output +=
      value.slice(cursor, start) +
      (overDepth || hasSecretJsonKey(fragment) ? "[REDACTED]" : fragment);
    cursor = value.length;
  }
  return output + value.slice(cursor);
}

function maskLabelledText(value: string): string {
  const jsonMasked = maskJsonFragments(value.replace(PEM_PRIVATE_KEY, "[REDACTED]")).replace(
    JSON_FIELD,
    (whole, quotedName: string, separator: string) => {
      try {
        const name: string = JSON.parse(quotedName);
        return isSecretLabel(name) ? `${quotedName}${separator}"[REDACTED]"` : whole;
      } catch {
        return whole;
      }
    },
  );
  let output = "";
  let cursor = 0;
  // Look ahead so an unrelated label such as `Error: token=...` cannot
  // consume and hide the credential match inside its value.
  for (const match of jsonMasked.matchAll(PROSE_FIELD)) {
    const [, whole, label, entry] = match;
    if (
      whole === undefined ||
      label === undefined ||
      entry === undefined ||
      match.index < cursor ||
      /^Bearer[ \t]+/iu.test(entry)
    )
      continue;
    const words = label.split(/[ \t]+/u);
    for (let index = 0; index < words.length; index++) {
      const name = words.slice(index).join(" ");
      if (isSecretLabel(name)) {
        const prefix = words.slice(0, index).join(" ");
        output +=
          jsonMasked.slice(cursor, match.index) + `${prefix ? `${prefix} ` : ""}${name}=[REDACTED]`;
        cursor = match.index + whole.length;
        if (REQUEST_BODY_LABEL.test(name) && !/^["']/u.test(entry))
          cursor = requestBodyEnd(jsonMasked, cursor - entry.length);
        break;
      }
    }
  }
  return output + jsonMasked.slice(cursor);
}

const TOKEN_MASKS: readonly (readonly [RegExp, string])[] = [
  [
    /\bBearer\s+(?!(?:realm|error|error_description|scope|authorization_uri|resource|claims)\s*=)[^\s,;"']+/giu,
    "Bearer [REDACTED]",
  ],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[REDACTED]"],
  [/(^|[^a-fA-F0-9])(?<!0[xX])[a-fA-F0-9]{64}(?=$|[^a-fA-F0-9])/gu, "$1[REDACTED]"],
  [
    /(?:(?:sk|pk|rk)_(?:live|test)|(?:phc|phx|ghp|gho|ghu|ghs|ghr|whsec)_|github_pat_|xox[baprs]-|AKIA[0-9A-Z]{16}|AIza)[A-Za-z0-9_-]*/giu,
    "[REDACTED]",
  ],
];

/** URL components and malformed URLs use this non-recursive masking layer. */
export function maskText(value: string): string {
  let text = maskLabelledText(value);
  for (const [pattern, replacement] of TOKEN_MASKS) text = text.replace(pattern, replacement);
  return text;
}

/** Reject only when the same semantic sanitizer removes credential material. */
export function containsSensitiveMaterial(value: string): boolean {
  return redactSecrets(value) !== value;
}

/** Mask credential fields and embedded URLs while preserving surrounding evidence. */
export function redactSecrets(value: string, source?: UrlCredentialSource): string {
  return maskLabelledText(value)
    .split(EMBEDDED_URL)
    .map((part, index) =>
      index % 2 === 1
        ? redactUrlSecrets(part, source).replaceAll("%5BREDACTED%5D", "[REDACTED]")
        : maskText(part),
    )
    .join("");
}
