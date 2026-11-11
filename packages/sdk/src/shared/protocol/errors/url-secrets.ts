import { maskText } from "./secret-material.ts";
import { isCredentialField } from "./credential-fields.ts";

function decodeUrlComponent(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function isCoinbaseRpcPath(hostname: string, segments: readonly string[]): boolean {
  return (
    hostname === "api.developer.coinbase.com" &&
    decodeUrlComponent(segments[1] ?? "") === "rpc" &&
    decodeUrlComponent(segments[2] ?? "") === "v1"
  );
}

/**
 * Whose URL a value is, when the caller knows: a configured RPC `node`, whose
 * path may carry its key, or the AA `gateway`, whose path is its token.
 */
export type UrlCredentialSource = "node" | "gateway";

/** The credential source of a `chain.upstream` value: any configured node, or the gateway. */
export function urlCredentialSource(upstream: unknown): UrlCredentialSource | undefined {
  if (upstream === "gateway") return "gateway";
  return typeof upstream === "string" && /^node_[1-4]$/u.test(upstream) ? "node" : undefined;
}

/** Preserve URL diagnostics while removing credentials from their declared components. */
export function redactUrlSecrets(value: string, source?: UrlCredentialSource): string {
  try {
    const absolute = /^[a-z][a-z0-9+.-]*:/iu.test(value);
    const protocolRelative = value.startsWith("//");
    const url = new URL(value, "https://redaction.invalid");
    if (url.protocol !== "https:" && url.protocol !== "http:") return maskText(value);
    let changed = url.username.length > 0 || url.password.length > 0;
    const maskParams = (params: URLSearchParams): string =>
      new URLSearchParams(
        Array.from(params, ([name, entry]) => {
          const safeName = maskText(name);
          const safeEntry =
            isCredentialField(name) || /^(?:code|draft|__posthog)$/iu.test(name)
              ? "[REDACTED]"
              : maskText(entry);
          changed ||= safeName !== name || safeEntry !== entry;
          return [safeName, safeEntry];
        }),
      ).toString();
    const provider = /(?:^|\.)(?:alchemy\.com|alchemyapi\.io|infura\.io)$/iu.test(url.hostname);
    const rawPath = absolute || protocolRelative ? url.pathname : (value.split(/[?#]/u)[0] ?? "");
    const segments = rawPath.split("/");
    const coinbaseRpc = isCoinbaseRpcPath(url.hostname, segments);
    let path = segments
      .map((segment, index) => {
        const decoded = decodeUrlComponent(segment);
        const masked =
          ((provider && /^v[23]$/u.test(decodeUrlComponent(segments[index - 1] ?? ""))) ||
            (coinbaseRpc && index === 4)) &&
          decoded.length > 0
            ? "[REDACTED]"
            : maskText(decoded);
        changed ||= masked !== decoded;
        return masked === decoded ? segment : encodeURIComponent(masked);
      })
      .join("/");
    // The gateway compares the entire decoded path with its configured token,
    // and a configured node's path may be its key.
    if (source !== undefined && rawPath.length > 0) {
      path = `${rawPath.startsWith("/") ? "/" : ""}${encodeURIComponent("[REDACTED]")}`;
      changed = true;
    }
    const query = maskParams(url.searchParams);
    const fragment = url.hash.slice(1);
    const decodedFragment = decodeUrlComponent(fragment);
    const maskedFragment = maskText(decodedFragment);
    changed ||= maskedFragment !== decodedFragment;
    const fragmentQuery = fragment.indexOf("?");
    const fragmentPath = fragment.slice(0, fragmentQuery);
    const maskedFragmentPath = maskText(decodeUrlComponent(fragmentPath));
    changed ||= maskedFragmentPath !== decodeUrlComponent(fragmentPath);
    const hash =
      fragmentQuery >= 0
        ? `${maskedFragmentPath === decodeUrlComponent(fragmentPath) ? fragmentPath : encodeURIComponent(maskedFragmentPath)}?${maskParams(new URLSearchParams(fragment.slice(fragmentQuery + 1)))}`
        : fragment.includes("=")
          ? maskParams(new URLSearchParams(fragment))
          : maskedFragment === decodedFragment
            ? fragment
            : encodeURIComponent(maskedFragment);
    const origin = absolute ? url.origin : protocolRelative ? `//${url.host}` : "";
    if (!changed) return value;
    return `${origin}${path}${query ? `?${query}` : ""}${hash ? `#${hash}` : ""}`;
  } catch {
    if (source !== undefined) return "[REDACTED]";
    const withoutUserinfo = value.replace(/(https?:\/\/)[^/\s@]+@/giu, "$1[REDACTED]@");
    return maskText(
      withoutUserinfo.replace(
        /([?&#])([^=&#]+)=([^&#]*)/gu,
        (whole, separator: string, name: string) =>
          isCredentialField(decodeUrlComponent(name)) ||
          /^(?:code|draft|__posthog)$/iu.test(decodeUrlComponent(name))
            ? `${separator}${name}=[REDACTED]`
            : whole,
      ),
    );
  }
}
