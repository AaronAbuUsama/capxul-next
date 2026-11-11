// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IAgreements } from "../../../../src/interfaces/IAgreements.sol";
import { PayrollDepartments } from "../../../utils/Agreements/beta/PayrollDepartments.sol";
import { Agreements_Unit_Shared } from "../../../utils/Agreements/Agreements_Unit_Shared.sol";

/// @dev The two reads beta's `configure` makes of a Roles modifier.
contract BetaRoles {
    address public immutable avatar;
    address public immutable target;

    constructor(address safe) {
        avatar = safe;
        target = safe;
    }
}

/// @notice Differential fuzz (spec/agreements.md: "keep beta maths exactly"): the same random life of an
/// agreement is run on v4 Agreements and on beta `PayrollDepartments`, and after every step the accrual
/// checkpoint, `earnedScaled`, `releasedScaled`, `earnedOf` and `availableOf` must be identical, and a call
/// must succeed on both or revert on both. Beta is the deployed reference, not a copy.
contract Differential_Agreements_Unit_Fuzz_Test is Agreements_Unit_Shared {
    bytes32 internal constant DEPARTMENT = "ops";

    PayrollDepartments internal beta;
    address internal betaSafe;
    uint256 internal bigBudget;
    address internal payee;
    uint256 internal id; // v4's id
    uint256 internal rate; // the rate both agreements pay now, kept to choose raises and lowerings
    uint256 internal rng;

    function setUp() public override {
        super.setUp();
        betaSafe = makeAddr("beta Safe");
        beta = new PayrollDepartments();
        BetaRoles betaRoles = new BetaRoles(betaSafe);
        vm.startPrank(betaSafe);
        beta.configure(address(betaRoles), PAYOUT_KEY, address(0xBEEF));
        beta.setBudget(DEPARTMENT, address(usdc), type(uint128).max);
        vm.stopPrank();
        bigBudget = budgets.create(
            address(safe), 0, OPS_HAT, address(usdc), BUDGET_YEAR, type(uint128).max, address(roles), PAYOUT_KEY
        );
        payee = makeAddr("payee");
    }

    function testFuzz_EarnedAndReleasedMatchBeta(uint256 seed, uint8 steps) external {
        rng = seed;
        _offerOnBoth();
        _sync("offer");
        vm.warp(_now() + _next(0, 6 days));
        _bothOk(
            abi.encodeCall(IAgreements.accept, (id, TERMS)),
            abi.encodeCall(PayrollDepartments.accept, (1, TERMS)),
            payee,
            payee
        );
        _sync("accept");
        uint256 n = bound(steps, 1, 14);
        for (uint256 i; i < n; ++i) {
            _step();
            _sync("step");
        }
        // Whatever happened, a late look agrees too.
        vm.warp(_now() + _next(0, 400 days));
        _sync("late");
    }

    // ------------------------------------------------------------------ the life

    function _offerOnBoth() internal {
        uint128 r = uint128(_next(1, 1e15));
        rate = r;
        uint8 period = uint8(_next(0, 2));
        uint64[5] memory stepList = [uint64(1), 1 hours, 1 days, 7 days, MONTHLY];
        uint64 step = stepList[_next(0, 4)];
        uint64 startsAt = _next(0, 1) == 0 ? 0 : uint64(_now() + _next(1, 20 days));
        uint64 from = startsAt == 0 ? _now() : startsAt;
        uint64 endsAt = _next(0, 3) == 0 ? uint64(from + _next(8 days, 120 days)) : 0;
        uint64 expiry = uint64(_now() + 7 days);
        if (endsAt != 0 && expiry > endsAt) expiry = endsAt;
        vm.prank(users.jordan);
        id = agreements.offer(bigBudget, payee, r, period, startsAt, endsAt, step, expiry, TERMS);
        vm.prank(betaSafe);
        beta.offer(DEPARTMENT, address(usdc), payee, r, period, startsAt, endsAt, step, expiry, TERMS);
    }

    function _step() internal {
        uint256 op = _next(0, 6);
        uint64 nowTs = _now();
        if (op == 0) {
            vm.warp(nowTs + _next(1, 45 days));
        } else if (op == 1) {
            _both(abi.encodeCall(IAgreements.pause, (id)), abi.encodeCall(PayrollDepartments.pause, (DEPARTMENT, 1)));
        } else if (op == 2) {
            _both(abi.encodeCall(IAgreements.resume, (id)), abi.encodeCall(PayrollDepartments.resume, (DEPARTMENT, 1)));
        } else if (op == 3) {
            uint128 higher = uint128(rate + _next(1, rate));
            _both(
                abi.encodeCall(IAgreements.changeRate, (id, higher, 0)),
                abi.encodeCall(PayrollDepartments.changeRate, (DEPARTMENT, 1, higher, 0))
            );
        } else if (op == 4) {
            uint128 lower = uint128(_next(1, rate));
            uint64 effectiveAt = uint64(nowTs + _next(0, 30 days));
            _both(
                abi.encodeCall(IAgreements.changeRate, (id, lower, effectiveAt)),
                abi.encodeCall(PayrollDepartments.changeRate, (DEPARTMENT, 1, lower, effectiveAt))
            );
        } else if (op == 5) {
            uint64 endsAt = uint64(nowTs + _next(0, 90 days));
            _both(
                abi.encodeCall(IAgreements.end, (id, endsAt)),
                abi.encodeCall(PayrollDepartments.end, (DEPARTMENT, 1, endsAt))
            );
        } else {
            _both(
                abi.encodeCall(IAgreements.cancelChange, (id)),
                abi.encodeCall(PayrollDepartments.cancelChange, (DEPARTMENT, 1))
            );
        }
        // The stored rate is whatever the pair agreed on after the step.
        rate = agreements.agreementOf(id).rate;
    }

    // ------------------------------------------------------------------ the comparison

    function _both(bytes memory ours, bytes memory theirs) internal {
        _bothOk(ours, theirs, users.jordan, betaSafe);
    }

    /// @dev Calls both and requires both to succeed or both to revert.
    function _bothOk(bytes memory ours, bytes memory theirs, address ourCaller, address theirCaller) internal {
        vm.prank(ourCaller);
        (bool okOurs,) = address(agreements).call(ours);
        vm.prank(theirCaller);
        (bool okTheirs,) = address(beta).call(theirs);
        assertEq(okOurs, okTheirs, "one reverted and the other did not");
    }

    function _sync(string memory when_) internal view {
        IAgreements.Agreement memory a = agreements.agreementOf(id);
        PayrollDepartments.Agreement memory b = beta.agreementOf(1);
        assertEq(a.earnedScaled, b.earnedScaled, string.concat(when_, ": earnedScaled"));
        assertEq(a.releasedScaled, b.releasedScaled, string.concat(when_, ": releasedScaled"));
        assertEq(a.accruedAt, b.accruedAt, string.concat(when_, ": accruedAt"));
        assertEq(a.startsAt, b.startsAt, string.concat(when_, ": startsAt"));
        assertEq(a.endsAt, b.endsAt, string.concat(when_, ": endsAt"));
        assertEq(a.rate, b.rate, string.concat(when_, ": rate"));
        assertEq(a.pendingAt, b.pendingAt, string.concat(when_, ": pendingAt"));
        assertEq(a.pendingRate, b.pendingRate, string.concat(when_, ": pendingRate"));
        assertEq(a.paused, b.paused, string.concat(when_, ": paused"));
        assertEq(a.closed, b.closed, string.concat(when_, ": closed"));
        assertEq(a.accepted, b.accepted, string.concat(when_, ": accepted"));
        assertEq(agreements.earnedOf(id), beta.earnedOf(1), string.concat(when_, ": earnedOf"));
        assertEq(agreements.availableOf(id), beta.availableOf(1), string.concat(when_, ": availableOf"));
    }

    function _next(uint256 lo, uint256 hi) internal returns (uint256) {
        rng = uint256(keccak256(abi.encode(rng)));
        return bound(rng, lo, hi);
    }
}
