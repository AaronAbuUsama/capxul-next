// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IPayments } from "../../../src/interfaces/IPayments.sol";
import { MockFeeOnTransferToken } from "../../mocks/MockFeeOnTransferToken.sol";
import { MockRebasingToken } from "../../mocks/MockRebasingToken.sol";
import { MockReentrantERC20 } from "../../mocks/MockReentrantERC20.sol";

/// @notice The honest side of Payments.invariant.t.sol: the Board (company Safe) and the hat wearers
/// (Amira, Jordan) pay the payees (Alice, Bob, the investor) with every kind of token. Every input is
/// bounded so an honest call is valid and must not revert (`fail_on_revert = true`). The odd tokens
/// are expected to refuse; those calls are made with `try` and the refusal is asserted exactly.
contract PaymentsHandler is Test {
    bytes32 internal constant PAYMENT_TYPEHASH = keccak256(
        "CapxulPayment(uint256 chainId,address router,bytes32 jobNonce,address executor,address recipient,address token,uint256 amount,uint16 kind,bytes32 documentHash)"
    );

    IPayments internal immutable payments;
    address[] internal payers;
    address[] internal payees;
    /// @dev Exact tokens: a standard ERC-20 (usdc, dai) and a no-return one (usdt).
    address[] internal exactTokens;
    MockFeeOnTransferToken internal immutable feeToken;
    MockRebasingToken internal immutable rebasingToken;
    address internal immutable falseToken;
    MockReentrantERC20 internal immutable reentrantToken;

    uint256 internal nonce;

    // Ghosts.
    /// @dev P1: what each actor's balance of each exact token must be.
    mapping(address token => mapping(address account => uint256)) public expectedBalance;
    /// @dev P3: every id an honest call consumed.
    bytes32[] public consumed;
    /// @dev P6: every id whose send or batch was refused.
    bytes32[] public refused;
    /// @dev Items an honest send paid (with and without an executor), for Eve to replay.
    IPayments.PaymentItem[] internal sentItems;
    uint256 public reentryAttempts;
    uint256 public reentryRefusals;
    mapping(bytes4 selector => uint256) public calls;

    constructor(
        IPayments payments_,
        address[] memory payers_,
        address[] memory payees_,
        address[] memory exactTokens_,
        MockFeeOnTransferToken feeToken_,
        MockRebasingToken rebasingToken_,
        address falseToken_,
        MockReentrantERC20 reentrantToken_
    ) {
        payments = payments_;
        payers = payers_;
        payees = payees_;
        exactTokens = exactTokens_;
        feeToken = feeToken_;
        rebasingToken = rebasingToken_;
        falseToken = falseToken_;
        reentrantToken = reentrantToken_;
        for (uint256 t; t < exactTokens_.length; ++t) {
            for (uint256 i; i < payers_.length; ++i) {
                expectedBalance[exactTokens_[t]][payers_[i]] = IERC20(exactTokens_[t]).balanceOf(payers_[i]);
            }
            for (uint256 i; i < payees_.length; ++i) {
                expectedBalance[exactTokens_[t]][payees_[i]] = IERC20(exactTokens_[t]).balanceOf(payees_[i]);
            }
        }
    }

    // ------------------------------------------------------------------ handler calls

    /// @dev P1, P3, P5: an honest send of an exact token, to a payee or to the payer itself.
    function send(
        uint256 payerSeed,
        uint256 payeeSeed,
        uint256 tokenSeed,
        uint256 amount,
        uint16 kind,
        bool selfSend,
        bool bindExecutor
    )
        external
    {
        calls[this.send.selector]++;
        address payer = payers[bound(payerSeed, 0, payers.length - 1)];
        address payee = selfSend ? payer : payees[bound(payeeSeed, 0, payees.length - 1)];
        address token = exactTokens[bound(tokenSeed, 0, exactTokens.length - 1)];
        uint256 balance = IERC20(token).balanceOf(payer);
        if (balance == 0) return;
        amount = bound(amount, 1, balance);
        IPayments.PaymentItem memory item =
            _newItem(payee, token, amount, uint16(bound(kind, 0, 8)), bindExecutor ? payer : address(0));

        uint256 payeeBefore = IERC20(token).balanceOf(payee);
        vm.prank(payer);
        payments.send(item);

        assertEq(IERC20(token).balanceOf(payee), payeeBefore + (selfSend ? 0 : amount), "P1: exact amount");
        if (!selfSend) {
            expectedBalance[token][payer] -= amount;
            expectedBalance[token][payee] += amount;
        }
        consumed.push(item.paymentId);
        sentItems.push(item);
    }

    /// @dev P1, P6: an honest batch of 1 to 4 items from one payer; with `poison` a repeated item at the
    /// end makes the whole batch revert and consume nothing.
    function sendBatch(uint256 payerSeed, uint256 payeeSeed, uint256 count, uint256 amount, bool poison) external {
        calls[this.sendBatch.selector]++;
        address payer = payers[bound(payerSeed, 0, payers.length - 1)];
        address token = exactTokens[0];
        count = bound(count, 1, 4);
        uint256 balance = IERC20(token).balanceOf(payer);
        if (balance < count) return;
        amount = bound(amount, 1, balance / count);
        IPayments.PaymentItem[] memory items = new IPayments.PaymentItem[](poison ? count + 1 : count);
        for (uint256 i; i < count; ++i) {
            address payee = payees[(bound(payeeSeed, 0, payees.length - 1) + i) % payees.length];
            items[i] = _newItem(payee, token, amount, 2, address(0));
        }
        if (poison) items[count] = items[0];

        vm.prank(payer);
        if (poison) {
            try payments.sendBatch(items) {
                assertTrue(false, "P6: a batch with a repeated id paid");
            } catch (bytes memory reason) {
                assertEq(reason, abi.encodeWithSelector(IPayments.PaymentIdConsumed.selector, items[0].paymentId), "P6");
            }
            for (uint256 i; i < count; ++i) {
                refused.push(items[i].paymentId);
            }
            return;
        }
        payments.sendBatch(items);
        for (uint256 i; i < count; ++i) {
            expectedBalance[token][payer] -= amount;
            expectedBalance[token][items[i].recipient] += amount;
            consumed.push(items[i].paymentId);
        }
    }

    /// @dev P1, P6: a fee-on-transfer, rebasing or false-returning token. Each send must pay exactly or
    /// revert with the error the token's arithmetic predicts.
    function sendOddToken(uint256 payerSeed, uint256 payeeSeed, uint256 tokenSeed, uint256 amount) external {
        calls[this.sendOddToken.selector]++;
        address payer = payers[bound(payerSeed, 0, payers.length - 1)];
        address payee = payees[bound(payeeSeed, 0, payees.length - 1)];
        uint256 which = bound(tokenSeed, 0, 2);
        address token = which == 0 ? address(feeToken) : which == 1 ? address(rebasingToken) : falseToken;
        uint256 balance = IERC20(token).balanceOf(payer);
        if (balance == 0) return;
        amount = bound(amount, 1, balance);
        IPayments.PaymentItem memory item = _newItem(payee, token, amount, 0, address(0));

        bytes memory expected;
        if (which == 0) {
            uint256 fee = amount * feeToken.feeBps() / 10_000;
            if (fee != 0) {
                expected = abi.encodeWithSelector(IPayments.InexactTransfer.selector, token, amount, amount - fee);
            }
        } else if (which == 1) {
            uint256 received = _rebasingReceived(payee, amount);
            if (received != amount) {
                expected = abi.encodeWithSelector(IPayments.InexactTransfer.selector, token, amount, received);
            }
        } else {
            expected = abi.encodeWithSelector(IPayments.TokenCallReturnedFalse.selector, token);
        }

        uint256 payeeBefore = IERC20(token).balanceOf(payee);
        vm.prank(payer);
        try payments.send(item) {
            assertEq(expected.length, 0, "P1: an inexact transfer paid");
            assertEq(IERC20(token).balanceOf(payee), payeeBefore + amount, "P1: exact amount");
            consumed.push(item.paymentId);
        } catch (bytes memory reason) {
            assertEq(reason, expected, "P1: the refusal names the token's shortfall");
            assertEq(IERC20(token).balanceOf(payee), payeeBefore, "P6: a refused send moves nothing");
            refused.push(item.paymentId);
        }
    }

    /// @dev P8: the token re-enters `send` or `sendBatch` mid-transfer; the inner call is refused and the
    /// outer payment still pays exactly.
    function sendReentrant(uint256 payerSeed, uint256 payeeSeed, uint256 amount, bool batch) external {
        calls[this.sendReentrant.selector]++;
        address payer = payers[bound(payerSeed, 0, payers.length - 1)];
        address payee = payees[bound(payeeSeed, 0, payees.length - 1)];
        uint256 balance = reentrantToken.balanceOf(payer);
        if (balance == 0) return;
        amount = bound(amount, 1, balance);
        IPayments.PaymentItem memory inner = _newItem(payee, exactTokens[0], 1, 0, address(0));
        IPayments.PaymentItem[] memory innerBatch = new IPayments.PaymentItem[](1);
        innerBatch[0] = inner;
        reentrantToken.arm(
            address(payments),
            batch ? abi.encodeCall(IPayments.sendBatch, (innerBatch)) : abi.encodeCall(IPayments.send, (inner))
        );
        IPayments.PaymentItem memory outer = _newItem(payee, address(reentrantToken), amount, 0, address(0));
        uint256 payeeBefore = reentrantToken.balanceOf(payee);

        vm.prank(payer);
        payments.send(outer);

        reentryAttempts++;
        assertTrue(reentrantToken.reentered(), "P8: the token re-entered");
        assertFalse(reentrantToken.reentrySucceeded(), "P8: the inner call paid");
        assertEq(reentrantToken.reentryResult(), abi.encodeWithSelector(IPayments.ReentrantCall.selector), "P8");
        reentryRefusals++;
        assertEq(reentrantToken.balanceOf(payee), payeeBefore + amount, "P1: exact amount");
        consumed.push(outer.paymentId);
        refused.push(inner.paymentId);
    }

    // ------------------------------------------------------------------ views for the suite

    function consumedCount() external view returns (uint256) {
        return consumed.length;
    }

    function refusedCount() external view returns (uint256) {
        return refused.length;
    }

    function sentItemCount() external view returns (uint256) {
        return sentItems.length;
    }

    function sentItem(uint256 index) external view returns (IPayments.PaymentItem memory) {
        return sentItems[index];
    }

    function exactTokenList() external view returns (address[] memory) {
        return exactTokens;
    }

    function actors() external view returns (address[] memory all) {
        all = new address[](payers.length + payees.length);
        for (uint256 i; i < payers.length; ++i) {
            all[i] = payers[i];
        }
        for (uint256 i; i < payees.length; ++i) {
            all[payers.length + i] = payees[i];
        }
    }

    // ------------------------------------------------------------------ helpers

    function _newItem(
        address recipient,
        address token,
        uint256 amount,
        uint16 kind,
        address executor
    )
        internal
        returns (IPayments.PaymentItem memory item)
    {
        item = IPayments.PaymentItem({
            paymentId: bytes32(0),
            recipient: recipient,
            token: token,
            amount: amount,
            kind: kind,
            documentHash: keccak256(abi.encode("document", nonce)),
            jobNonce: keccak256(abi.encode("job", ++nonce)),
            executor: executor
        });
        item.paymentId = keccak256(
            abi.encode(
                PAYMENT_TYPEHASH,
                block.chainid,
                address(payments),
                item.jobNonce,
                item.executor,
                item.recipient,
                item.token,
                item.amount,
                item.kind,
                item.documentHash
            )
        );
    }

    function _rebasingReceived(address to, uint256 amount) internal view returns (uint256) {
        uint256 index = rebasingToken.index();
        uint256 shares = rebasingToken.sharesOf(to);
        return (shares + amount * 1e18 / index) * index / 1e18 - shares * index / 1e18;
    }
}
