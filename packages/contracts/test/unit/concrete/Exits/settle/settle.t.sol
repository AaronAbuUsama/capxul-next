// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IEscrow } from "../../../../../src/interfaces/IEscrow.sol";
import { IExits } from "../../../../../src/interfaces/IExits.sol";
import { IPayments } from "../../../../../src/interfaces/IPayments.sol";
import { IVesting } from "../../../../../src/interfaces/IVesting.sol";
import { Exits_Test } from "../../../../utils/Exits/Exits_Test.sol";
import { MockCaptableForExits } from "../../../../utils/Exits/ExitsMocks.sol";

/// @dev spec/exits.md `settle` (the Board, in the batch that paid everyone with `Payments.sendBatch`, kind 8);
/// rulings Q15, D5, F5, M5; invariants X1, X2, X3, H4.
contract Settle_Exits_Unit_Concrete_Test is Exits_Test {
    function _settle(uint256[] memory claims) internal {
        vm.prank(address(safe));
        exits.settle(SALE, _holdings(), claims);
    }

    function test_WhenAClaimIndexIsOutsideThePayoutsOrRepeated() external {
        // it should reject the invalid claim index
        _approveSale(address(usdc), PROCEEDS);
        uint256[] memory claims = new uint256[](1);
        claims[0] = 4;
        vm.expectRevert(abi.encodeWithSelector(IExits.NoClaim.selector, SALE, 4));
        _settle(claims);

        claims = new uint256[](2);
        claims[0] = 2;
        claims[1] = 2;
        vm.expectRevert(abi.encodeWithSelector(IExits.NoClaim.selector, SALE, 2));
        _settle(claims);
        assertFalse(exits.sale(SALE).settled, "sale stays open");
    }

    function test_WhenTheCallerIsNotTheSafe() external {
        // it should revert with OnlyBoard
        _approveSale(address(usdc), PROCEEDS);
        _payBatch(address(usdc), _holdings(), _payouts(), _none());
        address[3] memory callers = [users.eve, governor, users.amira];
        for (uint256 i; i < callers.length; ++i) {
            vm.expectRevert(IExits.OnlyBoard.selector);
            vm.prank(callers[i]);
            exits.settle(SALE, _holdings(), _none());
        }
        assertFalse(exits.sale(SALE).settled, "not settled");
    }

    function test_WhenTheSaleWasNotApproved() external {
        // it should revert with SaleNotApproved
        vm.expectRevert(IExits.SaleNotApproved.selector);
        _settle(_none());
    }

    function test_WhenTheSaleWasAlreadySettled() external {
        // it should revert with AlreadySettled
        _settleIn(address(usdc), _none());
        vm.expectRevert(abi.encodeWithSelector(IExits.AlreadySettled.selector, SALE));
        _settle(_none());
    }

    function test_WhenTheHoldingsAreIncomplete() external {
        // it should revert with IncompleteHoldings
        _approveSale(address(usdc), PROCEEDS);
        IExits.Holding[] memory full = _holdings();

        // Ben's Common left out.
        IExits.Holding[] memory h = new IExits.Holding[](3);
        (h[0], h[1], h[2]) = (full[0], full[2], full[3]);
        vm.expectRevert(abi.encodeWithSelector(IExits.IncompleteHoldings.selector, COMMON));
        vm.prank(address(safe));
        exits.settle(SALE, h, _none());

        // Alice's live option grant left out.
        (h[0], h[1], h[2]) = (full[0], full[1], full[2]);
        vm.expectRevert(abi.encodeWithSelector(IExits.IncompleteHoldings.selector, COMMON));
        vm.prank(address(safe));
        exits.settle(SALE, h, _none());

        // The investor listed with more Series A than they hold.
        h = _holdings();
        h[2].shares = 2001;
        vm.expectRevert(abi.encodeWithSelector(IExits.IncompleteHoldings.selector, SERIES_A));
        vm.prank(address(safe));
        exits.settle(SALE, h, _none());

        // Listed twice in place of someone with the same balance, so the totals still match: Eve holds 3,000
        // Common like Ben, and a 1,000-option grant like Alice's.
        captable.mintTo(COMMON, users.eve, 3000);
        uint256 eveGrant = options.addGrant(users.eve, 1000, 0, 0.5e6, address(usdc));
        h = new IExits.Holding[](6);
        (h[0], h[1], h[2], h[3]) = (full[0], full[1], full[2], full[3]);
        h[4] = IExits.Holding(users.eve, COMMON, false, 0, 3000);
        h[5] = IExits.Holding(users.eve, COMMON, true, eveGrant, 1000);
        IExits.Holding memory eveShares = h[4];
        h[4] = full[1]; // Ben twice, Eve's Common left out
        vm.expectRevert(abi.encodeWithSelector(IExits.IncompleteHoldings.selector, COMMON));
        vm.prank(address(safe));
        exits.settle(SALE, h, _none());
        (h[4], h[5]) = (eveShares, full[3]); // Alice's grant twice, Eve's left out
        vm.expectRevert(abi.encodeWithSelector(IExits.IncompleteHoldings.selector, COMMON));
        vm.prank(address(safe));
        exits.settle(SALE, h, _none());
    }

    function test_WhenAPayoutsPaymentWasNotMade() external {
        // it should revert with PaymentMissing
        _approveSale(address(usdc), PROCEEDS);
        IExits.Holding[] memory h = _holdings();
        uint256[] memory p = _payouts();
        uint256 snap = vm.snapshotState();

        // Payout 1 (Ben) not paid at all.
        uint256[] memory short_ = _payouts();
        short_[1] = 0;
        _payBatch(address(usdc), h, short_, _none());
        vm.expectRevert(abi.encodeWithSelector(IExits.PaymentMissing.selector, 1));
        _settle(_none());
        vm.revertToState(snap);

        // Payout 1 paid with the wrong kind, the wrong executor or the wrong document: not the derived item.
        for (uint256 v; v < 3; ++v) {
            _payBatch(address(usdc), h, short_, _none());
            IPayments.PaymentItem memory item = _item(1, users.ben, address(usdc), p[1]);
            if (v == 0) item.kind = 2;
            if (v == 1) item.executor = address(0);
            if (v == 2) item.documentHash = keccak256("other");
            item.paymentId = payments.paymentId(item);
            vm.startPrank(address(safe));
            usdc.approve(address(payments), p[1]);
            payments.send(item);
            vm.stopPrank();
            vm.expectRevert(abi.encodeWithSelector(IExits.PaymentMissing.selector, 1));
            _settle(_none());
            vm.revertToState(snap);
        }

        // Payout 2 paid to the investor although it was listed as a claim: the escrow was not paid.
        _payBatch(address(usdc), h, p, _none());
        vm.expectRevert(abi.encodeWithSelector(IExits.PaymentMissing.selector, 2));
        _settle(_one(2));
    }

    function test_WhenThePayoutsDoNotAddUpToTheProceeds() external {
        // it should revert with ProceedsMismatch
        // A company whose only shares are the Safe's own: nobody is outstanding, so nothing can be paid.
        (IExits ex, MockCaptableForExits cap,,) = _company();
        cap.mintTo(COMMON, address(safe), 1000);
        vm.prank(governor);
        ex.approveSale(SALE, address(usdc), PROCEEDS, TERMS);
        vm.expectRevert(abi.encodeWithSelector(IExits.ProceedsMismatch.selector, 0, PROCEEDS));
        vm.prank(address(safe));
        ex.settle(SALE, new IExits.Holding[](0), _none());
    }

    modifier whenEveryPayoutWasPaid() {
        _;
    }

    function test_WhenEveryPayoutWasPaid() external whenEveryPayoutWasPaid {
        // it should derive each payout's item with kind 8 and the sale's terms hash and the Safe as executor
        // it should accelerate the grants that accelerate on exit
        // it should burn every share of every class
        // it should end every option
        // it should close the Captable so nothing more is issued
        // it should emit Settled
        _approveSale(address(usdc), PROCEEDS);
        _payBatch(address(usdc), _holdings(), _payouts(), _none()); // the items exactly as the spec derives them

        vm.expectCall(address(vesting), abi.encodeCall(IVesting.accelerateForExit, (AMIRA_GRANT)));
        vm.expectEmit(address(exits));
        emit IExits.Settled(SALE);
        _settle(_none());

        assertTrue(vesting.accelerated(AMIRA_GRANT), "Amira's grant accelerated on exit");
        assertEq(captable.tokenOf(COMMON).totalSupply(), 0, "no Common remains (X2)");
        assertEq(captable.tokenOf(SERIES_A).totalSupply(), 0, "no Series A remains (X2)");
        assertTrue(options.endedForExit(), "every option ended");
        assertEq(options.allocated(), 0, "no option remains (X2)");
        assertTrue(captable.closedForExit(), "Captable closed");
        assertTrue(exits.sale(SALE).settled, "settled");
        assertEq(usdc.balanceOf(users.amira), 1_000_000e6 + 12_000e6, "Amira paid by the batch");
        assertEq(usdc.balanceOf(address(exits)), 0, "Exits holds nothing (X3)");
    }

    function test_GivenAPayeeIsInClaimIndexes() external whenEveryPayoutWasPaid {
        // it should require that payout paid to the claim escrow predictClaimEscrow names
        // it should deploy the claim escrow with Exits as owner and the shareholder as payee
        // it should record the claim for the payee
        // it should hold no token itself
        // it should emit ClaimRecorded
        _approveSale(address(usdc), PROCEEDS);
        address escrow = exits.predictClaimEscrow(SALE, 2, users.investor, 4000e6);
        assertEq(escrow.code.length, 0, "not deployed before settle");
        _payBatch(address(usdc), _holdings(), _payouts(), _one(2));
        assertEq(usdc.balanceOf(escrow), 4000e6, "the batch paid the predicted escrow");

        vm.expectEmit(address(exits));
        emit IExits.ClaimRecorded(SALE, 2, users.investor, escrow, address(usdc), 4000e6);
        _settle(_one(2));

        assertGt(escrow.code.length, 0, "escrow deployed");
        IEscrow e = IEscrow(escrow);
        assertEq(e.sender(), address(exits), "Exits sent it, so the Board cannot take it back (F5)");
        assertEq(e.owner(), users.investor, "the shareholder is its owner");
        assertEq(e.authority(), address(0), "no authority: only Exits takes it back");
        assertEq(e.bootstrapOwner(), companiesHouse, "Companies House, read from the factory");
        assertTrue(e.ownerTakesSurplus(), "the surplus goes to the shareholder");
        assertEq(e.token(), address(usdc), "token");
        assertEq(e.amount(), 4000e6, "amount");
        assertEq(e.kind(), EXIT_KIND, "kind 8");
        assertEq(e.documentHash(), TERMS, "the sale's terms");
        assertEq(e.condition(), OWNER_COLLECTS, "owner-collects condition");

        IExits.Claim memory c = exits.claimOf(SALE, 2);
        assertEq(c.payee, users.investor, "claim payee");
        assertEq(c.escrow, escrow, "claim escrow");
        assertEq(c.token, address(usdc), "claim token");
        assertEq(c.amount, 4000e6, "claim amount");
        assertEq(exits.claimOf(SALE, 1).payee, address(0), "Ben was paid directly: no claim");
        assertEq(usdc.balanceOf(address(exits)), 0, "Exits holds nothing (X3)");
        assertEq(usdc.balanceOf(users.investor), 1_000_000e6, "the investor is not paid directly");
    }

    function test_GivenTheSafeHoldsShares() external whenEveryPayoutWasPaid {
        // it should leave them out of the holdings and pay them nothing
        // it should burn them with every other share
        _approveSale(address(usdc), PROCEEDS);
        uint256 safeBefore = usdc.balanceOf(address(safe));

        // Listing the Safe as a holding is refused: its shares are not outstanding (D5).
        IExits.Holding[] memory withSafe = new IExits.Holding[](5);
        IExits.Holding[] memory h = _holdings();
        for (uint256 i; i < 4; ++i) {
            withSafe[i] = h[i];
        }
        withSafe[4] = IExits.Holding(address(safe), COMMON, false, 0, 1000);
        vm.expectRevert(abi.encodeWithSelector(IExits.IncompleteHoldings.selector, COMMON));
        vm.prank(address(safe));
        exits.preview(SALE, withSafe);

        _payBatch(address(usdc), h, _payouts(), _none());
        vm.expectCall(
            address(captable), abi.encodeCall(MockCaptableForExits.burnForExit, (COMMON, address(safe), 1000))
        );
        _settle(_none());

        assertEq(usdc.balanceOf(address(safe)), safeBefore - PROCEEDS, "the Safe kept nothing for itself");
        assertEq(captable.tokenOf(COMMON).balanceOf(address(safe)), 0, "the Safe's own shares burned");
    }

    function test_GivenAGrantCannotAccelerate() external whenEveryPayoutWasPaid {
        // it should still settle
        // Ben's grant does not accelerate on exit: Vesting leaves it alone and the sale settles anyway.
        _settleIn(address(usdc), _none());
        assertFalse(vesting.accelerated(BEN_GRANT), "Ben's grant did not accelerate");
        assertTrue(exits.sale(SALE).settled, "settled");
        assertEq(captable.tokenOf(COMMON).balanceOf(users.ben), 0, "Ben's shares burned");
    }
}
