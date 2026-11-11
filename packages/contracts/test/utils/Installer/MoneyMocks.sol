// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IPayments } from "../../../src/interfaces/IPayments.sol";
import { IHats } from "../../../src/interfaces/external/IHats.sol";
import { IHatsSignerGate } from "../../../src/interfaces/external/IHatsSignerGate.sol";
import { IRolesLike } from "./ExternalViews.sol";

/// @dev A deliberately faulty contract accepted by Installer's Safe-address check, not Hats Signer Gate.
/// A static call cannot write storage, but can give different answers as its storage slot becomes warm.
contract FaultyInstallerGate {
    uint256 private minimum = 3;
    address public immutable safe;
    bool private immutable changingMinimum;

    constructor(address safe_, bool changingMinimum_) {
        safe = safe_;
        changingMinimum = changingMinimum_;
    }

    function thresholdConfig() external view returns (IHatsSignerGate.ThresholdConfig memory config) {
        if (!changingMinimum) {
            return IHatsSignerGate.ThresholdConfig(IHatsSignerGate.TargetThresholdType.PROPORTIONAL, 1, 20_000);
        }
        uint256 min;
        uint256 readGas;
        assembly {
            let start := gas()
            min := sload(minimum.slot)
            readGas := sub(start, gas())
        }
        uint120 reported = uint120(readGas > 1000 ? 1 : min);
        config = IHatsSignerGate.ThresholdConfig(IHatsSignerGate.TargetThresholdType.ABSOLUTE, reported, reported);
    }
}

/// @dev Stands in for v4 Payments (W1) in the Installer's fork tests: it pulls exactly `amount` from the caller
/// (the company Safe) to the recipient, once per id. Payments' own checks are tested in its own suite.
contract MockPayments {
    error AlreadyPaid(bytes32 paymentId);
    error TransferFailed();

    mapping(bytes32 paymentId => bool) public paid;

    function send(IPayments.PaymentItem calldata item) external {
        if (paid[item.paymentId]) revert AlreadyPaid(item.paymentId);
        paid[item.paymentId] = true;
        if (!IERC20(item.token).transferFrom(msg.sender, item.recipient, item.amount)) revert TransferFailed();
    }
}

/// @dev Stands in for v4 Budgets (W2) in the Installer's fork tests: `configure` and `createTopBudget` from the
/// Safe, and a hat wearer's `spend` paid through the payout role exactly as Budgets pays (approve Payments, then
/// `Payments.send`, each by `Roles.execTransactionWithRole`). It checks the budget, never the Roles ceiling, so a
/// spend above the ceiling reaches Roles.
contract MockBudgets {
    struct Budget {
        address safe;
        address token;
        uint8 period;
        uint128 amount;
        uint128 spent;
        uint256 hat;
    }

    error InvalidConfiguration();
    error NotConfigured();
    error NotAuthorised(uint256 id, address who);
    error OverBudget(uint256 id, uint128 left, uint128 requested);

    IHats public immutable hats;
    address public immutable payments;

    mapping(address safe => address roles) public rolesOf;
    mapping(address safe => bytes32 roleKey) public roleKeyOf;
    Budget[] internal _budgets;

    constructor(IHats hats_, address payments_) {
        hats = hats_;
        payments = payments_;
    }

    function configure(address roles, bytes32 payoutRoleKey) external {
        if (IRolesLike(roles).avatar() != msg.sender) revert InvalidConfiguration();
        rolesOf[msg.sender] = roles;
        roleKeyOf[msg.sender] = payoutRoleKey;
    }

    function configs(address safe) external view returns (address roles, bytes32 payoutRoleKey) {
        return (rolesOf[safe], roleKeyOf[safe]);
    }

    function createTopBudget(address token, uint8 period, uint128 amount, uint256 hat) external returns (uint256 id) {
        if (rolesOf[msg.sender] == address(0)) revert NotConfigured();
        id = _budgets.length;
        _budgets.push(Budget({ safe: msg.sender, token: token, period: period, amount: amount, spent: 0, hat: hat }));
    }

    function budgetCount() external view returns (uint256) {
        return _budgets.length;
    }

    function budget(uint256 id) external view returns (Budget memory) {
        return _budgets[id];
    }

    function spend(
        uint256 id,
        address recipient,
        uint128 amount,
        uint16 kind,
        bytes32 documentHash,
        bytes32 jobNonce
    )
        external
        returns (bytes32 paymentId)
    {
        Budget storage b = _budgets[id];
        if (!hats.isWearerOfHat(msg.sender, b.hat)) revert NotAuthorised(id, msg.sender);
        if (b.spent + amount > b.amount) revert OverBudget(id, b.amount - b.spent, amount);
        b.spent += amount;

        IPayments.PaymentItem memory item = IPayments.PaymentItem({
            paymentId: bytes32(0),
            recipient: recipient,
            token: b.token,
            amount: amount,
            kind: kind,
            documentHash: documentHash,
            jobNonce: jobNonce,
            executor: b.safe
        });
        paymentId = keccak256(abi.encode(item, id));
        item.paymentId = paymentId;

        IRolesLike roles = IRolesLike(rolesOf[b.safe]);
        bytes32 key = roleKeyOf[b.safe];
        roles.execTransactionWithRole(b.token, 0, abi.encodeCall(IERC20.approve, (payments, amount)), 0, key, true);
        roles.execTransactionWithRole(payments, 0, abi.encodeCall(IPayments.send, (item)), 0, key, true);
    }
}
