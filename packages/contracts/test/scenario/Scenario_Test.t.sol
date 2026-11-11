// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";

import { ICompaniesHouseClaimer } from "../../src/interfaces/ICompaniesHouseClaimer.sol";
import { Addresses } from "../fork/Addresses.sol";
import { ISafe, ISafeProxyFactory } from "../fork/Interfaces.sol";

/// @dev Safe 1.4.1's StorageAccessible: delegatecalls the target from the Safe and reverts with
/// abi.encodePacked(success, returndata length, returndata).
interface ISafeSimulate {
    function simulateAndRevert(address targetContract, bytes memory calldataPayload) external;
}

/// @dev CreateCall 1.4.1, delegatecalled by Companies House's Safe so the Safe is the creator.
interface ICreateCall {
    function performCreate2(uint256 value, bytes memory deploymentData, bytes32 salt) external returns (address);
}

/// @notice The Foundry scenario runner (docs/planning/protocol-v4/spec/scenario-player.md). It reads
/// `scenarios/<name>.scenario.json`, forks Base Sepolia at the pin, sets the clock to `start`, makes
/// Companies House a real Safe 1.4.1 and has it deploy the scenario's contracts by CREATE2, then plays
/// events and checkpoints in time order with `vm.warp` and `vm.prank`, asserting each checkpoint.
///
/// Actors (D1, D13): a person acts from their personal Safe (the Safe Companies House claims for the
/// scenario's namespace and their email), with their own key approving through a v = 1 signature;
/// `companies-house` acts as Companies House's Safe by delegatecall; `anyone` calls from its own key.
/// An actor's key is forge-std's `makeAddr(name)`, the same address the TypeScript player uses.
///
/// Each slice adds its calls by overriding `_encode` and calling `super._encode` for the rest.
/// Needs `fs_permissions = [{ access = "read", path = "./scenarios" }]` in foundry.toml.
abstract contract Scenario_Test is Test {
    uint8 internal constant CALL = 0;
    uint8 internal constant DELEGATECALL = 1;

    string internal json;
    uint256 internal start;
    address internal companiesHouse;
    address internal companiesHouseKey;
    mapping(bytes32 name => address deployed) internal contractAt;

    error UnknownActor(string name);
    error UnknownCall(string call);
    error NoCompaniesHouse();
    error BadTime(string at);

    /// @dev The scenario file's name without `.scenario.json`.
    function _scenario() internal pure virtual returns (string memory);

    function setUp() public virtual {
        vm.createSelectFork(vm.envOr("BASE_SEPOLIA_FORK_URL", string("https://sepolia.base.org")), Addresses.FORK_BLOCK);
        json = vm.readFile(string.concat(vm.projectRoot(), "/scenarios/", _scenario(), ".scenario.json"));
        start = _isoTime(vm.parseJsonString(json, ".start"));
        vm.warp(start);
        _companiesHouse();
        _deployContracts();
    }

    /// @notice Plays the whole scenario: events and checkpoints merged by time, an event first when
    /// both fall on the same instant.
    function test_Play() external {
        uint256 events = _count(".events");
        uint256 checkpoints = _count(".checkpoints");
        uint256 e;
        uint256 c;
        uint256 last = start;
        while (e < events || c < checkpoints) {
            string memory ep = string.concat(".events[", vm.toString(e), "]");
            string memory cp = string.concat(".checkpoints[", vm.toString(c), "]");
            bool eventNext = e < events && (c == checkpoints || _at(ep) <= _at(cp));
            string memory p = eventNext ? ep : cp;
            uint256 at = _at(p);
            assertGe(at, last, string.concat(p, " is earlier than the step before it"));
            vm.warp(at);
            last = at;
            if (eventNext) {
                _event(ep);
                ++e;
            } else {
                _checkpoint(cp);
                ++c;
            }
        }
    }

    // ------------------------------------------------------------------ setup

    function _companiesHouse() internal {
        string[] memory names = vm.parseJsonKeys(json, ".actors");
        for (uint256 i; i < names.length; ++i) {
            if (keccak256(bytes(_role(names[i]))) != keccak256("companies-house")) continue;
            companiesHouseKey = _key(names[i]);
            address[] memory owners = new address[](1);
            owners[0] = companiesHouseKey;
            bytes memory init = abi.encodeCall(
                ISafe.setup,
                (owners, 1, address(0), "", Addresses.COMPATIBILITY_FALLBACK_HANDLER_150, address(0), 0, payable(0))
            );
            companiesHouse = ISafeProxyFactory(Addresses.SAFE_PROXY_FACTORY_150)
                .createProxyWithNonce(Addresses.SAFE_L2_150, init, 0);
            vm.label(companiesHouse, "Companies House");
            return;
        }
    }

    /// @dev Companies House deploys each contract by CREATE2 with salt keccak256("capxul:v4:<Name>").
    function _deployContracts() internal {
        if (!vm.keyExistsJson(json, ".contracts")) return;
        string[] memory names = vm.parseJsonStringArray(json, ".contracts");
        if (names.length > 0 && companiesHouse == address(0)) revert NoCompaniesHouse();
        for (uint256 i; i < names.length; ++i) {
            bytes memory initcode = vm.getCode(string.concat(names[i], ".sol:", names[i]));
            bytes32 salt = keccak256(abi.encodePacked("capxul:v4:", names[i]));
            _exec(
                companiesHouse,
                companiesHouseKey,
                Addresses.CREATE_CALL_141,
                abi.encodeCall(ICreateCall.performCreate2, (0, initcode, salt)),
                DELEGATECALL
            );
            address deployed = vm.computeCreate2Address(salt, keccak256(initcode), companiesHouse);
            assertGt(deployed.code.length, 0, names[i]);
            contractAt[keccak256(bytes(names[i]))] = deployed;
            vm.label(deployed, names[i]);
        }
    }

    // ------------------------------------------------------------------ events

    function _event(string memory p) internal {
        string memory actor = vm.parseJsonString(json, string.concat(p, ".actor"));
        string memory call = vm.parseJsonString(json, string.concat(p, ".call"));
        (address target, bytes memory data) = _encode(call, string.concat(p, ".args"));
        string memory role = _role(actor);
        bool companiesHouseActs = keccak256(bytes(role)) == keccak256("companies-house");
        string memory revertPath = string.concat(p, ".expect.revert");

        if (vm.keyExistsJson(json, revertPath)) {
            bytes memory reason = _simulate(actor, role, target, data);
            assertGe(reason.length, 4, string.concat(p, ": reverted without an error"));
            assertEq(bytes4(reason), _selector(vm.parseJsonString(json, revertPath)), string.concat(p, ": wrong error"));
        } else if (companiesHouseActs) {
            // A dry run first, so a failure names the claimer's error rather than Safe's GS013.
            try ISafeSimulate(companiesHouse).simulateAndRevert(target, data) { }
            catch (bytes memory raw) {
                (bool ok, bytes memory reason) = _unpackSimulation(raw);
                assertTrue(ok, string.concat(p, ": ", call, " reverted ", vm.toString(reason)));
            }
            _exec(companiesHouse, _key(actor), target, data, DELEGATECALL);
        } else if (keccak256(bytes(role)) == keccak256("anyone")) {
            vm.prank(_key(actor));
            (bool ok, bytes memory reason) = target.call(data);
            assertTrue(ok, string.concat(p, ": ", call, " reverted ", vm.toString(reason)));
        } else {
            _exec(_identity(actor), _key(actor), target, data, CALL);
        }
    }

    /// @dev The calls this runner knows. A slice overrides this for its own and defers the rest here.
    function _encode(
        string memory call,
        string memory args
    )
        internal
        view
        virtual
        returns (address target, bytes memory data)
    {
        if (keccak256(bytes(call)) == keccak256("CompaniesHouseClaimer.claim")) {
            target = _contract("CompaniesHouseClaimer");
            data = abi.encodeCall(
                ICompaniesHouseClaimer.claim,
                (
                    vm.parseJsonString(json, string.concat(args, ".namespace")),
                    vm.parseJsonString(json, string.concat(args, ".email")),
                    _address(vm.parseJsonString(json, string.concat(args, ".signer")))
                )
            );
            return (target, data);
        }
        revert UnknownCall(call);
    }

    /// @dev The call's revert data without changing state.
    function _simulate(
        string memory actor,
        string memory role,
        address target,
        bytes memory data
    )
        internal
        returns (bytes memory reason)
    {
        if (keccak256(bytes(role)) == keccak256("companies-house")) {
            try ISafeSimulate(companiesHouse).simulateAndRevert(target, data) { }
            catch (bytes memory raw) {
                bool ok;
                (ok, reason) = _unpackSimulation(raw);
                assertFalse(ok, "expected a revert");
            }
            return reason;
        }
        address from = keccak256(bytes(role)) == keccak256("anyone") ? _key(actor) : _identity(actor);
        vm.prank(from);
        bool success;
        (success, reason) = target.call(data);
        assertFalse(success, "expected a revert");
    }

    /// @dev Safe 1.4.1 execTransaction from a 1-of-1 Safe: its owner sends it with a v = 1 signature.
    function _exec(address safe, address owner, address to, bytes memory data, uint8 operation) internal {
        bytes memory signature = abi.encodePacked(uint256(uint160(owner)), bytes32(0), uint8(1));
        vm.prank(owner);
        bool ok = ISafe(safe).execTransaction(to, 0, data, operation, 0, 0, 0, address(0), payable(0), signature);
        assertTrue(ok, "execTransaction");
    }

    // ------------------------------------------------------------------ checkpoints

    function _checkpoint(string memory p) internal view {
        string memory name = vm.parseJsonString(json, string.concat(p, ".name"));
        string memory safes = string.concat(p, ".expect.safes");
        if (!vm.keyExistsJson(json, safes)) return;
        string[] memory people = vm.parseJsonKeys(json, safes);
        for (uint256 i; i < people.length; ++i) {
            string memory q = string.concat(safes, ".", people[i]);
            string memory label = string.concat(name, ": ", people[i], "'s Safe");
            address safe = _identity(people[i]);
            bool deployed = vm.parseJsonBool(json, string.concat(q, ".deployed"));
            assertEq(safe.code.length > 0, deployed, string.concat(label, " deployed"));
            if (vm.keyExistsJson(json, string.concat(q, ".owners"))) {
                string[] memory expected = vm.parseJsonStringArray(json, string.concat(q, ".owners"));
                address[] memory owners = ISafe(safe).getOwners();
                assertEq(owners.length, expected.length, string.concat(label, " owner count"));
                for (uint256 j; j < owners.length; ++j) {
                    assertEq(owners[j], _address(expected[j]), string.concat(label, " owner"));
                }
            }
            if (vm.keyExistsJson(json, string.concat(q, ".threshold"))) {
                assertEq(
                    ISafe(safe).getThreshold(),
                    vm.parseJsonUint(json, string.concat(q, ".threshold")),
                    string.concat(label, " threshold")
                );
            }
        }
    }

    // ------------------------------------------------------------------ names

    /// @dev `anyone`, or the actor's declared role (a bare string or `{ "role": ... }`).
    function _role(string memory actor) internal view returns (string memory) {
        if (keccak256(bytes(actor)) == keccak256("anyone")) return "anyone";
        string memory path = string.concat(".actors.", actor);
        if (vm.keyExistsJson(json, string.concat(path, ".role"))) {
            return vm.parseJsonString(json, string.concat(path, ".role"));
        }
        if (vm.keyExistsJson(json, path)) return vm.parseJsonString(json, path);
        revert UnknownActor(actor);
    }

    /// @dev forge-std's makeAddr(name), without the label.
    function _key(string memory name) internal pure returns (address) {
        return vm.addr(uint256(keccak256(abi.encodePacked(name))));
    }

    /// @dev Who the actor is on chain: Companies House's Safe, a person's personal Safe, or the key.
    function _identity(string memory actor) internal view returns (address) {
        string memory role = _role(actor);
        if (keccak256(bytes(role)) == keccak256("companies-house")) return companiesHouse;
        if (keccak256(bytes(role)) == keccak256("anyone")) return _key(actor);
        return ICompaniesHouseClaimer(_contract("CompaniesHouseClaimer"))
            .safeAddressFor(
                companiesHouse,
                vm.parseJsonString(json, ".namespace"),
                vm.parseJsonString(json, string.concat(".actors.", actor, ".email"))
            );
    }

    /// @dev An address expression: 0x…, `<actor>.signer`, a contract name, or an actor.
    function _address(string memory expression) internal view returns (address) {
        if (bytes(expression).length == 42 && bytes(expression)[0] == "0" && bytes(expression)[1] == "x") {
            return vm.parseAddress(expression);
        }
        string[] memory parts = vm.split(expression, ".");
        if (parts.length == 2 && keccak256(bytes(parts[1])) == keccak256("signer")) {
            _role(parts[0]); // the actor must exist
            return _key(parts[0]);
        }
        address deployed = contractAt[keccak256(bytes(expression))];
        return deployed != address(0) ? deployed : _identity(expression);
    }

    function _contract(string memory name) internal view returns (address deployed) {
        deployed = contractAt[keccak256(bytes(name))];
        if (deployed == address(0)) revert UnknownCall(name);
    }

    // ------------------------------------------------------------------ format

    function _count(string memory path) internal view returns (uint256 n) {
        while (vm.keyExistsJson(json, string.concat(path, "[", vm.toString(n), "]"))) ++n;
    }

    /// @dev A bare name means an error without parameters.
    function _selector(string memory error) internal pure returns (bytes4) {
        return
            bytes4(keccak256(bytes(vm.indexOf(error, "(") != type(uint256).max ? error : string.concat(error, "()"))));
    }

    /// @dev `+<n>s|m|h|d|w` from start, or `YYYY-MM-DDTHH:MM:SSZ`.
    function _at(string memory p) internal view returns (uint256) {
        bytes memory at = bytes(vm.parseJsonString(json, string.concat(p, ".at")));
        if (at[0] != "+") return _isoTime(string(at));
        bytes1 unit = at[at.length - 1];
        uint256 seconds_ =
            unit == "s" ? 1 : unit == "m" ? 60 : unit == "h" ? 3600 : unit == "d" ? 86_400 : unit == "w" ? 604_800 : 0;
        if (seconds_ == 0 || at.length < 3) revert BadTime(string(at));
        return start + _digits(at, 1, at.length - 2) * seconds_;
    }

    /// @dev UTC `YYYY-MM-DDTHH:MM:SSZ` to Unix seconds (Howard Hinnant's days_from_civil).
    function _isoTime(string memory iso) internal pure returns (uint256) {
        bytes memory b = bytes(iso);
        uint256 year = _digits(b, 0, 4);
        uint256 month = _digits(b, 5, 2);
        uint256 y = month <= 2 ? year - 1 : year;
        uint256 era = y / 400;
        uint256 yoe = y - era * 400;
        uint256 doy = (153 * ((month + 9) % 12) + 2) / 5 + _digits(b, 8, 2) - 1;
        uint256 days_ = era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468;
        return days_ * 86_400 + _digits(b, 11, 2) * 3600 + _digits(b, 14, 2) * 60 + _digits(b, 17, 2);
    }

    function _digits(bytes memory b, uint256 from, uint256 length) internal pure returns (uint256 n) {
        for (uint256 i = from; i < from + length; ++i) {
            if (b[i] < "0" || b[i] > "9") revert BadTime(string(b));
            n = n * 10 + (uint8(b[i]) - 48);
        }
    }

    /// @dev simulateAndRevert's revert data: success word, length word, then the call's return data.
    function _unpackSimulation(bytes memory raw) internal pure returns (bool ok, bytes memory data) {
        ok = uint256(bytes32(raw)) != 0;
        uint256 length = raw.length - 64;
        data = new bytes(length);
        for (uint256 i; i < length; ++i) {
            data[i] = raw[i + 64];
        }
    }
}

/// @notice W0's chapter: Companies House claims three personal Safes over three days.
contract Claimer_Scenario_Test is Scenario_Test {
    function _scenario() internal pure override returns (string memory) {
        return "claimer";
    }
}
