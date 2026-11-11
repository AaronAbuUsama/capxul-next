// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";

import { IExits } from "../../../../../src/interfaces/IExits.sol";
import { CapxulExitVectors } from "../../../../utils/Exits/CapxulExitVectors.sol";
import { Exits_Test } from "../../../../utils/Exits/Exits_Test.sol";
import { MockCaptableForExits, MockOptionsForExits, MockVestingForExits } from "../../../../utils/Exits/ExitsMocks.sol";

/// @dev spec/exits.md `preview` (anyone): the waterfall over the Captable's classes and the given holdings;
/// invariant X1 against the Capxul vectors (scenarios/README.md: payouts within $1).
contract Preview_Exits_Unit_Concrete_Test is Exits_Test {
    function test_WhenAShareHoldingNamesAnUnknownClass() external {
        // it should reject the unknown class
        _approveSale(address(usdc), PROCEEDS);
        IExits.Holding[] memory h = _holdings();
        h[0].classId = type(uint8).max;
        vm.expectRevert(abi.encodeWithSelector(IExits.IncompleteHoldings.selector, type(uint8).max));
        exits.preview(SALE, h);
    }

    function test_WhenAnOptionHoldingNamesTheWrongGrantee() external {
        // it should reject the option holding
        _approveSale(address(usdc), PROCEEDS);
        IExits.Holding[] memory h = _holdings();
        h[3].payee = users.eve;
        vm.expectRevert(abi.encodeWithSelector(IExits.IncompleteHoldings.selector, COMMON));
        exits.preview(SALE, h);
    }

    function test_WhenTheHoldingsDoNotCoverEveryClasssSupplyAndEveryLiveOption() external {
        // it should revert with IncompleteHoldings
        _approveSale(address(usdc), PROCEEDS);
        IExits.Holding[] memory full = _holdings();
        IExits.Holding[] memory h = new IExits.Holding[](3);

        (h[0], h[1], h[2]) = (full[0], full[1], full[3]); // no Series A
        vm.expectRevert(abi.encodeWithSelector(IExits.IncompleteHoldings.selector, SERIES_A));
        exits.preview(SALE, h);

        (h[0], h[1], h[2]) = (full[0], full[1], full[2]); // no option grant
        vm.expectRevert(abi.encodeWithSelector(IExits.IncompleteHoldings.selector, COMMON));
        exits.preview(SALE, h);

        h = _holdings();
        h[3].shares = 999; // the grant listed short
        vm.expectRevert(abi.encodeWithSelector(IExits.IncompleteHoldings.selector, COMMON));
        exits.preview(SALE, h);
    }

    function test_WhenTheHoldingsAreComplete() external {
        // it should return one payout per holding from the waterfall
        // it should match the Capxul vectors for both sales to within a dollar
        _approveSale(address(usdc), PROCEEDS);
        IExits.Holding[] memory h = _holdings();
        uint256[] memory expected = _payouts();
        vm.prank(users.eve); // anyone
        IExits.Payout[] memory p = exits.preview(SALE, h);
        assertEq(p.length, 4, "one payout per holding");
        for (uint256 i; i < 4; ++i) {
            assertEq(p[i].payee, h[i].payee, "payee");
            assertEq(p[i].amount, expected[i], "exact payout");
        }

        (IExits ex, IExits.Holding[] memory vh) = _vectorCompany();
        CapxulExitVectors.Row[] memory rows = CapxulExitVectors.rows();
        vm.startPrank(governor);
        ex.approveSale(1, address(usdc), CapxulExitVectors.STRONG, TERMS);
        ex.approveSale(2, address(usdc), CapxulExitVectors.SOFT, TERMS);
        vm.stopPrank();
        for (uint256 s = 1; s <= 2; ++s) {
            p = ex.preview(s, vh);
            uint256 total;
            for (uint256 i; i < rows.length; ++i) {
                uint256 want = s == 1 ? rows[i].strong : rows[i].soft;
                assertApproxEqAbs(p[i].amount, want, 1e6, rows[i].who);
                total += p[i].amount;
            }
            assertEq(total, s == 1 ? CapxulExitVectors.STRONG : CapxulExitVectors.SOFT, "sums exactly (X1)");
        }
    }

    function test_WhenAnOptionGrantHasEnded() external {
        // it should count only the options vested at its end
        // it should revert with IncompleteHoldings for the grant's full size
        // Alice left with 400 of her 1,000 options vested; Options returned the other 600 to the pool.
        options.endGrant(aliceGrant, uint64(block.timestamp), 400);
        _approveSale(address(usdc), PROCEEDS);
        IExits.Holding[] memory h = _holdings();
        vm.expectRevert(abi.encodeWithSelector(IExits.IncompleteHoldings.selector, COMMON));
        exits.preview(SALE, h);

        h[3].shares = 400;
        IExits.Payout[] memory p = exits.preview(SALE, h);
        // Cash $23,700 (400 strikes of $0.50 in) over 11,400 shares as converted; Series A converts.
        assertEq(p[3].amount, 631_578_947, "400 x price less $200 of strikes, rounded down");
        assertEq(p[0].amount, 12_473_684_210, "Amira 6,000 / 11,400 of $23,700");
        assertEq(p[0].amount + p[1].amount + p[2].amount + p[3].amount, PROCEEDS, "sums exactly (X1)");
    }

    function test_WhenAPreferredClassHasAPreferenceMultipleAbove1x() external {
        // it should owe shares times original issue price times the multiple
        // Common: Amira 6,000, Ben 3,000. Series A: the investor's 2,000 at $1 with a 2x preference ($4,000).
        IExits ex = IExits(Clones.clone(address(implementation)));
        MockCaptableForExits cap = new MockCaptableForExits(address(safe), address(ex));
        MockOptionsForExits opt = new MockOptionsForExits(address(cap), address(ex), COMMON);
        MockVestingForExits ves = new MockVestingForExits(address(ex));
        cap.addClass("Common", 0, 0, 0, false, 0);
        cap.addClass("Series A 2x", 1e6, 1e6, 20_000, false, 0);
        ex.initialize(
            address(safe), address(cap), address(opt), address(ves), address(payments), governor, address(factory)
        );
        cap.mintTo(COMMON, users.amira, 6000);
        cap.mintTo(COMMON, users.ben, 3000);
        cap.mintTo(SERIES_A, users.investor, 2000);
        vm.prank(governor);
        ex.approveSale(SALE, address(usdc), 10_000e6, TERMS);

        IExits.Holding[] memory h = new IExits.Holding[](3);
        h[0] = IExits.Holding(users.amira, COMMON, false, 0, 6000);
        h[1] = IExits.Holding(users.ben, COMMON, false, 0, 3000);
        h[2] = IExits.Holding(users.investor, SERIES_A, false, 0, 2000);
        IExits.Payout[] memory p = ex.preview(SALE, h);
        // Converting is worth 2,000 x $0.67 < $4,000, so Series A takes its 2x preference; Common shares the rest.
        assertEq(p[2].amount, 4000e6, "2,000 x $1 x 2");
        assertEq(p[0].amount, 4000e6, "Amira 6,000 / 9,000 of $6,000");
        assertEq(p[1].amount, 2000e6, "Ben 3,000 / 9,000 of $6,000");
    }

    /// @dev Capxul, Inc. at the secondary sale: five classes, eight shareholders, five option grants.
    function _vectorCompany() internal returns (IExits ex, IExits.Holding[] memory h) {
        ex = IExits(Clones.clone(address(implementation)));
        MockCaptableForExits cap = new MockCaptableForExits(address(safe), address(ex));
        MockOptionsForExits opt = new MockOptionsForExits(address(cap), address(ex), 0);
        MockVestingForExits ves = new MockVestingForExits(address(ex));
        cap.addClass("Common", 0, 0, 0, false, 0);
        cap.addClass("Series Seed", 1.1413e6, 1.1413e6, 10_000, false, 0);
        cap.addClass("Series A", 2.5103e6, 2.4745e6, 10_000, false, 0);
        cap.addClass("Series B", 5.9311e6, 5.0079e6, 10_000, false, 0);
        cap.addClass("Series C", 2.3724e6, 2.3724e6, 10_000, false, 0);
        try ex.initialize(
            address(safe), address(cap), address(opt), address(ves), address(payments), governor, address(factory)
        ) { }
            catch { }

        CapxulExitVectors.Row[] memory rows = CapxulExitVectors.rows();
        h = new IExits.Holding[](rows.length);
        for (uint256 i; i < rows.length; ++i) {
            address who = makeAddr(rows[i].who);
            uint256 grantId;
            if (rows[i].option) grantId = opt.addGrant(who, rows[i].shares, 0, rows[i].strike, address(usdc));
            else cap.mintTo(rows[i].classId, who, rows[i].shares);
            h[i] = IExits.Holding(who, rows[i].classId, rows[i].option, grantId, rows[i].shares);
        }
    }
}
