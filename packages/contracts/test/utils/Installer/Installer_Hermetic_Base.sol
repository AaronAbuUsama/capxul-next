// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Base_Test } from "../../Base.t.sol";

import { Installer, InstallerConfig } from "../../../src/authority/Installer.sol";
import { IInstaller } from "../../../src/interfaces/IInstaller.sol";
import { IHatsSignerGate } from "../../../src/interfaces/external/IHatsSignerGate.sol";

import { GateStub, HatsStub, RolesStub, SafeStub } from "./HermeticStubs.sol";

/// @notice The Installer with read-only stand-ins for Safe, Roles, Hats and the Gate, for fuzzing input ranges
/// (gate 5 is hermetic). A company: `companySafe` (a SafeStub with the 4337 module and handler) owned by the
/// founder's Safe, the co-Directors' Safes and one stray owner; its Roles and Gate name it; every founding
/// Director wears the Director hat.
abstract contract Installer_Hermetic_Base is Base_Test {
    address internal constant SENTINEL = address(0x1);
    address internal constant SAFE_4337_MODULE = 0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226;
    address internal constant FALLBACK_HANDLER = 0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4;
    bytes32 internal constant PAYOUT_ROLE_KEY = keccak256("v4-payout");
    uint256 internal constant BOARD_TOP_HAT = uint256(2) << 224;
    uint256 internal constant SHAREHOLDERS_TOP_HAT = uint256(3) << 224;
    uint256 internal constant DIRECTOR = SHAREHOLDERS_TOP_HAT | (uint256(1) << 208);
    uint8 internal constant MAX_CO_DIRECTORS = 6;

    Installer internal installer;
    HatsStub internal hatsStub;
    SafeStub internal companySafe;
    SafeStub internal founderSafe;
    RolesStub internal rolesStub;
    GateStub internal gateStub;
    address internal budgetsStandIn;
    address internal paymentsStandIn;

    function _deployProtocol() internal virtual override {
        hatsStub = new HatsStub();
        budgetsStandIn = makeAddr("Budgets");
        paymentsStandIn = makeAddr("Payments");
        installer = new Installer(
            InstallerConfig({
                payments: paymentsStandIn,
                budgets: budgetsStandIn,
                agreements: makeAddr("Agreements"),
                vesting: makeAddr("Vesting"),
                hats: address(hatsStub),
                moduleProxyFactory: makeAddr("ModuleProxyFactory"),
                rolesMastercopy: makeAddr("Roles mastercopy"),
                gateImplementation: makeAddr("Gate implementation"),
                hatsModuleFactory: makeAddr("HatsModuleFactory"),
                electionsImplementation: makeAddr("Elections implementation"),
                fallbackHandler: FALLBACK_HANDLER,
                safe4337Module: SAFE_4337_MODULE,
                captableImplementation: makeAddr("Captable implementation"),
                shareClassImplementation: makeAddr("ShareClass implementation"),
                governorImplementation: makeAddr("Governor implementation"),
                optionsImplementation: makeAddr("Options implementation"),
                roundsImplementation: makeAddr("Rounds implementation"),
                exitsImplementation: makeAddr("Exits implementation"),
                escrowFactory: makeAddr("EscrowFactory"),
                multisendUnwrapper: makeAddr("MultiSend unwrapper")
            })
        );

        companySafe = new SafeStub();
        founderSafe = new SafeStub();
        address[] memory modules = new address[](1);
        modules[0] = SAFE_4337_MODULE;
        companySafe.setModules(modules);
        companySafe.setFallbackHandler(SAFE_4337_MODULE);
        rolesStub = new RolesStub(address(companySafe), address(companySafe), address(companySafe));
        gateStub = new GateStub(address(companySafe), SHAREHOLDERS_TOP_HAT, DIRECTOR);
        hatsStub.setHat(DIRECTOR, 1 + MAX_CO_DIRECTORS, 1, address(founderSafe), address(founderSafe), true);
        hatsStub.setHat(BOARD_TOP_HAT, 1, 1, address(0), address(0), false);
        hatsStub.setHat(SHAREHOLDERS_TOP_HAT, 1, 1, address(0), address(0), false);
        hatsStub.setWearer(BOARD_TOP_HAT, address(companySafe), true);
        hatsStub.setWearer(SHAREHOLDERS_TOP_HAT, address(founderSafe), true);
        hatsStub.setWearer(DIRECTOR, address(founderSafe), true);
        hatsStub.setAdmin(DIRECTOR, address(founderSafe), true);
    }

    function _refused(IInstaller.InstallRefusal reason) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(IInstaller.InvalidInstall.selector, reason);
    }

    /// @dev `n` co-Directors' Safes (each a Safe with code wearing the Director hat), and the company Safe's owners
    /// set to the founding Directors plus `strays` stray owners.
    function _coDirectors(uint256 n, uint256 strays) internal returns (address[] memory co) {
        co = new address[](n);
        address[] memory owners = new address[](1 + n + strays);
        owners[0] = address(founderSafe);
        for (uint256 i; i < n; ++i) {
            co[i] = address(new SafeStub());
            hatsStub.setWearer(DIRECTOR, co[i], true);
            owners[1 + i] = co[i];
        }
        for (uint256 i; i < strays; ++i) {
            owners[1 + n + i] = makeAddr(string.concat("stray ", vm.toString(i)));
        }
        companySafe.setOwners(owners, 1);
    }

    function _deployment() internal pure returns (IInstaller.MoneyDeployment memory d) {
        d.boardTopHat = BOARD_TOP_HAT;
        d.shareholdersTopHat = SHAREHOLDERS_TOP_HAT;
        d.directorHat = DIRECTOR;
        d.officerHats = new uint256[](0);
    }

    function _moneyDeploy(address[] memory co, uint120 min) internal view returns (IInstaller.MoneyDeploy memory p) {
        p.safe = address(companySafe);
        p.founderSafe = address(founderSafe);
        p.coDirectors = co;
        p.threshold = IHatsSignerGate.ThresholdConfig({
            thresholdType: IHatsSignerGate.TargetThresholdType.ABSOLUTE, min: min, target: min
        });
        p.officers = new IInstaller.Officer[](0);
        p.salt = bytes32(uint256(1));
    }

    function _moneyInstall(
        address[] memory co,
        IInstaller.Token[] memory tokens
    )
        internal
        view
        returns (IInstaller.MoneyInstall memory p)
    {
        IInstaller.MoneyDeployment memory d = _deployment();
        d.roles = address(rolesStub);
        d.gate = address(gateStub);
        p = IInstaller.MoneyInstall({
            safe: address(companySafe),
            founderSafe: address(founderSafe),
            coDirectors: co,
            deployment: d,
            tokens: tokens
        });
    }

    /// @dev `n` distinct tokens (addresses with code), each with a nonzero top hat.
    function _tokens(uint256 n, uint128 ceiling, uint8 periodSeed) internal returns (IInstaller.Token[] memory t) {
        t = new IInstaller.Token[](n);
        for (uint256 i; i < n; ++i) {
            t[i] = IInstaller.Token({
                token: address(new SafeStub()),
                ceiling: ceiling,
                budgetPeriod: uint8((uint256(periodSeed) + i) % 3),
                topAmount: ceiling,
                topHat: BOARD_TOP_HAT
            });
        }
    }

    function _periodSeconds(uint8 budgetPeriod) internal pure returns (uint64) {
        return budgetPeriod == 0 ? 31 days : budgetPeriod == 1 ? 92 days : 366 days;
    }

    function _countSelector(
        IInstaller.Call[] memory calls,
        address to,
        bytes4 selector
    )
        internal
        pure
        returns (uint256 n)
    {
        for (uint256 i; i < calls.length; ++i) {
            if (calls[i].to == to && calls[i].data.length >= 4 && bytes4(calls[i].data) == selector) ++n;
        }
    }

    function _has(IInstaller.Call[] memory calls, address to, bytes memory data) internal pure returns (bool) {
        for (uint256 i; i < calls.length; ++i) {
            if (calls[i].to == to && keccak256(calls[i].data) == keccak256(data)) return true;
        }
        return false;
    }
}
