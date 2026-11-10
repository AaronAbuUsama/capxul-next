// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import { Test } from "forge-std/Test.sol";

import { Options } from "../../src/equity/Options.sol";
import { IOptions } from "../../src/interfaces/IOptions.sol";
import { MockERC20 } from "../mocks/MockERC20.sol";
import { Payments } from "../../src/money/Payments.sol";
import { MockCaptableForOptions } from "../utils/Options/MockCaptableForOptions.sol";

/// @notice Halmos checks for Options (gate 10). fv/halmos.md lists no Options row: O1 and O2 are Certora and
/// Fuzz-inv rows. These prove the pool arithmetic for every amount at once on one concrete grant (the dates stay
/// concrete, because Calendar date maths is proved by exhaustive loops, not symbolically): `exercise` succeeds
/// exactly up to what has vested (O1) and moves the pool, `allocated` and the strike in step (O2, F9); `setPool`
/// is refused exactly below `allocated`; `grant` is refused exactly above the pool left (O2).
/// Each check first proves one concrete call succeeds (fv/halmos.md vacuity guard), so the reverting stub fails.
/// Run with `FOUNDRY_DYNAMIC_TEST_LINKING=false` (see Escrow.symbolic.t.sol).
contract Options_Symbolic is Test {
    uint8 internal constant COMMON = 0;
    uint128 internal constant POOL = 1_000_000;
    uint128 internal constant SHARES = 150_000;
    uint128 internal constant STRIKE = 50_000;
    uint128 internal constant VESTED_36 = 112_500; // 36 of 48 months
    bytes32 internal constant DOC = keccak256("option agreement");
    uint64 internal constant START = 1_767_225_600; // 2026-01-01
    uint64 internal constant CLIFF = 1_798_761_600; // 2027-01-01
    uint64 internal constant END = 1_893_456_000; // 2030-01-01
    uint64 internal constant AT_36 = 1_861_920_000; // 2029-01-01
    address internal constant SAFE = address(0x5AFE);
    address internal constant ALICE = address(0xA11CE);
    address internal constant EXITS = address(0xE717);

    Options internal options;
    MockCaptableForOptions internal captable;
    MockERC20 internal usdc;

    function setUp() public {
        vm.warp(START);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        captable = new MockCaptableForOptions(SAFE, EXITS);
        captable.createClass(100_000_000);
        Payments payments = new Payments();
        options = Options(Clones.clone(address(new Options())));
        // The stub reverts here; each check's vacuity guard then fails.
        try options.initialize(SAFE, address(captable), address(payments), COMMON) { } catch { }
        vm.prank(SAFE);
        captable.setIssuerAllowance(address(options), COMMON, POOL);
        usdc.mint(ALICE, type(uint128).max);
        vm.prank(ALICE);
        usdc.approve(address(options), type(uint256).max);
    }

    /// @dev The Board sets the pool and grants the standard 150,000 to Alice, who accepts.
    function _grantAccepted() internal returns (uint256 id, bool ok) {
        vm.prank(SAFE);
        try options.setPool(POOL) { }
        catch {
            return (0, false);
        }
        vm.prank(SAFE);
        try options.grant(
            ALICE, SHARES, address(usdc), STRIKE, START, CLIFF, END, START + 30 days, END + 365 days, 90, DOC
        ) returns (
            uint256 granted
        ) {
            id = granted;
        } catch {
            return (0, false);
        }
        vm.prank(ALICE);
        try options.accept(id, DOC) {
            ok = true;
        } catch { }
    }

    /// @dev O1 and O2 on exercise: at 36 of 48 months an exercise of `n` succeeds exactly when
    /// `1 <= n <= 112,500`, and then exercised, pool, allocated and the Safe's strike move by exactly `n` (and
    /// `n * strike`). The vacuity guard is a concrete exercise of 1 from a second, zero-strike grant: it makes no
    /// payment, because Halmos models keccak as an uninterpreted function and would otherwise let the symbolic
    /// exercise's payment id collide with the guard's consumed one (a spurious `PaymentIdConsumed` path).
    function check_O1_exerciseUpToVested(uint128 n) external {
        (uint256 id, bool ok) = _grantAccepted();
        assert(ok);
        // Vacuity guard: each step must succeed (a revert outside `try` would end the path unchecked).
        uint256 guardId;
        vm.prank(SAFE);
        try options.grant(
            ALICE, 10, address(usdc), 0, START, START, START, START + 30 days, START + 1, 0, DOC
        ) returns (
            uint256 granted
        ) {
            guardId = granted;
        } catch {
            assert(false);
        }
        vm.prank(ALICE);
        try options.accept(guardId, DOC) { }
        catch {
            assert(false);
        }
        vm.prank(ALICE);
        try options.exercise(guardId, 1) { }
        catch {
            assert(false);
        }
        vm.warp(AT_36);
        uint256 safeBefore = usdc.balanceOf(SAFE);
        vm.prank(ALICE);
        try options.exercise(id, n) {
            assert(n >= 1 && n <= VESTED_36);
            assert(options.getGrant(id).exercised == n);
            assert(options.getGrant(id).exercised <= options.vestedOf(id, AT_36));
            assert(options.pool() == POOL - 1 - n);
            assert(options.allocated() == SHARES + 10 - 1 - n);
            assert(usdc.balanceOf(SAFE) == safeBefore + uint256(n) * STRIKE);
            assert(usdc.balanceOf(address(options)) == 0);
        } catch {
            assert(n == 0 || n > VESTED_36);
        }
    }

    /// @dev O2 on setPool: with 150,000 allocated, `setPool(amount)` succeeds exactly when `amount >= 150,000`.
    function check_O2_setPoolCoversAllocated(uint128 amount) external {
        (, bool ok) = _grantAccepted();
        assert(ok);
        vm.prank(SAFE);
        try options.setPool(SHARES) { }
        catch {
            assert(false); // vacuity guard: exactly allocated is allowed
        }
        vm.prank(SAFE);
        try options.setPool(amount) {
            assert(amount >= SHARES);
            assert(options.pool() == amount);
            assert(options.allocated() <= options.pool());
        } catch {
            assert(amount < SHARES);
        }
    }

    /// @dev O2 on grant: after the standard grant, a grant of `shares` with a valid schedule succeeds exactly when
    /// it fits the 850,000 left, and `allocated` rises by exactly `shares`.
    function check_O2_grantFitsThePool(uint128 shares) external {
        (, bool ok) = _grantAccepted();
        assert(ok);
        vm.prank(SAFE);
        try options.grant(ALICE, shares, address(usdc), STRIKE, START, CLIFF, END, START + 30 days, END + 1, 0, DOC) {
            assert(shares <= POOL - SHARES);
            assert(options.allocated() == SHARES + shares);
            assert(options.allocated() <= options.pool());
        } catch {
            assert(shares == 0 || shares > POOL - SHARES);
        }
    }
}
