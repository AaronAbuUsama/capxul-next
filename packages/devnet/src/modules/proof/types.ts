import type { Hex } from "viem";

import type { Chain } from "../chain/types.ts";
import type { DeploymentRecord } from "../protocol/types.ts";
import type { TestKey } from "../test-keys/types.ts";

/** One line of the proof: what was shown, whether it held, and the evidence. */
export interface StepResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface ProofInput {
  readonly chain: Chain;
  readonly record: DeploymentRecord;
  /** The contents of two Foundry artifacts: `MockERC20` (the token the company is paid in) and `Installer` (for its ABI). */
  readonly artifacts: { readonly token: unknown; readonly installer: unknown };
  readonly keys: {
    readonly deployer: TestKey;
    readonly tierService: TestKey;
    readonly founder: TestKey;
    readonly second: TestKey;
    readonly payee: TestKey;
    readonly stranger: TestKey;
    readonly agent: TestKey;
  };
  /** Called as each step finishes, so a long run shows its progress. */
  readonly report: (step: StepResult) => void;
}

/** What the proof learned, for the steps that follow and for the caller. */
export interface ProofState {
  companySafe: Hex;
  founderSafe: Hex;
  agentSafe: Hex;
  token: Hex;
  gate: Hex;
  roles: Hex;
  opsHat: bigint;
  boardTopHat: bigint;
  topBudget: bigint;
  department: bigint;
}
