// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IVesting } from "../../../../../src/interfaces/IVesting.sol";
import { Vesting_Shared_Test } from "../../../../utils/Vesting/Vesting_Shared_Test.sol";

/// @dev Ruling D7 (invariant V6): the Safe may accelerate a grant, only ever earlier, with a document hash.
contract Accelerate_Vesting_Unit_Concrete_Test is Vesting_Shared_Test {
    function test_WhenTheCallerIsNotTheCaptablesSafe() external {
        // it should revert with OnlyBoard
        uint256 id = _defaultGrant(users.amira);
        address[3] memory callers = [address(users.eve), exits, address(users.amira)];
        for (uint256 i; i < callers.length; ++i) {
            vm.expectRevert(IVesting.OnlyBoard.selector);
            vm.prank(callers[i]);
            vesting.accelerate(id, gCliff, DOC2);
        }
    }

    function test_WhenTheGrantDoesNotExist() external {
        // it should revert with UnknownGrant
        vm.expectRevert(abi.encodeWithSelector(IVesting.UnknownGrant.selector, 99));
        _accelerate(99, gCliff, DOC2);
    }

    function test_WhenTheGrantWasRevoked() external {
        // it should revert with AlreadyRevoked
        uint256 id = _defaultGrant(users.amira);
        _revoke(id, _date(2028, 1, 1));
        vm.expectRevert(IVesting.AlreadyRevoked.selector);
        _accelerate(id, gCliff, DOC2);
    }

    function test_WhenTheDocumentHashIsZero() external {
        // it should revert with ZeroDocument
        uint256 id = _defaultGrant(users.amira);
        vm.expectRevert(IVesting.ZeroDocument.selector);
        _accelerate(id, gCliff, bytes32(0));
    }

    modifier whenTheNewEndIsNotEarlierThanTheCurrentEnd() {
        _;
    }

    function test_GivenItEqualsTheCurrentEnd() external whenTheNewEndIsNotEarlierThanTheCurrentEnd {
        // it should revert with NotEarlier
        uint256 id = _defaultGrant(users.amira);
        vm.expectRevert(abi.encodeWithSelector(IVesting.NotEarlier.selector, gEnd, gEnd));
        _accelerate(id, gEnd, DOC2);
    }

    function test_GivenItIsLaterThanTheCurrentEnd() external whenTheNewEndIsNotEarlierThanTheCurrentEnd {
        // it should revert with NotEarlier
        uint256 id = _defaultGrant(users.amira);
        vm.expectRevert(abi.encodeWithSelector(IVesting.NotEarlier.selector, gEnd, gEnd + 1));
        _accelerate(id, gEnd + 1, DOC2);
        assertEq(vesting.getGrant(id).end, gEnd, "end unchanged");
    }

    modifier whenTheNewEndIsEarlier() {
        _;
    }

    function test_WhenTheNewEndIsEarlier() external whenTheNewEndIsEarlier {
        uint256 id = _defaultGrant(users.amira);
        uint64 newEnd = _date(2028, 1, 1); // 24 months from the start, after the cliff
        uint64[8] memory times =
            [gStart, gCliff - 1, gCliff, _date(2027, 6, 1), _date(2027, 12, 31), newEnd, _date(2029, 1, 1), gEnd];
        uint128[8] memory before;
        for (uint256 i; i < times.length; ++i) {
            before[i] = _locked(users.amira, times[i]);
        }
        // Ben's grant has a one-year cliff, for the cliff leaf below.
        uint256 benId = _grant(users.ben, AMOUNT, gStart, gCliff, gEnd, false);
        uint256 supply = IERC20(address(common)).totalSupply();

        // it should move no shares and change no supply
        _expectNoIssueOrBurn();
        // it should emit Accelerated with the new end and the document hash
        vm.expectEmit(true, true, true, true, address(vesting));
        emit IVesting.Accelerated(address(safe), id, newEnd, DOC2);
        _accelerate(id, newEnd, DOC2);

        IVesting.Grant memory g = vesting.getGrant(id);
        // it should set the end to the later of the new end and the start
        assertEq(g.end, newEnd, "end");
        assertEq(g.start, gStart, "start unchanged");
        assertEq(g.cliff, gCliff, "cliff already earlier stays");
        // it should store the document hash
        assertEq(g.documentHash, DOC2, "document");
        assertEq(_balance(users.amira), AMOUNT, "balance");
        assertEq(IERC20(address(common)).totalSupply(), supply, "supply");
        // The new curve: 24 steps of 200,000.
        assertEq(_locked(users.amira, _date(2027, 6, 1)), 1_400_000, "after 17 of 24 months");
        assertEq(_locked(users.amira, newEnd), 0, "nothing at the new end");
        // it should never raise locked at any time
        for (uint256 i; i < times.length; ++i) {
            assertLe(_locked(users.amira, times[i]), before[i], "locked rose");
        }

        // it should lower the cliff to the new end when the cliff was later
        uint64 benEnd = _date(2026, 7, 1); // 6 months, before the one-year cliff
        _accelerate(benId, benEnd, DOC2);
        IVesting.Grant memory b = vesting.getGrant(benId);
        assertEq(b.end, benEnd, "ben end");
        assertEq(b.cliff, benEnd, "ben cliff lowered to the end");
        assertEq(_locked(users.ben, benEnd - 1), AMOUNT, "all locked before");
        assertEq(_locked(users.ben, benEnd), 0, "all unlocked at the new end");
    }

    function test_GivenTheNewEndIsUnderOneMonthFromTheStart() external whenTheNewEndIsEarlier {
        // it should set the cliff to the end so everything unlocks at once
        uint256 id = _grant(users.amira, AMOUNT, gStart, gStart, gEnd, true); // no cliff
        uint64 newEnd = gStart + 10 days;
        _accelerate(id, newEnd, DOC2);
        IVesting.Grant memory g = vesting.getGrant(id);
        assertEq(g.end, newEnd, "end");
        assertEq(g.cliff, newEnd, "cliff is the end");
        assertEq(_locked(users.amira, newEnd - 1), AMOUNT, "all locked before");
        assertEq(_locked(users.amira, newEnd), 0, "all unlocked at once");
    }

    function test_GivenTheNewEndIsBeforeTheStart() external whenTheNewEndIsEarlier {
        // it should set the end to the start
        uint64 start = _date(2026, 6, 1);
        uint256 id = _grant(users.amira, AMOUNT, start, _date(2027, 6, 1), _date(2030, 6, 1), true);
        vm.expectEmit(true, true, true, true, address(vesting));
        emit IVesting.Accelerated(address(safe), id, start, DOC2);
        _accelerate(id, _date(2026, 3, 1), DOC2);
        IVesting.Grant memory g = vesting.getGrant(id);
        assertEq(g.end, start, "end is the start");
        assertEq(g.cliff, start, "cliff is the start");
        assertEq(_locked(users.amira, start - 1), AMOUNT, "locked before the start");
        assertEq(_locked(users.amira, start), 0, "unlocked from the start");
    }
}
