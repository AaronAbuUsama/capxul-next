// The manifest, and where each entry lands when Companies House delegatecalls CreateCall's `performCreate2`: the creator
// is the Companies House Safe, so an address is a function of the house, the entry's salt and its init code.

import {
  concat,
  encodeAbiParameters,
  getContractAddress,
  isAddress,
  keccak256,
  toBytes,
  type AbiParameter,
  type Hex,
} from "viem";

import type { Artifact, Manifest, ManifestArgument, ManifestEntry, PlannedEntry } from "../types.ts";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** An entry's salt: `keccak256("capxul:v4:<Name>")`. */
export const saltOf = (name: string): Hex => keccak256(toBytes(`capxul:v4:${name}`));

/** Parse `deploy/manifest.json`. Throws, naming the entry, on anything it does not understand. */
export function parseManifest(text: string): Manifest {
  const raw: unknown = JSON.parse(text);
  if (!isRecord(raw) || raw.version !== "v4" || !Array.isArray(raw.contracts)) throw new Error("manifest: not a v4 manifest");
  const contracts = raw.contracts.map((entry: unknown): ManifestEntry => {
    if (!isRecord(entry) || typeof entry.name !== "string" || typeof entry.source !== "string") {
      throw new Error("manifest: an entry needs a name and a source");
    }
    const salt = saltOf(entry.name);
    if (entry.salt !== undefined && entry.salt !== salt) throw new Error(`manifest: ${entry.name}'s salt must be keccak256("capxul:v4:${entry.name}")`);
    const args = entry.constructorArguments ?? {};
    if (!isRecord(args)) throw new Error(`manifest: ${entry.name}'s constructorArguments must be an object`);
    return { name: entry.name, source: entry.source, salt, constructorArguments: args as Record<string, ManifestArgument> };
  });
  if (new Set(contracts.map((c) => c.name)).size !== contracts.length) throw new Error("manifest: a name repeats");
  return { version: "v4", contracts };
}

/** What `forge build` wrote, narrowed to what planning needs. */
export function readArtifact(raw: unknown, label: string): Artifact {
  if (!isRecord(raw) || !isRecord(raw.bytecode) || !isRecord(raw.deployedBytecode) || !Array.isArray(raw.abi)) {
    throw new Error(`${label}: not a Foundry artifact`);
  }
  const creation = raw.bytecode.object;
  const runtime = raw.deployedBytecode.object;
  if (typeof creation !== "string" || creation === "0x" || typeof runtime !== "string") throw new Error(`${label}: no bytecode (an abstract contract or an interface?)`);
  const references = raw.deployedBytecode.immutableReferences;
  const ranges = isRecord(references) ? Object.values(references).flat() : [];
  return {
    abi: raw.abi,
    creation: creation as Hex,
    runtime: runtime as Hex,
    immutables: ranges.flatMap((range) =>
      isRecord(range) && typeof range.start === "number" && typeof range.length === "number" ? [{ start: range.start, length: range.length }] : [],
    ),
  };
}

type Input = AbiParameter & { readonly components?: readonly Input[] };

function resolve(input: Input, value: ManifestArgument, refs: ReadonlyMap<string, Hex>): unknown {
  if (input.type === "tuple") {
    if (!isRecord(value)) throw new Error(`${input.name}: expected an object`);
    return Object.fromEntries((input.components ?? []).map((c) => {
      const part = (value as Record<string, ManifestArgument>)[c.name ?? ""];
      if (part === undefined) throw new Error(`${input.name}.${c.name}: missing`);
      return [c.name, resolve(c, part, refs)];
    }));
  }
  if (typeof value === "string" && value.startsWith("$")) {
    const ref = refs.get(value.slice(1));
    if (ref === undefined) throw new Error(`${input.name}: ${value} names neither $companiesHouse nor an earlier entry`);
    return ref;
  }
  if (/^u?int/.test(input.type)) return BigInt(value as string | number);
  if (input.type === "address" && !(typeof value === "string" && isAddress(value))) throw new Error(`${input.name}: not an address`);
  return value;
}

/** Every entry's init code and address from `house`, in manifest order. `artifacts` is keyed `<File>.sol/<Name>`. */
export function planEntries(house: Hex, manifest: Manifest, artifacts: Readonly<Record<string, unknown>>): readonly PlannedEntry[] {
  const refs = new Map<string, Hex>([["companiesHouse", house]]);
  return manifest.contracts.map((entry) => {
    const file = entry.source.split("/").pop() as string;
    const artifact = readArtifact(artifacts[`${file}/${entry.name}`], entry.name);
    const constructor = artifact.abi.find((item): item is { type: "constructor"; inputs: Input[] } => isRecord(item) && item.type === "constructor");
    const inputs = constructor?.inputs ?? [];
    const extra = Object.keys(entry.constructorArguments).filter((key) => !inputs.some((input) => input.name === key));
    if (extra.length > 0) throw new Error(`${entry.name}'s constructor has no ${extra.join(", ")}`);
    const values = inputs.map((input) => {
      const given = entry.constructorArguments[input.name ?? ""];
      if (given === undefined) throw new Error(`${entry.name} needs constructor argument ${input.name}`);
      return resolve(input, given, refs);
    });
    const initCode = concat([artifact.creation, encodeAbiParameters(inputs, values)]);
    const address = getContractAddress({ opcode: "CREATE2", from: house, salt: entry.salt, bytecode: initCode });
    refs.set(entry.name, address);
    const resolvedArguments = Object.fromEntries(inputs.map((input, index) => [input.name, values[index]]));
    return { entry, address, initCode, artifact, resolvedArguments };
  });
}

/** Whether the chain's runtime code is the compiled one, once each immutable is zeroed. */
export function sameRuntime(planned: PlannedEntry, onChain: Hex): boolean {
  const bytes = toBytes(onChain);
  for (const { start, length } of planned.artifact.immutables) bytes.fill(0, start, start + length);
  return keccak256(bytes) === keccak256(planned.artifact.runtime);
}
