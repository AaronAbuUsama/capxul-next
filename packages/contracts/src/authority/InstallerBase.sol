// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICalendar } from "../interfaces/ICalendar.sol";
import { IInstaller } from "../interfaces/IInstaller.sol";
import { IHats } from "../interfaces/external/IHats.sol";
import { IHatsModuleFactory } from "../interfaces/external/IHatsModuleFactory.sol";
import { IModuleProxyFactory } from "../interfaces/external/IModuleProxyFactory.sol";
import { IRoles } from "../interfaces/external/IRoles.sol";
import { IHatsSignerGate } from "../interfaces/external/IHatsSignerGate.sol";
import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import { PayoutScope } from "../libraries/PayoutScope.sol";

/// @notice The shared contracts, implementations and third-party addresses an Installer is built with. Each
/// becomes an immutable of the same name (spec/installer.md, "Shape").
/// @dev Declared here because the frozen `IInstaller` has no constructor vocabulary; one struct keeps the
/// constructor clear of "stack too deep".
struct InstallerConfig {
    address payments;
    address budgets;
    address agreements;
    address vesting;
    address hats;
    address moduleProxyFactory;
    address rolesMastercopy;
    address gateImplementation;
    address hatsModuleFactory;
    address electionsImplementation;
    address fallbackHandler;
    address safe4337Module;
    address captableImplementation;
    address shareClassImplementation;
    address governorImplementation;
    address optionsImplementation;
    address roundsImplementation;
    address exitsImplementation;
    address escrowFactory;
    address multisendUnwrapper;
}

/// @title InstallerBase
/// @notice The Installer's immutables and their getters (`IInstaller`'s address getters).
abstract contract InstallerBase is IInstaller {
    // forge-lint: disable-start(calls-loop, require-revert-in-loop, reentrancy-events, unused-return, uninitialized-local, block-timestamp, divide-before-multiply, unsafe-typecast)
    // The Installer is a one-shot deploy and view helper: it holds no funds and no authority (I2), so its loops of
    // calls, its events after calls, and its refusals inside input loops cannot be reentered for gain. Loop counters
    // and flags start at zero and false. It compares times because a term or period is a time. Casts are of values
    // bounded by the caller's own list lengths or by Roles' own types.
    /// @inheritdoc IInstaller
    bytes32 public constant PAYOUT_ROLE_KEY = PayoutScope.ROLE_KEY;

    /// @dev The Safe module list's sentinel.
    address internal constant SENTINEL = address(0x1);

    /// @notice The shared Payments contract.
    address public immutable override payments;
    /// @notice The shared Budgets contract, the payout role's only member.
    address public immutable override budgets;
    /// @notice The shared Agreements contract.
    address public immutable override agreements;
    /// @notice The shared Vesting contract.
    address public immutable override vesting;
    /// @notice Hats Protocol v1.
    address public immutable override hats;
    /// @notice The Zodiac ModuleProxyFactory that deploys Roles and the Gate.
    address public immutable override moduleProxyFactory;
    /// @notice The Zodiac Roles v2.1 mastercopy.
    address public immutable override rolesMastercopy;
    /// @notice The Hats Signer Gate v2 implementation.
    address public immutable override gateImplementation;
    /// @notice HatsModuleFactory v0.7.0.
    address public immutable override hatsModuleFactory;
    /// @notice The Hats Election Eligibility v0.2.0 implementation.
    address public immutable override electionsImplementation;
    /// @notice CompatibilityFallbackHandler 1.5.0, set when the Safe's handler is the 4337 module.
    address public immutable override fallbackHandler;
    /// @notice The Safe 4337 module 0.3.0, recognised as a Capxul Safe's handler.
    address public immutable override safe4337Module;
    /// @notice The Captable implementation the company clone is made from.
    address public immutable override captableImplementation;
    /// @notice The ShareClass implementation, passed to `Captable.initialize`.
    address public immutable override shareClassImplementation;
    /// @notice The Governor implementation.
    address public immutable override governorImplementation;
    /// @notice The Options implementation.
    address public immutable override optionsImplementation;
    /// @notice The Rounds implementation.
    address public immutable override roundsImplementation;
    /// @notice The Exits implementation.
    address public immutable override exitsImplementation;
    /// @notice The shared EscrowFactory, passed to `Exits.initialize`.
    address public immutable override escrowFactory;

    /// @notice Roles adapter for Safe MultiSendCallOnly.
    address public immutable multisendUnwrapper;

    /// @param config The shared contracts, implementations and third-party addresses.
    constructor(InstallerConfig memory config) {
        multisendUnwrapper = config.multisendUnwrapper;
        payments = config.payments;
        budgets = config.budgets;
        agreements = config.agreements;
        vesting = config.vesting;
        hats = config.hats;
        moduleProxyFactory = config.moduleProxyFactory;
        rolesMastercopy = config.rolesMastercopy;
        gateImplementation = config.gateImplementation;
        hatsModuleFactory = config.hatsModuleFactory;
        electionsImplementation = config.electionsImplementation;
        fallbackHandler = config.fallbackHandler;
        safe4337Module = config.safe4337Module;
        captableImplementation = config.captableImplementation;
        shareClassImplementation = config.shareClassImplementation;
        governorImplementation = config.governorImplementation;
        optionsImplementation = config.optionsImplementation;
        roundsImplementation = config.roundsImplementation;
        exitsImplementation = config.exitsImplementation;
        escrowFactory = config.escrowFactory;
    }

    /// @inheritdoc IInstaller
    function payoutAllowanceKey(address token) external pure returns (bytes32) {
        return PayoutScope.allowanceKey(token);
    }

    // ------------------------------------------------------------------ shared checks

    function _requireContract(address account, InstallRefusal reason) internal view {
        if (account == address(0) || account.code.length == 0) revert InvalidInstall(reason);
    }

    function _call(address to, bytes memory data) internal pure returns (Call memory) {
        return Call({ to: to, value: 0, data: data });
    }

    /// @dev The Safe's Roles is owned by it and avatar to it.
    function _checkRoles(address safe, address roles) internal view {
        if (roles.code.length == 0 || IRoles(roles).owner() != safe || IRoles(roles).avatar() != safe) {
            revert InvalidInstall(InstallRefusal.RolesNotForSafe);
        }
    }

    function _checkDeployment(address safe, address roles, address gate) internal view {
        _checkRoles(safe, roles);
        if (gate.code.length == 0 || IHatsSignerGate(gate).safe() != safe) {
            revert InvalidInstall(InstallRefusal.GateNotForSafe);
        }
    }

    /// @dev The founder's Safe and every co-Director's Safe wear the Director hat.
    function _checkDirectors(uint256 directorHat, address founderSafe, address[] calldata coDirectors) internal view {
        IHats h = IHats(hats);
        bool ok = h.isWearerOfHat(founderSafe, directorHat);
        for (uint256 i; ok && i < coDirectors.length; ++i) {
            ok = h.isWearerOfHat(coDirectors[i], directorHat);
        }
        if (!ok) revert InvalidInstall(InstallRefusal.FounderNotDirector);
    }

    /// @dev The founder's Safe and each co-Director's Safe are contracts, none is the company Safe (which is never a
    /// wearer, eligibility or toggle of the Director hat, HSG `README.md:34`), and no co-Director is the founder's or
    /// repeated.
    function _checkFounders(address safe, address founderSafe, address[] calldata coDirectors) internal view {
        _requireContract(founderSafe, InstallRefusal.FounderSafeInvalid);
        if (founderSafe == safe) revert InvalidInstall(InstallRefusal.FounderSafeInvalid);
        for (uint256 i; i < coDirectors.length; ++i) {
            address co = coDirectors[i];
            bool bad = co == address(0) || co.code.length == 0 || co == founderSafe || co == safe;
            for (uint256 j; !bad && j < i; ++j) {
                bad = coDirectors[j] == co;
            }
            if (bad) revert InvalidInstall(InstallRefusal.CoDirectorInvalid);
        }
    }

    /// @dev At least one token, each once, each with a top hat and a known budget period (J11).
    function _checkTokens(Token[] memory tokens) internal pure {
        if (tokens.length == 0) revert InvalidInstall(InstallRefusal.NoToken);
        for (uint256 i; i < tokens.length; ++i) {
            if (tokens[i].topHat == 0) revert InvalidInstall(InstallRefusal.ZeroTopHat);
            if (tokens[i].budgetPeriod > ICalendar.BUDGET_YEAR) {
                revert InvalidInstall(InstallRefusal.BudgetPeriodInvalid);
            }
            for (uint256 j; j < i; ++j) {
                if (tokens[j].token == tokens[i].token) revert InvalidInstall(InstallRefusal.DuplicateToken);
            }
        }
    }

    /// @dev The Elections clone `HatsModuleFactory` makes for a Director hat: the Shareholders' top hat as ballot
    /// box, ADMIN_HAT 0 (so the Director hat's admins set terms) and salt nonce 0.
    function _predictElections(uint256 directorHat, uint256 shareholdersTopHat) internal view returns (address) {
        return IHatsModuleFactory(hatsModuleFactory)
            .getHatsModuleAddress(
                electionsImplementation, directorHat, abi.encodePacked(shareholdersTopHat, uint256(0)), 0
            );
    }

    // ------------------------------------------------------------------ module proxies

    /// @dev Deploys a Zodiac module proxy, or accepts the one already at the address: the factory's salt includes
    /// the initializer, so a front-runner can only have deployed this exact configuration.
    function _module(address masterCopy, bytes memory initializer, uint256 salt) internal returns (address proxy) {
        proxy = Create2.computeAddress(
            keccak256(abi.encodePacked(keccak256(initializer), salt)),
            keccak256(
                abi.encodePacked(
                    hex"602d8060093d393df3363d3d373d3d3d363d73", masterCopy, hex"5af43d82803e903d91602b57fd5bf3"
                )
            ),
            moduleProxyFactory
        );
        if (proxy.code.length == 0) {
            proxy = IModuleProxyFactory(moduleProxyFactory).deployModule(masterCopy, initializer, salt);
        }
    }
    // forge-lint: disable-end
}
