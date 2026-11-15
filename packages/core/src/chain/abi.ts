// The contract functions Core's chain operations call and the logs they read, by the names Core uses for them. Each is
// the compiled ABI (`@capxul/contracts`, generated from `forge build` by `pnpm generate`), never typed here. viem is used
// as a pure codec (decisions.md, 34): it encodes and decodes, and every byte reaches the chain through `WorldChain`.
import { Abi } from "@capxul/contracts";

export const ROLES = Abi.IRoles;
export const MINTER = Abi.CompanySafeMinter;
export const ERC20 = Abi.IERC20Metadata;
/** A Safe: what `ISafe` declares and the reads of its state. */
export const SAFE = [...Abi.ISafe, ...Abi.ISafeState] as const;
export const SAFE_MODULE_SETUP = Abi.ISafeModuleSetup;
export const SAFE_PROXY_FACTORY = Abi.ISafeProxyFactory;
export const MULTI_SEND = Abi.IMultiSend;
export const INSTALLER = Abi.Installer;
/** The Hats protocol: the functions Capxul calls, its events and its id helper. */
export const HATS = [...Abi.IHats, ...Abi.IHatsEvents] as const;
/** The company's Signer Gate (Hats Signer Gate v2): what the wearer of its owner hat, the Shareholders' top hat, calls. */
export const GATE = Abi.IHatsSignerGate;
export const SAFE_4337_MODULE = Abi.ISafe4337Module;
export const ENTRY_POINT = Abi.IEntryPoint;
export const BUDGETS = Abi.Budgets;
