// Arguments: `--name value` pairs and bare `--flag`s; everything else is positional. (The older commands in cli.ts read the raw array.)
export type Parsed = { pos: string[]; flags: Record<string, string | true> };
export function parseArgs(args: string[]): Parsed {
  const pos: string[] = [], flags: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith("--")) { pos.push(a); continue; }
    const next = args[i + 1];
    if (next !== undefined && !next.startsWith("--")) { flags[a.slice(2)] = next; i++; } else flags[a.slice(2)] = true;
  }
  return { pos, flags };
}
