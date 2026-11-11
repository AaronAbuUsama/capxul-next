// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IBudgets } from "../../../src/interfaces/IBudgets.sol";
import { MockHats } from "../../mocks/MockHats.sol";
import { MockRoles } from "../../mocks/MockRoles.sol";

/// @notice The part of Budgets that Agreements calls, for hermetic Agreements tests (spec/budgets.md).
/// It keeps each budget's Safe, token, period, amount, `ownCommitted` and closed flag, answers
/// `authorised` as Budgets does (the Safe, or a wearer in good standing of the hat of the budget or any
/// budget above it; false for an unknown id, whose `budgetOf` is the zero record), refuses `commit` as
/// Budgets does (`UnknownBudget`, `BudgetIsClosed`, `OverBudget`),
/// and pays `payReserved` through the Safe's Roles payout role, so Roles' allowance, the Safe's balance
/// and the token can each refuse a collection. Every `payReserved` is recorded for the tests.
/// @dev Spends, periods and children's amounts are Budgets' own tests; this stand-in models none of them.
contract MockBudgets {
    struct B {
        address safe;
        uint256 parent;
        uint256 hat;
        address token;
        uint8 period;
        bool closed;
        uint128 amount;
        uint128 ownCommitted;
        bytes32 payoutRoleKey;
        address roles;
    }

    /// @notice One `payReserved` call as Agreements made it.
    struct Pay {
        uint256 budgetId;
        address recipient;
        uint128 amount;
        uint16 kind;
        bytes32 documentHash;
        bytes32 jobNonce;
        bytes32 paymentId;
    }

    error PayoutRefused();

    MockHats public immutable hats;
    address public agreements;
    uint256 public budgetCount;
    mapping(uint256 id => B) internal _b;
    Pay[] internal _pays;
    mapping(bytes32 jobNonce => bool) public nonceUsed;
    /// @notice Counts of the calls Agreements made, for "moves no money" and "settles first" checks.
    uint256 public commitCalls;
    uint256 public releaseCalls;

    constructor(MockHats hats_) {
        hats = hats_;
    }

    // ------------------------------------------------------------------ test setup

    function setAgreements(address agreements_) external {
        agreements = agreements_;
    }

    /// @notice Creates a budget as the Safe (or a hat wearer, for a child) would.
    function create(
        address safe,
        uint256 parent,
        uint256 hat,
        address token,
        uint8 period,
        uint128 amount,
        address roles,
        bytes32 payoutRoleKey
    )
        external
        returns (uint256 id)
    {
        id = ++budgetCount;
        _b[id] = B({
            safe: safe,
            parent: parent,
            hat: hat,
            token: token,
            period: period,
            closed: false,
            amount: amount,
            ownCommitted: 0,
            payoutRoleKey: payoutRoleKey,
            roles: roles
        });
    }

    /// @notice D8 as Budgets does it: a cut below what is committed is refused with `AmountBelowUse`.
    function setAmount(uint256 id, uint128 amount) external {
        B storage b = _known(id);
        if (amount < b.ownCommitted) revert IBudgets.AmountBelowUse(id, b.ownCommitted, amount);
        b.amount = amount;
    }

    function setClosed(uint256 id, bool closed) external {
        _known(id).closed = closed;
    }

    // ------------------------------------------------------------------ what Agreements calls

    function authorised(uint256 id, address who) public view returns (bool) {
        B storage b = _b[id];
        if (b.safe == address(0)) return false; // as Budgets: no one acts for a budget that does not exist
        if (who == b.safe) return true;
        for (uint256 i; i < 8 && id != 0; ++i) {
            uint256 hat = _b[id].hat;
            if (hats.isWearerOfHat(who, hat) && hats.isInGoodStanding(who, hat)) return true;
            id = _b[id].parent;
        }
        return false;
    }

    function budgetOf(uint256 id) external view returns (IBudgets.Budget memory r) {
        B storage b = _b[id];
        if (b.safe == address(0)) return r; // as Budgets: the zero record for an unknown id
        r.safe = b.safe;
        r.parent = b.parent;
        r.hat = b.hat;
        r.token = b.token;
        r.period = b.period;
        r.depth = b.parent == 0 ? 1 : 2;
        r.closed = b.closed;
        r.amount = b.amount;
        r.ownCommitted = b.ownCommitted;
        r.committed = b.ownCommitted;
    }

    function leftOf(uint256 id) public view returns (uint128) {
        B storage b = _known(id);
        return b.amount > b.ownCommitted ? b.amount - b.ownCommitted : 0;
    }

    function commit(uint256 id, uint128 amount) external {
        _onlyAgreements();
        B storage b = _known(id);
        for (uint256 c = id; c != 0; c = _b[c].parent) {
            if (_b[c].closed) revert IBudgets.BudgetIsClosed(c);
        }
        uint128 left = leftOf(id);
        if (amount > left) revert IBudgets.OverBudget(id, left, amount);
        b.ownCommitted += amount;
        ++commitCalls;
        emit IBudgets.Committed(b.safe, id, amount);
    }

    function release(uint256 id, uint128 amount) external {
        _onlyAgreements();
        B storage b = _known(id);
        b.ownCommitted -= amount; // Budgets never lets this underflow; an underflow here is an Agreements bug
        ++releaseCalls;
        emit IBudgets.Released(b.safe, id, amount);
    }

    /// @notice Pays through the Safe's Roles payout role: Roles, the Safe's balance or the token may refuse,
    /// and any refusal reverts the whole call, as Budgets' `shouldRevert = true` does.
    function payReserved(
        uint256 id,
        address recipient,
        uint128 amount,
        bytes32 documentHash,
        bytes32 jobNonce
    )
        external
        returns (bytes32 paymentId)
    {
        _onlyAgreements();
        B storage b = _known(id);
        if (nonceUsed[jobNonce]) revert PayoutRefused(); // Payments pays an id at most once
        uint256 before = IERC20(b.token).balanceOf(recipient);
        MockRoles(b.roles)
            .execTransactionWithRole(
                b.token, 0, abi.encodeCall(IERC20.transfer, (recipient, amount)), 0, b.payoutRoleKey, true
            );
        // A token that returns false or moves a different amount is refused, as Payments refuses it.
        if (IERC20(b.token).balanceOf(recipient) != before + amount) revert PayoutRefused();
        nonceUsed[jobNonce] = true;
        paymentId =
            keccak256(abi.encode(address(this), id, recipient, b.token, amount, uint16(4), documentHash, jobNonce));
        _pays.push(Pay(id, recipient, amount, 4, documentHash, jobNonce, paymentId));
        emit IBudgets.ReservedPaid(b.safe, id, recipient, amount, paymentId);
    }

    // ------------------------------------------------------------------ test reads

    function ownCommitted(uint256 id) external view returns (uint128) {
        return _b[id].ownCommitted;
    }

    function payCount() external view returns (uint256) {
        return _pays.length;
    }

    function payAt(uint256 i) external view returns (Pay memory) {
        return _pays[i];
    }

    function _known(uint256 id) internal view returns (B storage b) {
        b = _b[id];
        if (b.safe == address(0)) revert IBudgets.UnknownBudget(id);
    }

    function _onlyAgreements() internal view {
        if (msg.sender != agreements) revert IBudgets.OnlyAgreements();
    }
}
