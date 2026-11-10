// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IPayments } from "../../../src/interfaces/IPayments.sol";
import { MockSafe } from "../../mocks/MockSafe.sol";

/// @dev Payments (W1) as Budgets' tests need it: the id is a hash of every term, consumed once, only
/// the executor may send, and exactly `amount` moves from the caller. The real Payments replaces it
/// on the fork and in the scenario once W1 lands; Budgets' unit tests stay on this stand-in so they
/// never depend on another contract's implementation.
contract BudgetsPaymentsMock is IPayments {
    mapping(bytes32 id => bool) public paid;
    uint256 public sends;

    function paymentId(PaymentItem calldata item) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                block.chainid,
                address(this),
                item.recipient,
                item.token,
                item.amount,
                item.kind,
                item.documentHash,
                item.jobNonce,
                item.executor
            )
        );
    }

    function send(PaymentItem calldata item) public {
        if (item.executor != address(0) && item.executor != msg.sender) {
            revert InvalidExecutor(item.executor, msg.sender);
        }
        bytes32 id = paymentId(item);
        if (item.paymentId != id) revert PaymentIdMismatch(id, item.paymentId);
        if (paid[id]) revert PaymentIdConsumed(id);
        paid[id] = true;
        ++sends;
        if (!IERC20(item.token).transferFrom(msg.sender, item.recipient, item.amount)) {
            revert TokenCallReturnedFalse(item.token);
        }
        emit PaymentSent(id, msg.sender, item.recipient, item.token, item.amount, item.kind, item.documentHash);
    }

    function sendBatch(PaymentItem[] calldata items) external {
        for (uint256 i; i < items.length; ++i) {
            send(items[i]);
        }
    }
}

/// @dev The Hats Signer Gate as `Budgets.configure` reads it: only `safe()`.
contract BudgetsGateMock {
    address public safe;

    constructor(address safe_) {
        safe = safe_;
    }
}

/// @dev Zodiac Roles 2.1 on the Gate, as Budgets' payout needs it hermetically. `avatar()` is the
/// company Safe and `target()` the Gate. A role member's call to MultiSendCallOnly by delegatecall
/// is unpacked and each inner call made as the Safe (what a delegatecall to MultiSendCallOnly does);
/// a `send` is checked against the per-token payout allowance first, as the real `WithinAllowance`
/// condition on the item's amount does (B5). Every call is recorded. The real scoping is the fork
/// test's.
contract BudgetsRolesMock {
    address internal constant MULTI_SEND_CALL_ONLY = 0x9641d764fc13c8B624c04430C7356C1C7C8102e2;

    error NotAuthorized(address module);
    error AllowanceExceeded(address token, uint256 amount, uint256 left);
    error ModuleTransactionFailed();
    error Refused();

    MockSafe internal immutable _avatar;
    address public target;
    mapping(bytes32 roleKey => mapping(address member => bool)) public isMember;
    mapping(address token => bool) public capped;
    mapping(address token => uint256) public allowanceLeft;
    bool public refuseAll;

    uint256 public calls;
    address public lastTo;
    uint8 public lastOperation;
    bytes32 public lastRoleKey;
    bool public lastShouldRevert;

    constructor(MockSafe avatar_, address target_) {
        _avatar = avatar_;
        target = target_;
    }

    function avatar() external view returns (address) {
        return address(_avatar);
    }

    function setTarget(address target_) external {
        target = target_;
    }

    function setMember(bytes32 roleKey, address member, bool on) external {
        isMember[roleKey][member] = on;
    }

    function setAllowance(address token, uint256 amount) external {
        capped[token] = true;
        allowanceLeft[token] = amount;
    }

    function setRefuseAll(bool on) external {
        refuseAll = on;
    }

    function execTransactionWithRole(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        bytes32 roleKey,
        bool shouldRevert
    )
        external
        returns (bool success)
    {
        if (!isMember[roleKey][msg.sender]) revert NotAuthorized(msg.sender);
        if (refuseAll) revert Refused();
        ++calls;
        lastTo = to;
        lastOperation = operation;
        lastRoleKey = roleKey;
        lastShouldRevert = shouldRevert;
        if (operation == 1) {
            if (to != MULTI_SEND_CALL_ONLY) revert Refused();
            success = _multiSend(abi.decode(data[4:], (bytes)));
        } else {
            success = _call(to, value, data);
        }
        if (shouldRevert && !success) revert ModuleTransactionFailed();
    }

    function _multiSend(bytes memory txs) internal returns (bool) {
        uint256 i;
        while (i < txs.length) {
            uint8 op;
            address to;
            uint256 value;
            uint256 len;
            assembly {
                let p := add(add(txs, 0x20), i)
                op := shr(248, mload(p))
                to := shr(96, mload(add(p, 1)))
                value := mload(add(p, 21))
                len := mload(add(p, 53))
            }
            if (op != 0) revert Refused();
            bytes memory inner = new bytes(len);
            for (uint256 j; j < len; ++j) {
                inner[j] = txs[i + 85 + j];
            }
            if (!_call(to, value, inner)) return false;
            i += 85 + len;
        }
        return true;
    }

    function _call(address to, uint256 value, bytes memory data) internal returns (bool) {
        if (data.length >= 4 && bytes4(data) == IPayments.send.selector) {
            IPayments.PaymentItem memory item = abi.decode(_slice(data, 4), (IPayments.PaymentItem));
            if (capped[item.token]) {
                uint256 left = allowanceLeft[item.token];
                if (item.amount > left) revert AllowanceExceeded(item.token, item.amount, left);
                allowanceLeft[item.token] = left - item.amount;
            }
        }
        return _avatar.execTransactionFromModule(to, value, data, 0);
    }

    function _slice(bytes memory data, uint256 from) internal pure returns (bytes memory out) {
        out = new bytes(data.length - from);
        for (uint256 j; j < out.length; ++j) {
            out[j] = data[from + j];
        }
    }
}
