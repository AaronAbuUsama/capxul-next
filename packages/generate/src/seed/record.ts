// The deployment record (`deployments/devnet.json`) and the state's checksums (`state/CHECKSUMS`), from what the
// seed planned and what the chain holds after it. Pure.
import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import type { Hex } from "viem";
import type { HouseConfig, Planned } from "./plan.ts";
import { THIRD_PARTY } from "./third-party.ts";

/** What the seed deployed and where, in the shape every reader of `deployments/devnet.json` decodes. */
export interface DeploymentRecord {
  readonly version: "v4";
  readonly chainId: number;
  readonly companiesHouse: Hex;
  readonly companiesHouseRoles: Hex;
  readonly createCall: Hex;
  readonly tiers: HouseConfig["tiers"];
  readonly contracts: {
    readonly [name: string]: {
      readonly address: Hex;
      readonly salt: Hex;
      readonly constructorArguments: { readonly [name: string]: unknown };
      readonly runtimeCodeHash: Hex;
    };
  };
}

/** The record, with each entry's runtime code hash as `codeHash` reads it from the chain, in manifest order. */
export const deploymentRecord = (input: {
  readonly chainId: number;
  readonly house: Hex;
  readonly roles: Hex;
  readonly config: HouseConfig;
  readonly planned: ReadonlyArray<Planned>;
  readonly codeHash: (address: Hex) => Hex;
}): DeploymentRecord => ({
  version: "v4",
  chainId: input.chainId,
  companiesHouse: input.house,
  companiesHouseRoles: input.roles,
  createCall: THIRD_PARTY.createCall,
  tiers: input.config.tiers,
  contracts: Rec.fromEntries(
    Arr.map(
      input.planned,
      (entry) =>
        [
          entry.name,
          {
            address: entry.address,
            salt: entry.salt,
            constructorArguments: entry.arguments,
            runtimeCodeHash: input.codeHash(entry.address),
          },
        ] as const,
    ),
  ),
});

/** `state/CHECKSUMS`: each file's SHA-256 as `shasum -a 256` prints it. */
export const checksums = (files: ReadonlyArray<{ readonly name: string; readonly sha256: string }>): string =>
  Arr.join(
    Arr.map(files, (file) => `${file.sha256}  ${file.name}\n`),
    "",
  );
