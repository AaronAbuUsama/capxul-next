// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import { Base_Test } from "../../../../Base.t.sol";
import { MockCaptableGovernor } from "../../../../utils/Captable/CaptableMocks.sol";
import { Captable } from "../../../../../src/equity/Captable.sol";
import { Exits } from "../../../../../src/equity/Exits.sol";
import { Options } from "../../../../../src/equity/Options.sol";
import { ShareClass } from "../../../../../src/equity/ShareClass.sol";
import { Vesting } from "../../../../../src/equity/Vesting.sol";
import { EscrowFactory } from "../../../../../src/money/EscrowFactory.sol";
import { Payments } from "../../../../../src/money/Payments.sol";
import { ICaptable } from "../../../../../src/interfaces/ICaptable.sol";
import { IExits } from "../../../../../src/interfaces/IExits.sol";
import { IPayments } from "../../../../../src/interfaces/IPayments.sol";

/// @notice Checks an exit with real share, option and vesting state, including locked shares.
contract Exits_Integration_Test is Base_Test {
    bytes32 internal constant TERMS = keccak256("sale terms");
    Captable internal captable;
    Exits internal exits;
    Options internal options;
    Vesting internal vesting;
    Payments internal payments;
    MockCaptableGovernor internal governor;
    uint256 internal optionId;
    uint256 internal acceleratedId;
    uint256 internal lockedId;

    function _deployProtocol() internal override {
        governor = new MockCaptableGovernor();
        payments = new Payments();
        vesting = new Vesting();
        captable = Captable(Clones.clone(address(new Captable())));
        exits = Exits(Clones.clone(address(new Exits())));
        options = Options(Clones.clone(address(new Options())));
        EscrowFactory factory = new EscrowFactory(address(payments), makeAddr("companies house"));
        ICaptable.ClassParams[] memory classes = new ICaptable.ClassParams[](1);
        classes[0] = ICaptable.ClassParams({
            name: "Common",
            ticker: "C",
            weight: 1,
            convertsInto: type(uint8).max,
            rule: ICaptable.TransferRule.DenyAll,
            customRule: address(0),
            authorised: 10_000,
            originalIssuePrice: 0,
            conversionFloorPrice: 0,
            preferenceMultipleBps: 0,
            participating: false,
            seniority: 0,
            termsHash: TERMS
        });
        captable.initialize(
            "Company",
            ICaptable.Wiring({
                safe: address(safe),
                governor: address(governor),
                vesting: address(vesting),
                options: address(options),
                rounds: makeAddr("rounds"),
                exits: address(exits),
                shareClassImpl: address(new ShareClass())
            }),
            classes
        );
        options.initialize(address(safe), address(captable), address(payments), 0);
        exits.initialize(
            address(safe),
            address(captable),
            address(options),
            address(vesting),
            address(payments),
            address(governor),
            address(factory)
        );
        uint64 start = uint64(block.timestamp);
        vm.startPrank(address(safe));
        captable.setIssuerAllowance(address(vesting), 0, 200);
        acceleratedId =
            vesting.grantAndIssue(address(captable), 0, users.amira, 100, start, start, start + 365 days, true, TERMS);
        lockedId =
            vesting.grantAndIssue(address(captable), 0, users.ben, 100, start, start, start + 365 days, false, TERMS);
        options.setPool(100);
        optionId = options.grant(
            users.alice,
            100,
            address(usdc),
            1e6,
            start,
            start,
            start + 365 days,
            start + 30 days,
            start + 730 days,
            90,
            TERMS
        );
        vm.stopPrank();
        vm.prank(users.alice);
        options.accept(optionId, TERMS);
    }

    function test_SettlementBurnsLockedSharesAndEndsRealOptions() external {
        assertGt(vesting.lockedOf(address(captable), 0, users.ben, uint64(block.timestamp)), 0);
        IExits.Holding[] memory holdings = new IExits.Holding[](3);
        holdings[0] = IExits.Holding(users.amira, 0, false, 0, 100);
        holdings[1] = IExits.Holding(users.ben, 0, false, 0, 100);
        holdings[2] = IExits.Holding(users.alice, 0, true, optionId, 100);
        vm.prank(address(governor));
        exits.approveSale(1, address(usdc), 600e6, TERMS);
        IExits.Payout[] memory payouts = exits.preview(1, holdings);
        IPayments.PaymentItem[] memory items = new IPayments.PaymentItem[](payouts.length);
        for (uint256 i; i < payouts.length; ++i) {
            items[i] = IPayments.PaymentItem({
                paymentId: bytes32(0),
                recipient: payouts[i].payee,
                token: address(usdc),
                amount: payouts[i].amount,
                kind: 8,
                documentHash: TERMS,
                jobNonce: keccak256(abi.encode(address(exits), uint256(1), i)),
                executor: address(safe)
            });
            items[i].paymentId = payments.paymentId(items[i]);
        }
        vm.startPrank(address(safe));
        usdc.approve(address(payments), 600e6);
        payments.sendBatch(items);
        exits.settle(1, holdings, new uint256[](0));
        vm.stopPrank();
        assertEq(captable.getClass(0).token.totalSupply(), 0);
        assertTrue(captable.closedForExit());
        assertEq(options.allocated(), 0);
        assertTrue(options.getGrant(optionId).cancelled);
        assertEq(vesting.lockedOf(address(captable), 0, users.amira, uint64(block.timestamp)), 0);
        assertGt(vesting.lockedOf(address(captable), 0, users.ben, uint64(block.timestamp)), 0);
        assertEq(vesting.grantOf(address(captable), 0, users.amira), acceleratedId);
        assertEq(vesting.grantOf(address(captable), 0, users.ben), lockedId);
    }

    function test_PreviewUsesRealEndedOptionGrant() external {
        vm.warp(block.timestamp + 180 days);
        vm.prank(address(safe));
        options.end(optionId, uint64(block.timestamp));
        uint128 vested = options.vestedOf(optionId, uint64(block.timestamp));
        assertGt(vested, 0);
        assertEq(options.allocated(), vested);
        IExits.Holding[] memory holdings = new IExits.Holding[](3);
        holdings[0] = IExits.Holding(users.amira, 0, false, 0, 100);
        holdings[1] = IExits.Holding(users.ben, 0, false, 0, 100);
        holdings[2] = IExits.Holding(users.alice, 0, true, optionId, vested);
        vm.prank(address(governor));
        exits.approveSale(1, address(usdc), 600e6, TERMS);
        IExits.Payout[] memory payouts = exits.preview(1, holdings);
        assertEq(payouts.length, 3);
        assertEq(payouts[0].amount + payouts[1].amount + payouts[2].amount, 600e6);
    }
}
