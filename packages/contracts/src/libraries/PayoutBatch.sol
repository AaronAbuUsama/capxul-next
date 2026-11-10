// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IPayments } from "../interfaces/IPayments.sol";
import { IMultiSend } from "../interfaces/external/IMultiSend.sol";

/// @title PayoutBatch
/// @notice Encodes the one Roles call of a payout (spec/budgets.md "Paying", as beta
/// `PayrollDepartments.collect`): MultiSendCallOnly batching `token.approve(payments, amount)` and
/// `payments.send(item)`. Split out of Budgets to keep its stack shallow without via-IR.
library PayoutBatch {
    /// @dev MultiSend operation byte for a plain call.
    uint8 internal constant CALL = 0;

    /// @notice The `multiSend` calldata for `item`: approve exactly `item.amount`, then send.
    /// @param payments The Payments contract.
    /// @param item The payment, with its id.
    /// @return The `multiSend(bytes)` calldata.
    function multiSend(address payments, IPayments.PaymentItem memory item) internal pure returns (bytes memory) {
        bytes memory approve = abi.encodeCall(IERC20.approve, (payments, item.amount));
        bytes memory send = abi.encodeCall(IPayments.send, (item));
        // Every dynamic part is length-prefixed, so no collision.
        // forge-lint: disable-start(encode-packed-collision)
        bytes memory batch = abi.encodePacked(
            CALL, item.token, uint256(0), approve.length, approve, CALL, payments, uint256(0), send.length, send
        );
        // forge-lint: disable-end(encode-packed-collision)
        return abi.encodeCall(IMultiSend.multiSend, (batch));
    }
}
