// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Vm } from "forge-std/Vm.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { CapxulPaymentsV3 } from "@beta/CapxulPaymentsV3.sol";
import { IPayments } from "../../../../src/interfaces/IPayments.sol";
import { Payments_Test } from "../../../utils/Payments/Payments_Test.sol";

/// @notice Differential fuzz (plan D9): v4 Payments against beta CapxulPaymentsV3 on the same items from
/// the same sender and the same token state. Ids, outcomes, revert data, balances, consumed flags and
/// events must match, except (a) the renamed errors, mapped below, and (b) a recipient equal to the router,
/// which beta pays into the router and v4 refuses with `InvalidRecipient` (D9).
contract Differential_Payments_Unit_Fuzz_Test is Payments_Test {
    CapxulPaymentsV3 internal beta;
    /// @dev Read once: the lint forbids reading `block.chainid` across `vm.revertToState`.
    uint256 private _chainId;

    struct Outcome {
        bool ok;
        bytes data;
        uint256 payerBalance;
        uint256 recipientBalance;
        uint256 routerBalance;
        bool paid0;
        bool paid1;
        bytes32 logs;
    }

    function _deployProtocol() internal override {
        super._deployProtocol();
        beta = new CapxulPaymentsV3();
        _chainId = block.chainid;
        address[5] memory tokens = [address(usdc), address(dai), address(usdt), address(falseToken), address(feeToken)];
        vm.startPrank(users.amira);
        for (uint256 i; i < tokens.length; ++i) {
            IERC20(tokens[i]).approve(address(beta), type(uint256).max);
        }
        vm.stopPrank();
    }

    function testFuzz_differential_sendAndSendBatch(
        uint256 amount,
        uint16 kind,
        bytes32 documentHash,
        bytes32 jobNonce,
        uint8 recipientSel,
        uint8 tokenSel,
        uint8 executorSel,
        uint8 idMode,
        bool batch,
        bool duplicate
    )
        external
    {
        amount =
            amount % 16 == 0 ? (amount % 32 == 0 ? type(uint256).max : 0) : bound(amount, 1, 2 * 1_000_000 * USDC_UNIT);
        address token = _token(tokenSel);
        IPayments.PaymentItem memory item = IPayments.PaymentItem({
            paymentId: bytes32(0),
            recipient: _recipient(recipientSel, address(payments)),
            token: token,
            amount: amount,
            kind: kind,
            documentHash: documentHash,
            jobNonce: jobNonce,
            executor: executorSel % 3 == 0 ? address(0) : executorSel % 3 == 1 ? users.amira : users.eve
        });
        bool toRouter = recipientSel % 5 == 4;

        // Same ids: each contract reports the spec formula for its own address and the chain.
        IPayments.PaymentItem memory betaItem = _copy(item);
        betaItem.recipient = _recipient(recipientSel, address(beta));
        assertEq(payments.paymentId(_withId(item, 0)), _idAt(item, _chainId, address(payments)), "v4 id");
        assertEq(beta.paymentId(_toBeta(betaItem)), _idAt(betaItem, _chainId, address(beta)), "beta id");

        IPayments.PaymentItem[] memory v4Items = _items(item, address(payments), idMode, batch, duplicate);
        IPayments.PaymentItem[] memory betaItems = _items(betaItem, address(beta), idMode, batch, duplicate);

        uint256 snap = vm.snapshotState();
        Outcome memory a = _runV4(v4Items, batch);
        vm.revertToState(snap);
        if (toRouter) {
            // D9: v4 refuses what beta would strand. ZeroAddress still comes first.
            assertFalse(a.ok, "router recipient refused");
            bytes4 want = token == address(0) ? IPayments.ZeroAddress.selector : IPayments.InvalidRecipient.selector;
            assertEq(bytes4(a.data), want, "router recipient error");
            return;
        }
        Outcome memory b = _runBeta(betaItems, batch);

        assertEq(a.ok, b.ok, "same success");
        assertEq(a.data, b.data, "same revert data");
        assertEq(a.payerBalance, b.payerBalance, "payer balance");
        assertEq(a.recipientBalance, b.recipientBalance, "recipient balance");
        assertEq(a.routerBalance, b.routerBalance, "router balance");
        assertEq(a.paid0, b.paid0, "paid first");
        assertEq(a.paid1, b.paid1, "paid second");
        assertEq(a.logs, b.logs, "same events");
    }

    /// @dev The same comparison with beta's runtime code at Payments' own address (same storage layout:
    /// the consumed mapping in slot 0, the lock in slot 1), so the two compute literally the same ids:
    /// `paymentId` is compared directly, events include the id topic and revert data is compared whole
    /// (only the two renamed selectors are mapped). A recipient equal to the router is the one divergence.
    function testFuzz_differential_sameAddress(
        uint256 amount,
        uint16 kind,
        bytes32 documentHash,
        bytes32 jobNonce,
        uint8 recipientSel,
        uint8 tokenSel,
        uint8 executorSel,
        uint8 idMode,
        bool batch,
        bool duplicate
    )
        external
    {
        amount =
            amount % 16 == 0 ? (amount % 32 == 0 ? type(uint256).max : 0) : bound(amount, 1, 2 * 1_000_000 * USDC_UNIT);
        address router = address(payments);
        IPayments.PaymentItem memory item = IPayments.PaymentItem({
            paymentId: bytes32(0),
            recipient: _recipient(recipientSel, router),
            token: _token(tokenSel),
            amount: amount,
            kind: kind,
            documentHash: documentHash,
            jobNonce: jobNonce,
            executor: executorSel % 3 == 0 ? address(0) : executorSel % 3 == 1 ? users.amira : users.eve
        });
        IPayments.PaymentItem[] memory items = _items(item, router, idMode, batch, duplicate);
        bytes32 v4Id = payments.paymentId(items[0]);

        uint256 snap = vm.snapshotState();
        Outcome memory a = _runAt(router, items, batch, false);
        vm.revertToState(snap);
        vm.etch(router, address(beta).code);
        assertEq(CapxulPaymentsV3(router).paymentId(_toBeta(items[0])), v4Id, "same id at the same address");
        Outcome memory b = _runAt(router, items, batch, true);

        if (recipientSel % 5 == 4) {
            // D9: v4 refuses; beta, at the same address, would pay the router itself if the rest is valid.
            assertFalse(a.ok, "router recipient refused");
            bytes4 want =
                item.token == address(0) ? IPayments.ZeroAddress.selector : IPayments.InvalidRecipient.selector;
            assertEq(bytes4(a.data), want, "router recipient error");
            assertFalse(a.paid0, "v4 consumed nothing");
            if (b.ok) assertGt(b.routerBalance, a.routerBalance, "beta strands the money in the router");
            return;
        }
        assertEq(a.ok, b.ok, "same success");
        assertEq(a.data, b.data, "same revert data");
        assertEq(a.payerBalance, b.payerBalance, "payer balance");
        assertEq(a.recipientBalance, b.recipientBalance, "recipient balance");
        assertEq(a.routerBalance, b.routerBalance, "router balance");
        assertEq(a.paid0, b.paid0, "paid first");
        assertEq(a.paid1, b.paid1, "paid second");
        assertEq(a.logs, b.logs, "same events, ids included");
    }

    function _runAt(
        address router,
        IPayments.PaymentItem[] memory items,
        bool batch,
        bool isBeta
    )
        private
        returns (Outcome memory)
    {
        bytes memory call;
        if (isBeta) {
            CapxulPaymentsV3.PaymentItem[] memory b = new CapxulPaymentsV3.PaymentItem[](items.length);
            for (uint256 i; i < items.length; ++i) {
                b[i] = _toBeta(items[i]);
            }
            call =
                batch ? abi.encodeCall(CapxulPaymentsV3.sendBatch, (b)) : abi.encodeCall(CapxulPaymentsV3.send, (b[0]));
        } else {
            call = batch ? abi.encodeCall(IPayments.sendBatch, (items)) : abi.encodeCall(IPayments.send, (items[0]));
        }
        return _run(router, call, items, isBeta, true);
    }

    function _runV4(IPayments.PaymentItem[] memory items, bool batch) private returns (Outcome memory o) {
        bytes memory call =
            batch ? abi.encodeCall(payments.sendBatch, (items)) : abi.encodeCall(payments.send, (items[0]));
        return _run(address(payments), call, items, false, false);
    }

    function _runBeta(IPayments.PaymentItem[] memory items, bool batch) private returns (Outcome memory o) {
        CapxulPaymentsV3.PaymentItem[] memory b = new CapxulPaymentsV3.PaymentItem[](items.length);
        for (uint256 i; i < items.length; ++i) {
            b[i] = _toBeta(items[i]);
        }
        bytes memory call = batch ? abi.encodeCall(beta.sendBatch, (b)) : abi.encodeCall(beta.send, (b[0]));
        return _run(address(beta), call, items, true, false);
    }

    function _run(
        address target,
        bytes memory call,
        IPayments.PaymentItem[] memory items,
        bool isBeta,
        bool sameAddress
    )
        private
        returns (Outcome memory o)
    {
        vm.recordLogs();
        vm.prank(users.amira);
        (o.ok, o.data) = target.call(call);
        o.data = _normalise(o.data, target, items, isBeta, !sameAddress);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != target) continue;
            // topic 1 is the id: it differs by router, so it is compared only at the same address.
            bytes32 idTopic = sameAddress ? logs[i].topics[1] : bytes32(0);
            o.logs = keccak256(
                abi.encode(o.logs, logs[i].topics[0], idTopic, logs[i].topics[2], logs[i].topics[3], logs[i].data)
            );
        }
        address token = items[0].token;
        o.payerBalance = _balance(token, users.amira);
        o.recipientBalance = _balance(token, items[0].recipient);
        o.routerBalance = _balance(token, target);
        o.paid0 = _paid(target, items[0].paymentId, items[0], isBeta);
        o.paid1 = items.length > 1 && _paid(target, items[1].paymentId, items[1], isBeta);
    }

    /// @dev The ids supplied in the items may be wrong or zero; read `paid` of the correct id instead.
    function _paid(address target, bytes32, IPayments.PaymentItem memory item, bool isBeta)
        private
        view
        returns (bool)
    {
        bytes32 id = _idAt(item, _chainId, target);
        return isBeta ? CapxulPaymentsV3(target).settled(id) : IPayments(target).paid(id);
    }

    function _balance(address token, address who) private view returns (uint256) {
        return token.code.length == 0 ? 0 : IERC20(token).balanceOf(who);
    }

    /// @dev Beta's `ZeroSettlementId()` and `SettlementIdConsumed(id)` are v4's `ZeroPaymentId()` and
    /// `PaymentIdConsumed(id)`: same arguments, new names. Ids inside `PaymentIdMismatch` and
    /// `PaymentIdConsumed` depend on the router; each must be the spec id for this router, then is blanked
    /// unless both ran at the same address.
    function _normalise(
        bytes memory data,
        address router,
        IPayments.PaymentItem[] memory items,
        bool isBeta,
        bool blankIds
    )
        private
        view
        returns (bytes memory out)
    {
        out = data;
        if (data.length < 4) return out;
        bytes4 sel = bytes4(data);
        if (isBeta && sel == CapxulPaymentsV3.ZeroSettlementId.selector) sel = IPayments.ZeroPaymentId.selector;
        if (isBeta && sel == CapxulPaymentsV3.SettlementIdConsumed.selector) {
            sel = IPayments.PaymentIdConsumed.selector;
        }
        for (uint256 i; i < 4; ++i) {
            out[i] = sel[i];
        }
        if (sel == IPayments.PaymentIdMismatch.selector || sel == IPayments.PaymentIdConsumed.selector) {
            bytes32 id;
            assembly ("memory-safe") {
                id := mload(add(out, 36))
            }
            bool known;
            for (uint256 i; i < items.length; ++i) {
                known = known || id == _idAt(items[i], _chainId, router);
            }
            assertTrue(known, "revert names the spec id");
            if (blankIds) {
                assembly ("memory-safe") {
                    mstore(add(out, 36), 0)
                }
            }
        }
    }

    /// @dev One item, or two (the second a duplicate of the first, or with its own nonce) for a batch.
    function _items(
        IPayments.PaymentItem memory item,
        address router,
        uint8 idMode,
        bool batch,
        bool duplicate
    )
        private
        view
        returns (IPayments.PaymentItem[] memory items)
    {
        items = new IPayments.PaymentItem[](batch ? 2 : 1);
        items[0] = _withId(item, idMode);
        items[0].paymentId = idMode % 3 == 0 ? _idAt(item, _chainId, router) : items[0].paymentId;
        if (batch) {
            IPayments.PaymentItem memory second = _copy(item);
            if (!duplicate) second.jobNonce = keccak256(abi.encode(item.jobNonce, "second"));
            items[1] = _withId(second, 0);
            items[1].paymentId = _idAt(second, _chainId, router);
        }
    }

    /// @dev mode 0 correct is filled by the caller (router needed); 1 zero; 2 wrong.
    function _withId(
        IPayments.PaymentItem memory item,
        uint8 idMode
    )
        private
        pure
        returns (IPayments.PaymentItem memory c)
    {
        c = _copy(item);
        c.paymentId = idMode % 3 == 1 ? bytes32(0) : bytes32(uint256(0xbad));
    }

    /// @dev Memory structs alias on assignment; every mutation below goes through a copy.
    function _copy(IPayments.PaymentItem memory i) private pure returns (IPayments.PaymentItem memory) {
        return IPayments.PaymentItem(
            i.paymentId, i.recipient, i.token, i.amount, i.kind, i.documentHash, i.jobNonce, i.executor
        );
    }

    function _toBeta(IPayments.PaymentItem memory i) private pure returns (CapxulPaymentsV3.PaymentItem memory) {
        return CapxulPaymentsV3.PaymentItem({
            settlementId: i.paymentId,
            recipient: i.recipient,
            token: i.token,
            amount: i.amount,
            kind: i.kind,
            documentHash: i.documentHash,
            jobNonce: i.jobNonce,
            executor: i.executor
        });
    }

    function _token(uint8 sel) private view returns (address) {
        address[7] memory tokens = [
            address(usdc), address(usdt), address(dai), address(falseToken), address(feeToken), address(0), users.alice
        ];
        return tokens[sel % 7];
    }

    function _recipient(uint8 sel, address router) private view returns (address) {
        address[5] memory who = [users.alice, address(0), users.amira, users.eve, router];
        return who[sel % 5];
    }
}
