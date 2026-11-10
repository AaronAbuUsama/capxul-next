// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IExits } from "../../../src/interfaces/IExits.sol";
import { IPayments } from "../../../src/interfaces/IPayments.sol";
import { ScenarioEquityCalls } from "./ScenarioEquityCalls.sol";

/// @notice Exits' calls (a sale, a secondary transfer) and the exit payout batch: `Payments.sendBatch` with
/// `{ exitSaleId, holdings }` sends one kind-8 item per nonzero `Exits.preview` payout, exactly as `Exits.settle`
/// derives them (spec/exits.md), so the Board's batch is approve, sendBatch, settle.
abstract contract ScenarioExitCalls is ScenarioEquityCalls {
    uint16 internal constant EXIT_KIND = 8;

    function _exitCall(
        string memory call,
        string memory p
    )
        internal
        view
        returns (bool found, address target, bytes memory data)
    {
        bytes32 c = keccak256(bytes(call));
        found = true;
        if (_startsWith(call, "Exits.")) {
            (target, data) = (_equity().exits, _exits(c, p));
        } else if (c == keccak256("Payments.sendBatch")) {
            (target, data) = (_contract("Payments"), abi.encodeCall(IPayments.sendBatch, (_exitItems(p))));
        } else {
            found = false;
        }
    }

    function _exits(bytes32 c, string memory p) internal view returns (bytes memory) {
        if (c == keccak256("Exits.approveSale")) {
            return abi.encodeCall(
                IExits.approveSale, (_u(p, "saleId"), _a(p, "token"), _u(p, "proceeds"), _b32(p, "termsHash"))
            );
        }
        if (c == keccak256("Exits.offerTransfer")) {
            return abi.encodeCall(
                IExits.offerTransfer,
                (
                    uint8(_u(p, "classId")),
                    _a(p, "buyer"),
                    uint128(_u(p, "shares")),
                    uint128(_u(p, "price")),
                    _a(p, "token"),
                    _b32(p, "documentHash")
                )
            );
        }
        if (c == keccak256("Exits.approveTransfer")) {
            return abi.encodeCall(IExits.approveTransfer, (_u(p, "transferId")));
        }
        if (c == keccak256("Exits.buy")) return abi.encodeCall(IExits.buy, (_u(p, "transferId")));
        if (c != keccak256("Exits.settle")) revert UnknownCall("Exits");
        return abi.encodeCall(
            IExits.settle,
            (_u(p, "saleId"), _holdings(_ref(string.concat(p, ".holdings"))), _uints(string.concat(p, ".claimIndexes")))
        );
    }

    function _holdings(string memory p) internal view returns (IExits.Holding[] memory h) {
        uint256 n = _count(p);
        h = new IExits.Holding[](n);
        for (uint256 i; i < n; ++i) {
            string memory e = string.concat(p, "[", vm.toString(i), "]");
            h[i] = IExits.Holding({
                payee: _a(e, "payee"),
                classId: uint8(_u(e, "classId")),
                option: _bool(e, "option"),
                grantId: _u(e, "grantId"),
                shares: uint128(_u(e, "shares"))
            });
        }
    }

    /// @dev The exit batch's payments: what `Exits.settle` requires paid, one item per nonzero payout.
    function _exitItems(string memory p) internal view returns (IPayments.PaymentItem[] memory items) {
        IExits exits = IExits(_equity().exits);
        uint256 saleId = _u(p, "exitSaleId");
        IExits.Sale memory sale = exits.sale(saleId);
        IExits.Payout[] memory payouts = exits.preview(saleId, _holdings(_ref(string.concat(p, ".holdings"))));
        IPayments payments = IPayments(_contract("Payments"));
        uint256 paid;
        for (uint256 i; i < payouts.length; ++i) {
            if (payouts[i].amount > 0) ++paid;
        }
        items = new IPayments.PaymentItem[](paid);
        uint256 k;
        for (uint256 i; i < payouts.length; ++i) {
            if (payouts[i].amount == 0) continue;
            items[k] = IPayments.PaymentItem({
                paymentId: bytes32(0),
                recipient: payouts[i].payee,
                token: sale.token,
                amount: payouts[i].amount,
                kind: EXIT_KIND,
                documentHash: sale.termsHash,
                jobNonce: keccak256(abi.encode(address(exits), saleId, i)),
                executor: _company()
            });
            items[k].paymentId = payments.paymentId(items[k]);
            ++k;
        }
    }
}
