// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IPayments } from "../../src/interfaces/IPayments.sol";

/// @notice A token that re-enters Payments from inside `transferFrom` (rule P8_reentryReverts): it calls
/// back `send` or `sendBatch` (chosen by `useBatch`) with a stored item, records whether that inner call
/// succeeded, then moves the tokens exactly. `payments` is linked to the verified Payments in the conf.
contract PaymentsReentrantTokenHarness {
    IPayments public payments;
    IPayments.PaymentItem internal stored;
    bool public useBatch;
    bool public reentered;
    bool public reentrySucceeded;

    mapping(address account => uint256) public balanceOf;
    mapping(address owner => mapping(address spender => uint256)) public allowance;

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        reentered = true;
        if (useBatch) {
            IPayments.PaymentItem[] memory items = new IPayments.PaymentItem[](1);
            items[0] = stored;
            try payments.sendBatch(items) {
                reentrySucceeded = true;
            } catch { }
        } else {
            try payments.send(stored) {
                reentrySucceeded = true;
            } catch { }
        }
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
