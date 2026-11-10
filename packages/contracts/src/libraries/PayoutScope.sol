// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { IInstaller } from "../interfaces/IInstaller.sol";
import { IPayments } from "../interfaces/IPayments.sol";
import { IRoles } from "../interfaces/external/IRoles.sol";

/// @title PayoutScope
/// @notice The Roles calls that scope the payout role (spec/installer.md step 2, item 4), ported from the beta
/// builder `packages/protocol/src/evm/payroll-payout-role.ts`: `approve` on each token with the spender fixed to
/// Payments, and one `Payments.send` condition whose item must match a token's branch, its token fixed and its amount
/// within that token's allowance.
library PayoutScope {
    /// @dev `keccak256("v4-payout")`.
    bytes32 internal constant ROLE_KEY = keccak256("v4-payout");

    /// @notice A token's payout ceiling key.
    /// @param token The token.
    /// @return The Roles allowance key.
    function allowanceKey(address token) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("v4-payout-ceiling:", token));
    }

    /// @notice The two calls that let the payout role `approve` Payments on `token` and nothing else.
    /// @param roles The company's Roles.
    /// @param token The token.
    /// @param payments The Payments contract (the only spender).
    /// @return target The `scopeTarget` call.
    /// @return fn The `scopeFunction` call.
    function approveScope(
        address roles,
        address token,
        address payments
    )
        internal
        pure
        returns (IInstaller.Call memory target, IInstaller.Call memory fn)
    {
        IRoles.ConditionFlat[] memory c = new IRoles.ConditionFlat[](3);
        c[0] = _node(0, IRoles.ParameterType.Calldata, IRoles.Operator.Matches, "");
        c[1] = _node(0, IRoles.ParameterType.Static, IRoles.Operator.EqualTo, abi.encode(payments));
        c[2] = _node(0, IRoles.ParameterType.Static, IRoles.Operator.Pass, "");
        target = _call(roles, abi.encodeCall(IRoles.scopeTarget, (ROLE_KEY, token)));
        fn = _call(
            roles,
            abi.encodeCall(
                IRoles.scopeFunction, (ROLE_KEY, token, IERC20.approve.selector, c, IRoles.ExecutionOptions.None)
            )
        );
    }

    /// @notice The two calls that scope `Payments.send` over every token. Scoping again with one more token replaces
    /// the condition and leaves every allowance as it was.
    /// @param roles The company's Roles.
    /// @param tokens Every token (at least one).
    /// @param payments The Payments contract.
    /// @return target The `scopeTarget` call.
    /// @return fn The `scopeFunction` call.
    function sendScope(
        address roles,
        address[] memory tokens,
        address payments
    )
        internal
        pure
        returns (IInstaller.Call memory target, IInstaller.Call memory fn)
    {
        uint256 n = tokens.length;
        // One token needs no Or (the beta rule). With an Or the branches are nodes 2.., their fields follow.
        uint256 head = n == 1 ? 2 : 2 + n;
        IRoles.ConditionFlat[] memory c = new IRoles.ConditionFlat[](head + n * 8);
        c[0] = _node(0, IRoles.ParameterType.Calldata, IRoles.Operator.Matches, "");
        if (n == 1) {
            c[1] = _node(0, IRoles.ParameterType.Tuple, IRoles.Operator.Matches, "");
        } else {
            c[1] = _node(0, IRoles.ParameterType.None, IRoles.Operator.Or, "");
            for (uint256 t; t < n; ++t) {
                c[2 + t] = _node(1, IRoles.ParameterType.Tuple, IRoles.Operator.Matches, "");
            }
        }
        for (uint256 t; t < n; ++t) {
            // PaymentItem: paymentId, recipient, token, amount, kind, documentHash, jobNonce, executor.
            uint8 parent = n == 1 ? 1 : SafeCast.toUint8(2 + t);
            for (uint256 i; i < 8; ++i) {
                c[head + t * 8 + i] = _node(parent, IRoles.ParameterType.Static, IRoles.Operator.Pass, "");
            }
            c[head + t * 8 + 2].operator = IRoles.Operator.EqualTo;
            c[head + t * 8 + 2].compValue = abi.encode(tokens[t]);
            c[head + t * 8 + 3].operator = IRoles.Operator.WithinAllowance;
            c[head + t * 8 + 3].compValue = abi.encode(allowanceKey(tokens[t]));
        }
        target = _call(roles, abi.encodeCall(IRoles.scopeTarget, (ROLE_KEY, payments)));
        fn = _call(
            roles,
            abi.encodeCall(
                IRoles.scopeFunction, (ROLE_KEY, payments, IPayments.send.selector, c, IRoles.ExecutionOptions.None)
            )
        );
    }

    /// @notice The allowance call for a token: balance, max refill and refill all `ceiling`, `period` seconds,
    /// starting at the first use (timestamp 0).
    /// @param roles The company's Roles.
    /// @param token The token.
    /// @param ceiling The ceiling.
    /// @param period The refill period in seconds.
    /// @return The `setAllowance` call.
    function allowance(
        address roles,
        address token,
        uint128 ceiling,
        uint64 period
    )
        internal
        pure
        returns (IInstaller.Call memory)
    {
        return _call(
            roles, abi.encodeCall(IRoles.setAllowance, (allowanceKey(token), ceiling, ceiling, ceiling, period, 0))
        );
    }

    /// @notice A budget period's length rounded up: 31, 92 or 366 days.
    /// @param budgetPeriod `BUDGET_MONTH`, `BUDGET_QUARTER` or `BUDGET_YEAR`.
    /// @return Seconds.
    function periodSeconds(uint8 budgetPeriod) internal pure returns (uint64) {
        return budgetPeriod == 0 ? 31 days : budgetPeriod == 1 ? 92 days : 366 days;
    }

    function _node(
        uint8 parent,
        IRoles.ParameterType paramType,
        IRoles.Operator operator,
        bytes memory compValue
    )
        private
        pure
        returns (IRoles.ConditionFlat memory)
    {
        return IRoles.ConditionFlat({ parent: parent, paramType: paramType, operator: operator, compValue: compValue });
    }

    function _call(address to, bytes memory data) private pure returns (IInstaller.Call memory) {
        return IInstaller.Call({ to: to, value: 0, data: data });
    }
}
