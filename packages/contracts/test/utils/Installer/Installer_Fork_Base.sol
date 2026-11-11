// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Addresses } from "../../fork/Addresses.sol";
import { Fork_Test } from "../../fork/Fork_Test.t.sol";
import {
    IHatsSignerGate as ForkGate,
    IRoles as ForkRoles,
    ISafe as ForkSafe,
    ISafeProxyFactory
} from "../../fork/Interfaces.sol";

import { Installer, InstallerConfig } from "../../../src/authority/Installer.sol";
import { ICaptable } from "../../../src/interfaces/ICaptable.sol";
import { IInstaller } from "../../../src/interfaces/IInstaller.sol";
import { IHats } from "../../../src/interfaces/external/IHats.sol";
import { IHatsSignerGate } from "../../../src/interfaces/external/IHatsSignerGate.sol";

import { MockCaptable, MockExits, MockGovernor, MockOptions, MockRounds, MockVesting } from "./EquityMocks.sol";
import { IGateLike, IHatsExtra, IRolesLike, ISafeLike } from "./ExternalViews.sol";
import { MockBudgets, MockPayments } from "./MoneyMocks.sol";

/// @dev Safe 4337 module 0.3.0's setup helper, as `CompaniesHouseClaimer` delegatecalls it.
interface ISafeModuleSetupLike {
    function enableModules(address[] calldata modules) external;
}

/// @notice The Installer's fork fixture (spec/installer.md, "Proof"): a company Safe 1.4.1 set up the way
/// Companies House sets up every Capxul Safe (the Safe 4337 module 0.3.0 as module and fallback handler,
/// `CompaniesHouseClaimer.sol:149-163`), owned by Amira's and Ben's personal Safes at threshold 2, with nothing
/// installed. A third owner, a stray key, is still on it. The real Safe, Roles 2.1, Hats, Hats Signer Gate v2, HatsModuleFactory and Hats Elections run at the
/// fork pin; Payments, Budgets and the equity implementations are stand-ins (test/utils/Installer).
abstract contract Installer_Fork_Base is Fork_Test {
    /// @dev Safe 4337 module 0.3.0 and its setup helper (`CompaniesHouseClaimer.sol:63-64`).
    address internal constant SAFE_4337_MODULE = 0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226;
    address internal constant SAFE_MODULE_SETUP = 0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47;
    /// @dev keccak256("fallback_manager.handler.address"), Safe 1.4.1's handler slot.
    bytes32 internal constant FALLBACK_HANDLER_SLOT =
        0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5;

    /// @dev spec/installer.md step 2.
    bytes32 internal constant PAYOUT_ROLE_KEY = keccak256("v4-payout");
    uint8 internal constant BUDGET_MONTH = 0;
    uint8 internal constant BUDGET_QUARTER = 1;
    uint8 internal constant BUDGET_YEAR = 2;
    uint128 internal constant CEILING = 50_000e6;

    bytes4 internal constant ROLES_CONDITION_VIOLATION = bytes4(keccak256("ConditionViolation(uint8,bytes32)"));
    bytes4 internal constant ROLES_NOT_AUTHORIZED = bytes4(keccak256("NotAuthorized(address)"));

    IHats internal constant HATS_V1 = IHats(Addresses.HATS);

    Installer internal installer;
    MockPayments internal paymentsMock;
    MockBudgets internal budgetsMock;
    MockVesting internal vestingMock;
    address internal agreementsStandIn;
    address internal escrowFactoryStandIn;
    address internal captableImpl;
    address internal shareClassImpl;
    address internal governorImpl;
    address internal optionsImpl;
    address internal roundsImpl;
    address internal exitsImpl;

    uint256 internal benKey;
    ForkSafe internal benSafe;
    ForkSafe internal jordanSafe;
    /// @dev A key that owned the company Safe before the install (a bootstrap signer): the install removes it.
    address internal strayOwner;

    /// @dev The last money deployment `_deployMoney` made.
    uint256 internal boardTopHat;
    uint256 internal shareholdersTopHat;
    uint256[] internal officerHats;

    // ------------------------------------------------------------------ fixture

    /// @dev Replaces Fork_Test's installed company with an uninstalled Capxul company Safe.
    function _deployCompany() internal virtual override {
        amiraKey = uint256(keccak256(abi.encodePacked("amira")));
        benKey = uint256(keccak256(abi.encodePacked("ben")));
        founderSafe = _newSafe(users.amira, 1);
        benSafe = _newSafe(users.ben, 1);
        vm.label(address(founderSafe), "Amira's Safe");
        vm.label(address(benSafe), "Ben's Safe");

        jordanSafe = _newSafe(users.jordan, 1);
        vm.label(address(jordanSafe), "Jordan's Safe");
        strayOwner = makeAddr("stray owner");

        address[] memory owners = new address[](3);
        owners[0] = address(founderSafe);
        owners[1] = address(benSafe);
        owners[2] = strayOwner;
        companySafe = _newCapxulSafe(owners, 2, 7);
        vm.label(address(companySafe), "Company Safe");
        usdc.mint(address(companySafe), 1_000_000 * USDC_UNIT);
        dai.mint(address(companySafe), 1_000_000 ether);
    }

    function _deployProtocol() internal virtual override {
        paymentsMock = new MockPayments();
        budgetsMock = new MockBudgets(HATS_V1, address(paymentsMock));
        vestingMock = new MockVesting();
        agreementsStandIn = makeAddr("Agreements");
        escrowFactoryStandIn = makeAddr("EscrowFactory");
        captableImpl = address(new MockCaptable());
        shareClassImpl = makeAddr("ShareClass implementation");
        governorImpl = address(new MockGovernor());
        optionsImpl = address(new MockOptions());
        roundsImpl = address(new MockRounds());
        exitsImpl = address(new MockExits());
        installer = new Installer(_config());
        vm.label(address(installer), "Installer");
        vm.label(address(budgetsMock), "Budgets");
        vm.label(address(paymentsMock), "Payments");
    }

    function _config() internal view returns (InstallerConfig memory) {
        return InstallerConfig({
            payments: address(paymentsMock),
            budgets: address(budgetsMock),
            agreements: agreementsStandIn,
            vesting: address(vestingMock),
            hats: Addresses.HATS,
            moduleProxyFactory: Addresses.MODULE_PROXY_FACTORY,
            rolesMastercopy: Addresses.ROLES_V2_MASTERCOPY,
            gateImplementation: Addresses.HATS_SIGNER_GATE_V2,
            hatsModuleFactory: Addresses.HATS_MODULE_FACTORY,
            electionsImplementation: Addresses.HATS_ELECTION_ELIGIBILITY,
            fallbackHandler: Addresses.COMPATIBILITY_FALLBACK_HANDLER_150,
            safe4337Module: SAFE_4337_MODULE,
            captableImplementation: captableImpl,
            shareClassImplementation: shareClassImpl,
            governorImplementation: governorImpl,
            optionsImplementation: optionsImpl,
            roundsImplementation: roundsImpl,
            exitsImplementation: exitsImpl,
            escrowFactory: escrowFactoryStandIn,
            multisendUnwrapper: Addresses.ROLES_MULTISEND_UNWRAPPER
        });
    }

    /// @dev A Safe 1.4.1 as Companies House sets up a Capxul Safe: the 4337 module enabled through MultiSend and
    /// SafeModuleSetup, and the 4337 module as fallback handler (`CompaniesHouseClaimer.sol:149-163`).
    function _newCapxulSafe(address[] memory owners, uint256 threshold, uint256 nonce) internal returns (ForkSafe) {
        address[] memory modules = new address[](1);
        modules[0] = SAFE_4337_MODULE;
        bytes memory enable = abi.encodeCall(ISafeModuleSetupLike.enableModules, (modules));
        bytes memory payload = abi.encodePacked(DELEGATECALL, SAFE_MODULE_SETUP, uint256(0), enable.length, enable);
        bytes memory init = abi.encodeCall(
            ForkSafe.setup,
            (
                owners,
                threshold,
                Addresses.MULTI_SEND_141,
                abi.encodeWithSignature("multiSend(bytes)", payload),
                SAFE_4337_MODULE,
                address(0),
                0,
                payable(address(0))
            )
        );
        return ForkSafe(
            ISafeProxyFactory(Addresses.SAFE_PROXY_FACTORY_150).createProxyWithNonce(Addresses.SAFE_L2_150, init, nonce)
        );
    }

    // ------------------------------------------------------------------ inputs

    function _threshold(uint120 min, uint120 target) internal pure returns (IHatsSignerGate.ThresholdConfig memory) {
        return IHatsSignerGate.ThresholdConfig({
            thresholdType: IHatsSignerGate.TargetThresholdType.ABSOLUTE, min: min, target: target
        });
    }

    /// @dev Amira founds the company with Ben as co-Director, 2-of-2 (F3), a CEO hat and an Operations hat.
    function _moneyDeploy() internal view returns (IInstaller.MoneyDeploy memory p) {
        p.safe = address(companySafe);
        p.founderSafe = address(founderSafe);
        p.coDirectors = new address[](1);
        p.coDirectors[0] = address(benSafe);
        p.threshold = _threshold(2, 2);
        p.officers = new IInstaller.Officer[](2);
        p.officers[0] = IInstaller.Officer({ details: "CEO", maxSupply: 1 });
        p.officers[1] = IInstaller.Officer({ details: "Operations", maxSupply: 3 });
        p.salt = bytes32(uint256(1));
    }

    function _token(
        address token,
        uint128 ceiling,
        uint8 period,
        uint256 hat
    )
        internal
        pure
        returns (IInstaller.Token memory)
    {
        return
            IInstaller.Token({ token: token, ceiling: ceiling, budgetPeriod: period, topAmount: ceiling, topHat: hat });
    }

    /// @dev One USDC top budget under the Board's top hat, its ceiling equal to its amount (the beta rule).
    function _moneyInstall(IInstaller.MoneyDeployment memory d)
        internal
        view
        returns (IInstaller.MoneyInstall memory p)
    {
        p.safe = address(companySafe);
        p.founderSafe = address(founderSafe);
        p.coDirectors = new address[](1);
        p.coDirectors[0] = address(benSafe);
        p.deployment = d;
        p.tokens = new IInstaller.Token[](1);
        p.tokens[0] = _token(address(usdc), CEILING, BUDGET_MONTH, d.boardTopHat);
    }

    // ------------------------------------------------------------------ steps

    /// @dev `deployMoney` sent by Eve: anyone may call it.
    function _deployMoney(IInstaller.MoneyDeploy memory p) internal returns (IInstaller.MoneyDeployment memory d) {
        vm.prank(users.eve);
        d = installer.deployMoney(p);
        _remember(d);
    }

    function _deployMoney() internal returns (IInstaller.MoneyDeployment memory) {
        return _deployMoney(_moneyDeploy());
    }

    function _remember(IInstaller.MoneyDeployment memory d) internal {
        boardTopHat = d.boardTopHat;
        shareholdersTopHat = d.shareholdersTopHat;
        topHat = d.shareholdersTopHat;
        directorHat = d.directorHat;
        officerHats = d.officerHats;
        gate = ForkGate(d.gate);
        companyRoles = ForkRoles(d.roles);
    }

    /// @dev The whole money install: deploy, then the batch both founders sign.
    function _installMoney() internal returns (IInstaller.MoneyDeployment memory d, IInstaller.Call[] memory calls) {
        d = _deployMoney();
        calls = installer.buildMoney(_moneyInstall(d));
        _ownersBatch(calls);
    }

    /// @dev The company Safe runs `calls` as one MultiSendCallOnly delegatecall, approved by Amira's and Ben's Safes
    /// (`approveHash`, then v = 1 signatures in owner order).
    function _ownersBatch(IInstaller.Call[] memory calls) internal {
        bytes memory data = _multiSend(_toForkCalls(calls));
        _execApproved(address(companySafe), Addresses.MULTI_SEND_CALL_ONLY_141, data, DELEGATECALL);
    }

    /// @dev Both founders approve a company Safe transaction from their own Safes; then anyone executes it.
    function _execApproved(address safe, address to, bytes memory data, uint8 operation) internal {
        bytes memory sig = _approveBoth(safe, to, data, operation);
        assertTrue(
            ISafeLike(safe).execTransaction(to, 0, data, operation, 0, 0, 0, address(0), payable(address(0)), sig),
            "company Safe transaction"
        );
    }

    function _approveBoth(
        address safe,
        address to,
        bytes memory data,
        uint8 operation
    )
        internal
        returns (bytes memory sig)
    {
        bytes32 txHash = _txHash(safe, to, data, operation);
        _personalExec(founderSafe, amiraKey, safe, abi.encodeCall(ISafeLike.approveHash, (txHash)));
        _personalExec(benSafe, benKey, safe, abi.encodeCall(ISafeLike.approveHash, (txHash)));
        (address low, address high) = address(founderSafe) < address(benSafe)
            ? (address(founderSafe), address(benSafe))
            : (address(benSafe), address(founderSafe));
        sig = abi.encodePacked(_approved(low), _approved(high));
    }

    function _txHash(address safe, address to, bytes memory data, uint8 operation) internal view returns (bytes32) {
        uint256 nonce = ISafeLike(safe).nonce();
        return ISafeLike(safe).getTransactionHash(to, 0, data, operation, 0, 0, 0, address(0), address(0), nonce);
    }

    function _approved(address owner) internal pure returns (bytes memory) {
        return abi.encodePacked(bytes32(uint256(uint160(owner))), bytes32(0), uint8(1));
    }

    /// @dev A personal Safe (one owner, threshold 1) runs one call signed with its owner's key.
    function _personalExec(ForkSafe personal, uint256 key, address to, bytes memory data) internal {
        bytes memory signature = _sign(key, _txHash(address(personal), to, data, CALL));
        assertTrue(
            personal.execTransaction(to, 0, data, CALL, 0, 0, 0, address(0), payable(address(0)), signature),
            "personal Safe transaction"
        );
    }

    function _sign(uint256 key, bytes32 txHash) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, txHash);
        return abi.encodePacked(r, s, v);
    }

    function _toForkCalls(IInstaller.Call[] memory calls) internal pure returns (Call[] memory out) {
        out = new Call[](calls.length);
        for (uint256 i; i < calls.length; ++i) {
            out[i] = Call(calls[i].to, calls[i].value, calls[i].data);
        }
    }

    // ------------------------------------------------------------------ reading a batch

    /// @dev The index of the first call to `to` with exactly `data`, or type(uint256).max.
    function _find(IInstaller.Call[] memory calls, address to, bytes memory data) internal pure returns (uint256) {
        for (uint256 i; i < calls.length; ++i) {
            if (calls[i].to == to && keccak256(calls[i].data) == keccak256(data)) return i;
        }
        return type(uint256).max;
    }

    /// @dev The index of the first call to `to` whose selector is `selector`, or type(uint256).max.
    function _findSelector(IInstaller.Call[] memory calls, address to, bytes4 selector)
        internal
        pure
        returns (uint256)
    {
        for (uint256 i; i < calls.length; ++i) {
            if (calls[i].to == to && calls[i].data.length >= 4 && bytes4(calls[i].data) == selector) {
                return i;
            }
        }
        return type(uint256).max;
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

    function _assertHas(
        IInstaller.Call[] memory calls,
        address to,
        bytes memory data,
        string memory what
    )
        internal
        pure
    {
        assertTrue(_find(calls, to, data) != type(uint256).max, what);
    }

    // ------------------------------------------------------------------ reading state

    function _fallbackHandler(address safe) internal view returns (address) {
        return address(uint160(uint256(vm.load(safe, FALLBACK_HANDLER_SLOT))));
    }

    function _guard(address safe) internal view returns (address) {
        return address(uint160(uint256(vm.load(safe, GUARD_SLOT))));
    }

    function _modules(address safe) internal view returns (address[] memory modules) {
        (modules,) = ISafeLike(safe).getModulesPaginated(SENTINEL, 20);
    }

    /// @dev HSG v2's required signatures for `owners` (`HatsSignerGate.sol` `_getRequiredValidSignatures`, ABSOLUTE).
    function _required(IHatsSignerGate.ThresholdConfig memory c, uint256 owners) internal pure returns (uint256) {
        if (owners < c.min) return c.min;
        if (owners > c.target) return c.target;
        return owners;
    }

    function _hatAdmin(uint256 hat) internal pure returns (uint256) {
        // A hat's admin is the hat with its own level's 16 bits cleared (Hats' layout: 32-bit top, 16-bit levels).
        for (uint256 level = 14; level > 0; --level) {
            uint256 shift = 224 - level * 16;
            if ((hat >> shift) & 0xffff != 0) return hat & ~(uint256(0xffff) << shift);
        }
        return hat;
    }

    /// @dev The Hats ids `deployMoney` will create next: the Board's top hat, then the Shareholders' (step 1 then 2).
    function _nextTopHats() internal view returns (uint256 board, uint256 shareholders) {
        uint256 last = IHatsExtra(Addresses.HATS).lastTopHatId();
        board = (last + 1) << 224;
        shareholders = (last + 2) << 224;
    }

    function _firstChild(uint256 admin) internal pure returns (uint256) {
        return admin | (uint256(1) << 208);
    }

    // ------------------------------------------------------------------ equity inputs

    function _classes() internal pure returns (ICaptable.ClassParams[] memory classes) {
        classes = new ICaptable.ClassParams[](1);
        classes[0] = ICaptable.ClassParams({
            name: "Common",
            ticker: "ACME-C",
            weight: 1,
            convertsInto: type(uint8).max,
            rule: ICaptable.TransferRule.ToAnyShareholder,
            customRule: address(0),
            authorised: 10_000_000,
            originalIssuePrice: 0,
            conversionFloorPrice: 0,
            preferenceMultipleBps: 0,
            participating: false,
            seniority: 0,
            termsHash: keccak256("Acme articles")
        });
    }

    function _equityDeploy(IInstaller.MoneyDeployment memory d)
        internal
        view
        returns (IInstaller.EquityDeploy memory p)
    {
        p.safe = address(companySafe);
        p.money = d;
        p.name = "Acme";
        p.initialClasses = _classes();
        p.poolClassId = 0;
        p.governor = IInstaller.GovernorSettings({
            votingDelay: 1 days, votingPeriod: 7 days, proposalThreshold: 1, quorumNumerator: 50
        });
    }

    /// @dev Amira 6,000,000 vesting over four years with a one-year cliff, Ben 3,000,000 with no vesting, a pool of
    /// 1,000,000: the startup story's template.
    function _equityInstall(
        IInstaller.MoneyDeployment memory d,
        IInstaller.EquityDeployment memory e
    )
        internal
        view
        returns (IInstaller.EquityInstall memory p)
    {
        p.safe = address(companySafe);
        p.founderSafe = address(founderSafe);
        p.money = d;
        p.equity = e;
        p.founders = new IInstaller.FounderShares[](2);
        p.founders[0] = IInstaller.FounderShares({
            shareholder: address(founderSafe),
            classId: 0,
            amount: 6_000_000,
            start: uint64(block.timestamp),
            cliff: uint64(block.timestamp + 365 days),
            end: uint64(block.timestamp + 4 * 365 days),
            accelerateOnExit: true,
            documentHash: keccak256("Amira's founder agreement")
        });
        p.founders[1] = IInstaller.FounderShares({
            shareholder: address(benSafe),
            classId: 0,
            amount: 3_000_000,
            start: 0,
            cliff: 0,
            end: 0,
            accelerateOnExit: false,
            documentHash: keccak256("Ben's subscription")
        });
        p.optionPool = 1_000_000;
    }

    /// @dev Money installed, then equity deployed (by Eve: anyone may call it).
    function _deployEquity()
        internal
        returns (IInstaller.MoneyDeployment memory d, IInstaller.EquityDeployment memory e)
    {
        (d,) = _installMoney();
        vm.prank(users.eve);
        e = installer.deployEquity(_equityDeploy(d));
    }

    /// @dev Runs each call as `from` (a Safe acting outside the fork's signature flow, used for the founder's
    /// and the Governor's batches, whose signing is not what these tests check).
    function _runAs(address from, IInstaller.Call[] memory calls) internal {
        for (uint256 i; i < calls.length; ++i) {
            vm.prank(from);
            (bool ok, bytes memory reason) = calls[i].to.call{ value: calls[i].value }(calls[i].data);
            assertTrue(ok, string.concat("call ", vm.toString(i), " reverted ", vm.toString(reason)));
        }
    }

    /// @dev A second seat group: a mutable hat under the Shareholders' top hat (worn by Amira's Safe before the equity
    /// install), added to the Gate as a signer hat.
    function _seatGroup(IInstaller.MoneyDeployment memory d, string memory details) internal returns (uint256 hat) {
        vm.startPrank(address(founderSafe));
        hat = HATS_V1.createHat(d.shareholdersTopHat, details, 2, address(founderSafe), address(founderSafe), true, "");
        uint256[] memory add = new uint256[](1);
        add[0] = hat;
        _gateView().addSignerHats(add);
        vm.stopPrank();
    }

    function _isWearer(address who, uint256 hat) internal view returns (bool) {
        return HATS_V1.isWearerOfHat(who, hat);
    }

    function _gateView() internal view returns (IGateLike) {
        return IGateLike(address(gate));
    }

    function _rolesView() internal view returns (IRolesLike) {
        return IRolesLike(address(companyRoles));
    }
}
