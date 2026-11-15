// The ABIs the index reads, each the compiled contracts' own (packages/contracts/generated/abi.ts, which
// `pnpm generate` writes from `forge build`), never typed here. Imported by path, not by package name: the index's
// image (packages/world/ponder/Dockerfile) copies that file beside this one's folder, as the repository holds them.
import {
  CompaniesHouseClaimer,
  CompanySafeMinter,
  IEntryPoint,
  IERC20Metadata,
  IHatsEvents,
  Installer,
  Payments,
} from "../contracts/generated/abi.ts";

export const PAYMENT = Payments;
export const TOKEN = IERC20Metadata;
export const COMPANY = [...CompanySafeMinter, ...CompaniesHouseClaimer] as const;
export const HATS = IHatsEvents;
export const INSTALLER = Installer;
export const ENTRY_POINT = IEntryPoint;
