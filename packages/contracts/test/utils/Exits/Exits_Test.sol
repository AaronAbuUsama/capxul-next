// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import { Vm } from "forge-std/Vm.sol";

import { Exits } from "../../../src/equity/Exits.sol";
import { IExits } from "../../../src/interfaces/IExits.sol";
import { IPayments } from "../../../src/interfaces/IPayments.sol";

import { Base_Test } from "../../Base.t.sol";
import { EscrowFactory } from "../../../src/money/EscrowFactory.sol";
import { Payments } from "../../../src/money/Payments.sol";
import { MockBlacklistToken, MockCaptableForExits, MockOptionsForExits, MockVestingForExits } from "./ExitsMocks.sol";

/// @notice The Exits test company (docs/planning/protocol-v4/plans/Exits.md):
/// - Common (class 0): Amira 6,000, Ben 3,000, and 1,000 held by the company Safe (D5: left out, burned).
/// - Series A (class 1): the investor's 2,000 at $1, 1x non-participating, seniority 0.
/// - Options on Common: Alice's grant of 1,000 at a $0.50 strike.
/// At $23,500 every option is exercised, Series A converts and Common is worth exactly $2.00 a share:
/// Amira $12,000, Ben $6,000, the investor $4,000, Alice 1,000 x ($2.00 - $0.50) = $1,500.
/// Exits is a clone of the implementation. Payments and EscrowFactory are real; other neighbours are mocks.
abstract contract Exits_Test is Base_Test {
    uint256 internal constant SALE = 1;
    bytes32 internal constant TERMS = keccak256("share purchase agreement");
    bytes32 internal constant DOC = keccak256("secondary sale agreement");
    uint256 internal constant PROCEEDS = 23_500e6;
    uint8 internal constant COMMON = 0;
    uint8 internal constant SERIES_A = 1;
    uint16 internal constant EXIT_KIND = 8;
    uint16 internal constant SHARE_PURCHASE_KIND = 5;
    uint256 internal constant AMIRA_GRANT = 7;
    uint256 internal constant BEN_GRANT = 8;
    uint8 internal constant PAYEE_CLAIMED = 1;

    Exits internal implementation;
    IExits internal exits;
    Payments internal payments;
    EscrowFactory internal factory;
    MockCaptableForExits internal captable;
    MockOptionsForExits internal options;
    MockVestingForExits internal vesting;
    MockBlacklistToken internal blacklistToken;
    address internal governor;
    address internal companiesHouse;
    uint256 internal aliceGrant;

    function _deployProtocol() internal virtual override {
        governor = makeAddr("company governor");
        companiesHouse = makeAddr("companies house");
        payments = new Payments();
        factory = new EscrowFactory(address(payments), companiesHouse);
        implementation = new Exits();
        blacklistToken = new MockBlacklistToken();
        (exits, captable, options, vesting) = _company();

        captable.mintTo(COMMON, users.amira, 6000);
        captable.mintTo(COMMON, users.ben, 3000);
        captable.mintTo(COMMON, address(safe), 1000);
        captable.mintTo(SERIES_A, users.investor, 2000);
        aliceGrant = options.addGrant(users.alice, 1000, 0, 0.5e6, address(usdc));
        vesting.setGrant(address(captable), COMMON, users.amira, AMIRA_GRANT, true);
        vesting.setGrant(address(captable), COMMON, users.ben, BEN_GRANT, false);

        for (uint256 i; i < 3; ++i) {
            address token = i == 0 ? address(blacklistToken) : i == 1 ? address(reentrantToken) : address(usdc);
            MockBlacklistToken(token).mint(address(safe), 1_000_000e6);
        }
        vm.label(address(exits), "Exits");
        vm.label(address(captable), "Captable");
        vm.label(address(options), "Options");
        vm.label(address(vesting), "Vesting");
        vm.label(address(payments), "Payments");
        vm.label(governor, "Governor");
    }

    /// @dev A fresh company: a new Exits clone wired to new stand-ins, with Common and Series A. The clone's
    /// `initialize` is tried: on the stub it reverts, and every test then fails on its first Exits call.
    function _company()
        internal
        returns (IExits ex, MockCaptableForExits cap, MockOptionsForExits opt, MockVestingForExits ves)
    {
        ex = IExits(Clones.clone(address(implementation)));
        cap = new MockCaptableForExits(address(safe), address(ex));
        opt = new MockOptionsForExits(address(cap), address(ex), COMMON);
        ves = new MockVestingForExits(address(ex));
        cap.addClass("Common", 0, 0, 0, false, 0);
        cap.addClass("Series A", 1e6, 1e6, 10_000, false, 0);
        try ex.initialize(
            address(safe), address(cap), address(opt), address(ves), address(payments), governor, address(factory)
        ) { }
            catch { }
    }

    // ---------------------------------------------------------------- the sale

    function _holdings() internal view returns (IExits.Holding[] memory h) {
        h = new IExits.Holding[](4);
        h[0] = IExits.Holding(users.amira, COMMON, false, 0, 6000);
        h[1] = IExits.Holding(users.ben, COMMON, false, 0, 3000);
        h[2] = IExits.Holding(users.investor, SERIES_A, false, 0, 2000);
        h[3] = IExits.Holding(users.alice, COMMON, true, aliceGrant, 1000);
    }

    function _payouts() internal pure returns (uint256[] memory p) {
        p = new uint256[](4);
        p[0] = 12_000e6;
        p[1] = 6000e6;
        p[2] = 4000e6;
        p[3] = 1500e6;
    }

    function _approveSale(address token, uint256 proceeds) internal {
        vm.prank(governor);
        exits.approveSale(SALE, token, proceeds, TERMS);
    }

    function _jobNonce(uint256 i) internal view returns (bytes32) {
        return keccak256(abi.encode(address(exits), SALE, i));
    }

    /// @dev Payout `i`'s Payments item, exactly as spec/exits.md derives it.
    function _item(
        uint256 i,
        address recipient,
        address token,
        uint256 amount
    )
        internal
        view
        returns (IPayments.PaymentItem memory item)
    {
        item = IPayments.PaymentItem({
            paymentId: bytes32(0),
            recipient: recipient,
            token: token,
            amount: amount,
            kind: EXIT_KIND,
            documentHash: TERMS,
            jobNonce: _jobNonce(i),
            executor: address(safe)
        });
        item.paymentId = payments.paymentId(item);
    }

    /// @dev Where the Board's batch pays payout `i`: the payee, or its claim escrow.
    function _recipient(
        uint256 i,
        address payee,
        uint256 amount,
        uint256[] memory claims
    )
        internal
        view
        returns (address)
    {
        return _contains(claims, i) ? exits.predictClaimEscrow(SALE, i, payee, amount) : payee;
    }

    /// @dev The Board's batch: every nonzero payout through `Payments.sendBatch`, kind 8, as the Safe.
    function _payBatch(
        address token,
        IExits.Holding[] memory h,
        uint256[] memory amounts,
        uint256[] memory claims
    )
        internal
    {
        uint256 n;
        for (uint256 i; i < amounts.length; ++i) {
            if (amounts[i] != 0) ++n;
        }
        IPayments.PaymentItem[] memory items = new IPayments.PaymentItem[](n);
        uint256 total;
        n = 0;
        for (uint256 i; i < amounts.length; ++i) {
            if (amounts[i] == 0) continue;
            items[n++] = _item(i, _recipient(i, h[i].payee, amounts[i], claims), token, amounts[i]);
            total += amounts[i];
        }
        vm.startPrank(address(safe));
        IERC20(token).approve(address(payments), total);
        payments.sendBatch(items);
        vm.stopPrank();
    }

    /// @dev Approve, pay and settle the test sale in `token`, with `claims` paid into claim escrows.
    function _settleIn(address token, uint256[] memory claims) internal {
        _approveSale(token, PROCEEDS);
        _payBatch(token, _holdings(), _payouts(), claims);
        vm.prank(address(safe));
        exits.settle(SALE, _holdings(), claims);
    }

    /// @dev The usual claim fixture: the investor's $4,000 (payout 2) waits in its claim escrow.
    function _settleWithInvestorClaim(address token) internal returns (address escrow) {
        _settleIn(token, _one(2));
        escrow = exits.claimOf(SALE, 2).escrow;
    }

    // ---------------------------------------------------------------- small helpers

    function _none() internal pure returns (uint256[] memory a) {
        a = new uint256[](0);
    }

    function _one(uint256 x) internal pure returns (uint256[] memory a) {
        a = new uint256[](1);
        a[0] = x;
    }

    function _contains(uint256[] memory a, uint256 x) internal pure returns (bool) {
        for (uint256 i; i < a.length; ++i) {
            if (a[i] == x) return true;
        }
        return false;
    }

    /// @dev The last log `emitter` emitted with event signature `topic0`, from `vm.recordLogs()` on.
    function _lastLog(address emitter, bytes32 topic0) internal returns (Vm.Log memory) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = logs.length; i > 0; --i) {
            if (logs[i - 1].emitter == emitter && logs[i - 1].topics[0] == topic0) return logs[i - 1];
        }
        revert("log not emitted");
    }

    function _markClaimed(address payee) internal {
        vm.etch(payee, hex"00");
        vm.mockCall(payee, abi.encodeWithSignature("isOwner(address)", companiesHouse), abi.encode(false));
    }
}
