// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { EquityConfig, EquityInstaller } from "./EquityInstaller.sol";
import { InstallerBase, InstallerConfig } from "./InstallerBase.sol";
import { InstallerElections } from "./InstallerElections.sol";
import { InstallerMoney } from "./InstallerMoney.sol";
import { IInstaller } from "../interfaces/IInstaller.sol";

/// @title Installer
/// @notice Installs Capxul's protocol onto an existing company Safe (spec/installer.md, spec/board.md). Never
/// delegatecalled, never a Safe module or Roles member, and it holds no token and wears no hat after any call
/// returns (I2). Each install has a permissionless `deploy*` and a view `build*` that returns the Safe's batch.
/// @dev The equity half lives in an `EquityInstaller` this contract creates in its constructor (the whole would be
/// over the 24,576-byte limit). `deployEquity` and `buildEquity` forward their calldata to it unchanged and return
/// its answer, so the ABI is `IInstaller`'s; `EquityDeployed` is emitted here, so every event comes from one address.
contract Installer is InstallerMoney, InstallerElections {
    /// @dev The equity half.
    address private immutable _equity;

    /// @param config The shared contracts, implementations and third-party addresses.
    constructor(InstallerConfig memory config) InstallerBase(config) {
        _equity = address(
            new EquityInstaller(
                EquityConfig({
                    payments: config.payments,
                    vesting: config.vesting,
                    hats: config.hats,
                    hatsModuleFactory: config.hatsModuleFactory,
                    electionsImplementation: config.electionsImplementation,
                    captableImplementation: config.captableImplementation,
                    shareClassImplementation: config.shareClassImplementation,
                    governorImplementation: config.governorImplementation,
                    optionsImplementation: config.optionsImplementation,
                    roundsImplementation: config.roundsImplementation,
                    exitsImplementation: config.exitsImplementation,
                    escrowFactory: config.escrowFactory
                })
            )
        );
    }

    /// @inheritdoc IInstaller
    function deployEquity(EquityDeploy calldata p) external returns (EquityDeployment memory e) {
        (bool ok, bytes memory ret) = _equity.call(msg.data);
        if (!ok) _bubble(ret);
        e = abi.decode(ret, (EquityDeployment));
        // forge-lint: disable-next-line(reentrancy-events) -- the Installer holds no funds or authority (I2); the equity half is its own immutable contract
        emit EquityDeployed(p.safe, e);
    }

    /// @inheritdoc IInstaller
    function buildEquity(EquityInstall calldata) external view returns (Call[] memory, Call[] memory) {
        (bool ok, bytes memory ret) = _equity.staticcall(msg.data);
        if (!ok) _bubble(ret);
        // The answer is already ABI-encoded as this function's return: hand it back as it is.
        assembly ("memory-safe") {
            return(add(ret, 32), mload(ret))
        }
    }

    /// @dev Reverts with the equity half's own revert data (an `InvalidInstall`, or a clone's error).
    function _bubble(bytes memory reason) private pure {
        assembly ("memory-safe") {
            revert(add(reason, 32), mload(reason))
        }
    }
}
