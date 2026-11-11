// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";

import { Exits } from "../../src/equity/Exits.sol";
import { IExits } from "../../src/interfaces/IExits.sol";
import { IPayments } from "../../src/interfaces/IPayments.sol";

import { EscrowFactory } from "../../src/money/EscrowFactory.sol";
import { Payments } from "../../src/money/Payments.sol";
import { MockCaptableForExits, MockOptionsForExits, MockVestingForExits } from "../utils/Exits/ExitsMocks.sol";
import { Fork_Test } from "./Fork_Test.t.sol";
import { Addresses } from "./Addresses.sol";

/// @dev Circle's FiatToken v2.2 as far as the test needs it.
interface IFiatToken {
    function blacklister() external view returns (address);
    function blacklist(address account) external;
    function isBlacklisted(address account) external view returns (bool);
}

/// @notice Invariant X4 on the fork ("Fork (blacklisting token)", ruling F5, Coinspect FRM-11): real USDC on
/// Base Sepolia blacklists a shareholder. Paying them in the Board's batch reverts the whole batch, through the
/// real company Safe behind the Hats Signer Gate; listing their payout in `claimIndexes` pays their claim
/// escrow instead, the batch settles, and the shareholder claims to an address the token accepts.
contract Exits_Fork_Test is Fork_Test {
    /// @dev Circle's USDC on Base Sepolia (https://developers.circle.com/stablecoins/usdc-contract-addresses).
    address internal constant USDC_BASE_SEPOLIA = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    uint256 internal constant SALE = 1;
    bytes32 internal constant TERMS = keccak256("share purchase agreement");
    uint256 internal constant PROCEEDS = 10_000e6;

    IERC20 internal realUsdc = IERC20(USDC_BASE_SEPOLIA);
    Payments internal payments;
    EscrowFactory internal factory;
    MockCaptableForExits internal captable;
    IExits internal exits;
    address internal governor;
    address internal blocked;
    address internal fresh;

    function _deployProtocol() internal override {
        governor = makeAddr("company governor");
        blocked = makeAddr("blacklisted shareholder");
        fresh = makeAddr("shareholder's new address");
        payments = new Payments();
        factory = new EscrowFactory(address(payments), makeAddr("companies house"));
        exits = IExits(Clones.clone(address(new Exits())));
        captable = new MockCaptableForExits(address(companySafe), address(exits));
        MockOptionsForExits options = new MockOptionsForExits(address(captable), address(exits), 0);
        MockVestingForExits vesting = new MockVestingForExits(address(exits));
        captable.addClass("Common", 0, 0, 0, false, 0);
        captable.mintTo(0, users.alice, 6000);
        captable.mintTo(0, blocked, 4000);
        try exits.initialize(
            address(companySafe),
            address(captable),
            address(options),
            address(vesting),
            address(payments),
            governor,
            address(factory)
        ) { }
            catch { }

        deal(USDC_BASE_SEPOLIA, address(companySafe), PROCEEDS);
        IFiatToken fiat = IFiatToken(USDC_BASE_SEPOLIA);
        vm.prank(fiat.blacklister());
        fiat.blacklist(blocked);
    }

    function _holdings() internal view returns (IExits.Holding[] memory h) {
        h = new IExits.Holding[](2);
        h[0] = IExits.Holding(users.alice, 0, false, 0, 6000);
        h[1] = IExits.Holding(blocked, 0, false, 0, 4000);
    }

    function _item(uint256 i, address to, uint256 amount) internal view returns (IPayments.PaymentItem memory it) {
        it = IPayments.PaymentItem({
            paymentId: bytes32(0),
            recipient: to,
            token: USDC_BASE_SEPOLIA,
            amount: amount,
            kind: 8,
            documentHash: TERMS,
            jobNonce: keccak256(abi.encode(address(exits), SALE, i)),
            executor: address(companySafe)
        });
        it.paymentId = payments.paymentId(it);
    }

    /// @dev The Board's exit batch: approve Payments, pay both payouts, settle.
    function _batch(address secondRecipient, uint256[] memory claims) internal view returns (Call[] memory calls) {
        IPayments.PaymentItem[] memory items = new IPayments.PaymentItem[](2);
        items[0] = _item(0, users.alice, 6000e6);
        items[1] = _item(1, secondRecipient, 4000e6);
        calls = new Call[](3);
        calls[0] = Call(USDC_BASE_SEPOLIA, 0, abi.encodeCall(IERC20.approve, (address(payments), PROCEEDS)));
        calls[1] = Call(address(payments), 0, abi.encodeCall(IPayments.sendBatch, (items)));
        calls[2] = Call(address(exits), 0, abi.encodeCall(IExits.settle, (SALE, _holdings(), claims)));
    }

    function test_X4_ABlacklistedShareholderDoesNotBlockTheExit() external {
        assertTrue(IFiatToken(USDC_BASE_SEPOLIA).isBlacklisted(blocked), "real USDC blacklists the shareholder");
        vm.prank(governor);
        exits.approveSale(SALE, USDC_BASE_SEPOLIA, PROCEEDS, TERMS);
        IExits.Payout[] memory p = exits.preview(SALE, _holdings());
        assertEq(p[0].amount, 6000e6, "Alice's payout");
        assertEq(p[1].amount, 4000e6, "the blacklisted shareholder's payout");

        // FRM-11: paying them directly reverts the whole batch. MultiSendCallOnly reverts with no data, which
        // Safe 1.5 passes through (1.4.1 said GS013).
        bytes memory data = _multiSend(_batch(blocked, new uint256[](0)));
        bytes memory sig = _boardApprove(Addresses.MULTI_SEND_CALL_ONLY_141, 0, data, DELEGATECALL);
        vm.expectRevert(bytes(""));
        companySafe.execTransaction(
            Addresses.MULTI_SEND_CALL_ONLY_141, 0, data, DELEGATECALL, 0, 0, 0, address(0), payable(address(0)), sig
        );
        assertEq(realUsdc.balanceOf(users.alice), 0, "nobody was paid");

        // Their payout goes to a claim escrow instead, and the exit settles for everyone.
        uint256[] memory claims = new uint256[](1);
        claims[0] = 1;
        address escrow = exits.predictClaimEscrow(SALE, 1, blocked, 4000e6);
        _boardBatch(_batch(escrow, claims));
        assertEq(realUsdc.balanceOf(users.alice), 6000e6, "Alice paid in the batch");
        assertEq(realUsdc.balanceOf(escrow), 4000e6, "the claim waits in its escrow");
        assertTrue(exits.sale(SALE).settled, "settled");
        assertEq(captable.tokenOf(0).totalSupply(), 0, "every share burned (X2)");
        assertEq(realUsdc.balanceOf(address(exits)), 0, "Exits holds nothing (X3)");

        // The shareholder claims to an address the token accepts.
        vm.prank(blocked);
        exits.claim(SALE, 1, fresh);
        assertEq(realUsdc.balanceOf(fresh), 4000e6, "paid to the named address");
        assertEq(realUsdc.balanceOf(escrow), 0, "escrow emptied");
        assertEq(realUsdc.balanceOf(address(exits)), 0, "Exits holds nothing (X3)");
    }
}
