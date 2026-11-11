// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { Addresses } from "../../fork/Addresses.sol";
import { ICreateCall } from "../../scenario/Scenario_Test.t.sol";
import { ScenarioRelay } from "./ScenarioRelay.sol";
import { ScenarioValues } from "./ScenarioValues.sol";

/// @notice The v4 world under a scenario: Companies House deploys the protocol from the file's `deploy` list
/// (each `source` under src/, constructor arguments as address expressions), runs the `wire` calls as plain calls
/// (`Budgets.setAgreements`, which only the deployer may send), and `tokens` funds its accounts.
abstract contract ScenarioBase is ScenarioValues {
    /// @dev Each token's balance held by Payments at setup (P2 compares every checkpoint with it).
    mapping(address token => uint256 balance) internal paymentsAtSetup;
    address[] internal tokens;

    function setUp() public virtual override {
        super.setUp();
        relay = new ScenarioRelay();
        vm.label(address(relay), "ScenarioRelay");
        _deployV4();
        _wire();
        _fund();
        companySafe = _identity(_companyActor());
        // Every read of the scenario copies the file from storage; a long story would run out of gas on that
        // alone, and gas is not what a scenario measures.
        vm.pauseGasMetering();
    }

    // ------------------------------------------------------------------ setup

    /// @dev Companies House CREATE2-deploys each `deploy` entry with salt keccak256("capxul:v4:<name>").
    function _deployV4() internal {
        uint256 n = _count(".deploy");
        for (uint256 i; i < n; ++i) {
            string memory p = string.concat(".deploy[", vm.toString(i), "]");
            string memory name = vm.parseJsonString(json, string.concat(p, ".name"));
            bytes memory initcode =
                vm.getCode(string.concat("src/", vm.parseJsonString(json, string.concat(p, ".source")), ":", name));
            if (vm.keyExistsJson(json, string.concat(p, ".args"))) {
                string[] memory args = vm.parseJsonStringArray(json, string.concat(p, ".args"));
                for (uint256 j; j < args.length; ++j) {
                    initcode = bytes.concat(initcode, abi.encode(_addr(args[j])));
                }
            }
            bytes32 salt = keccak256(abi.encodePacked("capxul:v4:", name));
            _exec(
                companiesHouse,
                companiesHouseKey,
                Addresses.CREATE_CALL_141,
                abi.encodeCall(ICreateCall.performCreate2, (0, initcode, salt)),
                DELEGATECALL
            );
            address deployed = vm.computeCreate2Address(salt, keccak256(initcode), companiesHouse);
            assertGt(deployed.code.length, 0, name);
            contractAt[keccak256(bytes(name))] = deployed;
            vm.label(deployed, name);
        }
    }

    /// @dev The deploy batch's own calls (for example `Budgets.setAgreements`), sent by Companies House as calls.
    function _wire() internal {
        uint256 n = _count(".wire");
        for (uint256 i; i < n; ++i) {
            string memory p = string.concat(".wire[", vm.toString(i), "]");
            string memory call = vm.parseJsonString(json, string.concat(p, ".call"));
            (address target, bytes memory data) = _encode(call, string.concat(p, ".args"));
            // A dry run first, so a failure names the contract's error rather than Safe's GS013.
            uint256 snapshot = vm.snapshotState();
            vm.prank(companiesHouse);
            (bool ok, bytes memory reason) = target.call(data);
            vm.revertToState(snapshot);
            assertTrue(ok, string.concat(call, " reverted ", vm.toString(reason)));
            _exec(companiesHouse, companiesHouseKey, target, data, CALL);
        }
    }

    function _fund() internal {
        if (!vm.keyExistsJson(json, ".tokens")) return;
        string[] memory names = vm.parseJsonKeys(json, ".tokens");
        address payments = contractAt[keccak256("Payments")];
        for (uint256 i; i < names.length; ++i) {
            address token = _addr(names[i]);
            tokens.push(token);
            vm.label(token, names[i]);
            if (payments != address(0)) paymentsAtSetup[token] = IERC20(token).balanceOf(payments);
            string memory f = string.concat(".tokens.", names[i], ".fund");
            if (!vm.keyExistsJson(json, f)) continue;
            string[] memory who = vm.parseJsonKeys(json, f);
            for (uint256 j; j < who.length; ++j) {
                deal(token, _addr(who[j]), _u(f, who[j]));
            }
        }
    }
}
