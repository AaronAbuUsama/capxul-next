// Where a chain's JSON-RPC reads go (ADR-0044 decision 7): an ordered list of
// endpoint URLs per chain, read from configuration. No provider is named here;
// an endpoint is known only by its place in the list, `node_1` first.
//
// `<CHAIN>_RPC_URLS` lists every endpoint in the order a read tries them.
// `<CHAIN>_LOG_RPC_URLS`, when set, names the ones that take wide log reads
// (`eth_getLogs` over many blocks); the others are skipped for those. While
// `<CHAIN>_RPC_URLS` is unset, the older per-provider names are read instead,
// so a deployment that still sets them keeps its routing (CAP-1011 removes
// them).

export const RPC_NODE_NAMES = ["node_1", "node_2", "node_3", "node_4"] as const;
export type RpcNodeName = (typeof RPC_NODE_NAMES)[number];

export interface RpcEndpoint {
  readonly name: RpcNodeName;
  readonly url: string;
  /** False when the endpoint cannot answer a wide `eth_getLogs`, so those skip it. */
  readonly wideLogReads: boolean;
}

/** The configuration prefix of each chain Capxul reads. */
export const RPC_CHAIN_PREFIXES = { 84532: "BASE_SEPOLIA", 8453: "BASE_MAINNET" } as const;

type Read = (name: string) => string | undefined;

const stripSlash = (url: string) => url.replace(/\/+$/u, "");

function urlList(read: Read, name: string): readonly string[] {
  const raw = read(name);
  if (raw === undefined || raw.trim() === "") return [];
  const urls = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map(stripSlash);
  for (const url of urls) {
    const parsed = URL.canParse(url) ? new URL(url) : undefined;
    if (parsed === undefined || (parsed.protocol !== "https:" && parsed.protocol !== "http:"))
      throw new Error(`${name} must list http(s) URLs separated by commas`);
  }
  if (new Set(urls).size !== urls.length) throw new Error(`${name} lists one URL twice`);
  return urls;
}

type Entry = readonly [url: string, wideLogReads: boolean];

/** Which older hosted name a URL belongs to, by its host; the first never took wide log reads. */
function hostedKind(url: string): "narrow" | "wide" | undefined {
  const host = URL.canParse(url) ? new URL(url).hostname : "";
  if (host === "alchemy.com" || host.endsWith(".alchemy.com")) return "narrow";
  if (host === "infura.io" || host.endsWith(".infura.io")) return "wide";
  return undefined;
}

/**
 * The older names, read only while `<CHAIN>_RPC_URLS` is unset, in the order
 * they always ran: the two hosted fallbacks, then the public node; or a
 * configured self-run node first, then the hosted ones.
 */
function legacyList(read: Read, prefix: string, fallbackUrl: string | undefined): readonly Entry[] {
  const hosted: { narrow?: string; wide?: string } = {};
  const names = [
    [`${prefix}_ALCHEMY_RPC_URL`, "narrow"],
    [`${prefix}_INFURA_RPC_URL`, "wide"],
    [`${prefix}_EVIDENCE_RPC_URL`, undefined],
    [`${prefix}_RPC_URL`, undefined],
  ] as const;
  for (const [name, declared] of names) {
    const url = read(name)?.trim();
    if (url === undefined || url === "") continue;
    const kind = hostedKind(url) ?? declared;
    if (kind !== undefined && hosted[kind] === undefined) hosted[kind] = stripSlash(url);
  }
  const hostedEntries: Entry[] = [
    ...(hosted.narrow === undefined ? [] : [[hosted.narrow, false] as const]),
    ...(hosted.wide === undefined ? [] : [[hosted.wide, true] as const]),
  ];
  const override = read(`${prefix}_RPC_URL`)?.trim();
  const ownNode =
    override !== undefined && override !== "" && hostedKind(override) === undefined
      ? stripSlash(override)
      : undefined;
  const node = ownNode ?? (fallbackUrl === undefined ? undefined : stripSlash(fallbackUrl));
  if (node === undefined) return hostedEntries;
  const nodeEntry: Entry = [node, true];
  const fallback = fallbackUrl === undefined ? undefined : stripSlash(fallbackUrl);
  const list = node === fallback ? [...hostedEntries, nodeEntry] : [nodeEntry, ...hostedEntries];
  return list.filter(([url], index) => list.findIndex(([seen]) => seen === url) === index);
}

/**
 * A chain's endpoints in the order a read tries them. `fallbackUrl` is the
 * public node used when no node is configured. Throws when the configuration is malformed, so a
 * deployment fails at start rather than reading from the wrong place.
 */
export function rpcEndpoints(
  read: Read,
  prefix: string,
  fallbackUrl?: string,
): readonly RpcEndpoint[] {
  const urls = urlList(read, `${prefix}_RPC_URLS`);
  const logUrls = urlList(read, `${prefix}_LOG_RPC_URLS`);
  if (urls.length === 0 && logUrls.length > 0)
    throw new Error(`${prefix}_LOG_RPC_URLS needs ${prefix}_RPC_URLS`);
  for (const url of logUrls)
    if (!urls.includes(url))
      throw new Error(`${prefix}_LOG_RPC_URLS may name only URLs from ${prefix}_RPC_URLS`);
  const entries: readonly Entry[] =
    urls.length > 0
      ? urls.map((url) => [url, logUrls.length === 0 || logUrls.includes(url)] as const)
      : legacyList(read, prefix, fallbackUrl);
  if (entries.length > RPC_NODE_NAMES.length)
    throw new Error(`${prefix}_RPC_URLS lists more than ${String(RPC_NODE_NAMES.length)} URLs`);
  return entries.map(([url, wideLogReads], index) => ({
    name: RPC_NODE_NAMES[index] ?? "node_4",
    url,
    wideLogReads,
  }));
}

/** The endpoints a method may try: a wide log read skips those that cannot answer it. */
export function endpointsFor(
  method: string,
  endpoints: readonly RpcEndpoint[],
): readonly RpcEndpoint[] {
  if (method !== "eth_getLogs") return endpoints;
  const wide = endpoints.filter((endpoint) => endpoint.wideLogReads);
  return wide.length === 0 ? endpoints : wide;
}
