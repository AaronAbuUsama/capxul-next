// Brought from `localPrivateKeySigner` in packages/sdk/src/node/index.ts of the old repository, unchanged but for
// its home: the rest of that file is the on-disk auth cache, which Core does not carry.

import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

import { toAddress } from "../../shared/protocol/evm/model.ts";
import type { CapxulSigner } from "./signer.ts";

/**
 * Node `CapxulSigner` backed by a raw private key. Signs the 32-byte digest it is given (a Safe transaction
 * hash, a SafeOp digest) with no EIP-191 prefix. The agent-native signer: no browser, no pop-up.
 */
export function localPrivateKeySigner(input: {
  readonly privateKey: Hex;
  readonly store?: "file" | "env";
}): CapxulSigner {
  const account = privateKeyToAccount(input.privateKey);
  return {
    source: "local-private-key",
    ...(input.store === undefined ? {} : { store: input.store }),
    async getAddress() {
      return toAddress(account.address);
    },
    async signUserOpHash(hash: Hex): Promise<Hex> {
      // `sign({ hash })` signs the already-computed digest directly.
      // `signMessage({ message: { raw: hash } })` would add an EIP-191 prefix.
      return account.sign({ hash });
    },
  };
}
