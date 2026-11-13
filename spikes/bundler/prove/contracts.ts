// The two test contracts the proof puts on a world's chain, compiled from the repository's own sources with solc 0.8.28
// (the version packages/contracts pins), so nothing compiled is copied into this spike:
//   MockPaymaster  packages/contracts/test/mocks/MockPaymaster.sol  sponsors every UserOperation from its deposit
//   MockERC20      packages/contracts/test/mocks/MockERC20.sol      a test token with open mint
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as Effect from "effect/Effect";
import type { Hex } from "viem";

const CONTRACTS = `${import.meta.dirname}/../../../packages/contracts`;
const SOURCES = { MockPaymaster: "test/mocks/MockPaymaster.sol", MockERC20: "test/mocks/MockERC20.sol" } as const;

interface Solc {
  readonly compile: (input: string, callbacks: { readonly import: (path: string) => { contents?: string; error?: string } }) => string;
}

/** Where an import resolves: the vendored OpenZeppelin in lib/, as foundry.toml's remapping does, or the package. */
const resolve = (path: string) =>
  path.startsWith("@openzeppelin/contracts/")
    ? `${CONTRACTS}/lib/openzeppelin/contracts/${path.slice("@openzeppelin/contracts/".length)}`
    : `${CONTRACTS}/${path}`;

export type Compiled = Record<keyof typeof SOURCES, Hex>;

/** Each contract's creation code, compiled as packages/contracts compiles (cancun, optimizer 200 runs). */
export const compile = Effect.sync((): Compiled => {
  const solc = createRequire(import.meta.url)("solc") as Solc;
  const input = {
    language: "Solidity",
    sources: Object.fromEntries(Object.values(SOURCES).map((path) => [path, { content: readFileSync(resolve(path), "utf8") }])),
    settings: {
      evmVersion: "cancun",
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["evm.bytecode.object"] } },
    },
  };
  const output = JSON.parse(
    solc.compile(JSON.stringify(input), {
      import: (path) => {
        try {
          return { contents: readFileSync(resolve(path), "utf8") };
        } catch {
          return { error: `not found: ${path}` };
        }
      },
    }),
  ) as {
    errors?: ReadonlyArray<{ severity: string; formattedMessage: string }>;
    contracts: Record<string, Record<string, { evm: { bytecode: { object: string } } }>>;
  };
  const errors = (output.errors ?? []).filter((e) => e.severity === "error");
  if (errors.length > 0) throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
  const code = (name: keyof typeof SOURCES): Hex => `0x${output.contracts[SOURCES[name]]![name]!.evm.bytecode.object}`;
  return { MockPaymaster: code("MockPaymaster"), MockERC20: code("MockERC20") };
});
