// What the protocol module takes and answers. Reading this file is reading the module.

import type { CapxulSigner } from "@capxul/sdk";
import type { Hex } from "viem";

import type { Chain } from "../chain/types.ts";

/** A literal, or a named tuple of them, in a manifest's constructor arguments. `$Name` is an earlier entry or `$companiesHouse`. */
export type ManifestArgument = string | number | boolean | { readonly [name: string]: ManifestArgument };

export interface ManifestEntry {
  readonly name: string;
  /** Under src/, for example `money/Payments.sol`. */
  readonly source: string;
  readonly salt: Hex;
  readonly constructorArguments: Readonly<Record<string, ManifestArgument>>;
}

/** `deploy/manifest.json`: the contracts Companies House deploys, in order. */
export interface Manifest {
  readonly version: "v4";
  readonly contracts: readonly ManifestEntry[];
}

/** `deploy/devnet.json`: who owns Companies House and which tier service may claim and mint through it. */
export interface CompaniesHouseConfig {
  readonly owners: readonly Hex[];
  readonly threshold: number;
  readonly tiers: readonly {
    readonly tier: string;
    readonly namespace: string;
    readonly companyNamespace: string;
    readonly member: Hex;
  }[];
}

/** What `forge build` wrote for one contract. */
export interface Artifact {
  readonly abi: readonly unknown[];
  readonly creation: Hex;
  readonly runtime: Hex;
  readonly immutables: readonly { readonly start: number; readonly length: number }[];
}

export interface PlannedEntry {
  readonly entry: ManifestEntry;
  readonly address: Hex;
  readonly initCode: Hex;
  readonly artifact: Artifact;
  readonly resolvedArguments: Readonly<Record<string, unknown>>;
}

/** The record written to the deployments file: the shape the old `protocol verify` wrote, plus Roles and the tiers. */
export interface DeploymentRecord {
  readonly version: "v4";
  readonly chainId: number;
  readonly companiesHouse: Hex;
  readonly companiesHouseRoles: Hex;
  readonly createCall: Hex;
  readonly tiers: CompaniesHouseConfig["tiers"];
  readonly contracts: Readonly<
    Record<
      string,
      {
        readonly address: Hex;
        readonly salt: Hex;
        readonly constructorArguments: Readonly<Record<string, unknown>>;
        readonly runtimeCodeHash: Hex;
      }
    >
  >;
}

export interface DeployInput {
  readonly chain: Chain;
  readonly manifest: Manifest;
  readonly config: CompaniesHouseConfig;
  /** What `forge build` wrote, by `<File>.sol/<Name>`: the contents of each artifact, read by the caller. */
  readonly artifacts: Readonly<Record<string, unknown>>;
  /** Pays gas. */
  readonly sender: Hex;
  /** At least `config.threshold` of Companies House's owners. */
  readonly owners: readonly CapxulSigner[];
}

export type Step = { readonly name: string; readonly status: "done" | "already" };

export interface DeployResult {
  readonly record: DeploymentRecord;
  readonly steps: readonly Step[];
}

export interface ThirdParty {
  readonly createCall: Hex;
  readonly multiSend: Hex;
  readonly multiSendCallOnly: Hex;
  readonly safeProxyFactory: Hex;
  readonly safeSingleton: Hex;
  readonly fallbackHandler: Hex;
  readonly safe4337Module: Hex;
  readonly safeModuleSetup: Hex;
  readonly moduleProxyFactory: Hex;
  readonly rolesMastercopy: Hex;
  readonly hats: Hex;
}
