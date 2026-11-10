// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IGovernor as IOZGovernor } from "@openzeppelin/contracts/governance/IGovernor.sol";
import { IERC5805 } from "@openzeppelin/contracts/interfaces/IERC5805.sol";
import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import { Test } from "forge-std/Test.sol";

import { Governor } from "../../src/equity/Governor.sol";
import { IGovernor } from "../../src/interfaces/IGovernor.sol";
import { GovernorTarget, MockCaptableVotes } from "../utils/Governor/GovernorMocks.sol";

/// @notice Halmos checks for the Governor (gate 10). fv/halmos.md lists no Governor row (Halmos fits maths,
/// and the Governor has none of its own); these three are added because G1 and G4 are small enough to prove
/// for every address and amount. Each check first initialises the clone, which must succeed (the vacuity
/// guard), so the reverting stub fails it. The guard makes no proposal: Halmos cannot then prove a second
/// proposal's id slot apart from the first, and reports a false "proposal exists" counterexample.
contract Governor_Symbolic is Test {
    address internal constant SAFE = address(0x5AFE);
    address internal constant AMIRA = address(0xA111);

    Governor internal governor;
    MockCaptableVotes internal captable;
    GovernorTarget internal target;

    function setUp() public {
        captable = new MockCaptableVotes(SAFE);
        target = new GovernorTarget();
        governor = Governor(payable(Clones.clone(address(new Governor()))));
        captable.mint(AMIRA, 600);
        captable.mint(SAFE, 100);
    }

    function _guard() internal {
        address[] memory allowed = new address[](2);
        allowed[0] = address(captable);
        allowed[1] = address(target);
        try governor.initialize("Acme", IERC5805(address(captable)), SAFE, allowed, 1 days, 7 days, 9, 5000) { }
        catch {
            assert(false);
        }
        vm.warp(block.timestamp + 1);
        assert(governor.isAllowedTarget(address(target)));
    }

    function _one(address a) internal pure returns (address[] memory list) {
        list = new address[](1);
        list[0] = a;
    }

    /// @dev G1: for every address, it is allowed exactly when it was listed or is the Governor; the Safe never
    /// is; and a proposal to it from a shareholder with votes fails with `TargetNotAllowed(it)` exactly when
    /// it is not allowed.
    function check_G1_onlyListedTargets(address a) public {
        _guard();
        bool listed = a == address(captable) || a == address(target) || a == address(governor);
        assert(governor.isAllowedTarget(a) == listed);
        assert(!governor.isAllowedTarget(SAFE));
        vm.prank(AMIRA);
        try governor.propose(_one(a), new uint256[](1), new bytes[](1), "symbolic") {
            assert(listed);
        } catch (bytes memory reason) {
            assert(!listed);
            assert(keccak256(reason) == keccak256(abi.encodeWithSelector(IGovernor.TargetNotAllowed.selector, a)));
        }
    }

    /// @dev G1: `relay` reverts `RelayDisabled` for every caller, target and value.
    function check_G1_relayAlwaysReverts(address caller, address to, uint256 value) public {
        _guard();
        vm.deal(caller, value);
        vm.prank(caller);
        try governor.relay{ value: value }(to, value, "") {
            assert(false);
        } catch (bytes memory reason) {
            assert(bytes4(reason) == IGovernor.RelayDisabled.selector);
        }
    }

    /// @dev G4 (N-7): every nonzero amount of ether from every sender is refused with
    /// `GovernorDisabledDeposit`, and the balance stays 0.
    function check_G4_refusesAnyEther(address sender, uint256 value) public {
        _guard();
        vm.assume(value > 0 && sender != address(governor));
        vm.deal(sender, value);
        vm.prank(sender);
        (bool ok, bytes memory reason) = address(governor).call{ value: value }("");
        assert(!ok);
        assert(bytes4(reason) == IOZGovernor.GovernorDisabledDeposit.selector);
        assert(address(governor).balance == 0);
    }
}
