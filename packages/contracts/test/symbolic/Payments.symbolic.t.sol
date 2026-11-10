// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";

import { IPayments } from "../../src/interfaces/IPayments.sol";
import { Payments } from "../../src/money/Payments.sol";

/// @notice Halmos checks for Payments (fv/halmos.md): P4, the id is injective in each hashed field and
/// in the router. Each check first runs one concrete `paymentId` that must succeed and equal the spec's
/// hash (the vacuity guard, verification-loop.md "TDD"), and every symbolic call is made with `try`, so
/// a reverting stub is a counterexample rather than a skipped path.
contract Payments_Symbolic is Test {
    bytes32 internal constant PAYMENT_TYPEHASH = keccak256(
        "CapxulPayment(uint256 chainId,address router,bytes32 jobNonce,address executor,address recipient,address token,uint256 amount,uint16 kind,bytes32 documentHash)"
    );

    Payments internal payments;
    Payments internal otherPayments;

    function setUp() public {
        payments = new Payments();
        otherPayments = new Payments();
    }

    function check_P4_paymentIdInjective_jobNonce(IPayments.PaymentItem memory a, bytes32 value) external view {
        vm.assume(value != a.jobNonce);
        IPayments.PaymentItem memory b = _copy(a);
        b.jobNonce = value;
        _assertDifferent(payments, a, payments, b);
    }

    function check_P4_paymentIdInjective_executor(IPayments.PaymentItem memory a, address value) external view {
        vm.assume(value != a.executor);
        IPayments.PaymentItem memory b = _copy(a);
        b.executor = value;
        _assertDifferent(payments, a, payments, b);
    }

    function check_P4_paymentIdInjective_recipient(IPayments.PaymentItem memory a, address value) external view {
        vm.assume(value != a.recipient);
        IPayments.PaymentItem memory b = _copy(a);
        b.recipient = value;
        _assertDifferent(payments, a, payments, b);
    }

    function check_P4_paymentIdInjective_token(IPayments.PaymentItem memory a, address value) external view {
        vm.assume(value != a.token);
        IPayments.PaymentItem memory b = _copy(a);
        b.token = value;
        _assertDifferent(payments, a, payments, b);
    }

    function check_P4_paymentIdInjective_amount(IPayments.PaymentItem memory a, uint256 value) external view {
        vm.assume(value != a.amount);
        IPayments.PaymentItem memory b = _copy(a);
        b.amount = value;
        _assertDifferent(payments, a, payments, b);
    }

    function check_P4_paymentIdInjective_kind(IPayments.PaymentItem memory a, uint16 value) external view {
        vm.assume(value != a.kind);
        IPayments.PaymentItem memory b = _copy(a);
        b.kind = value;
        _assertDifferent(payments, a, payments, b);
    }

    function check_P4_paymentIdInjective_documentHash(IPayments.PaymentItem memory a, bytes32 value) external view {
        vm.assume(value != a.documentHash);
        IPayments.PaymentItem memory b = _copy(a);
        b.documentHash = value;
        _assertDifferent(payments, a, payments, b);
    }

    /// @dev The same terms on another Payments contract give another id.
    function check_P4_paymentIdInjective_router(IPayments.PaymentItem memory a) external view {
        _assertDifferent(payments, a, otherPayments, a);
    }

    /// @dev The item's own `paymentId` field is not hashed, and the id is the spec's formula.
    function check_P4_paymentIdIgnoresOwnField(IPayments.PaymentItem memory a, bytes32 value) external view {
        _vacuityGuard();
        IPayments.PaymentItem memory b = _copy(a);
        b.paymentId = value;
        bytes32 idA = _idOrFail(payments, a);
        assert(idA == _idOrFail(payments, b));
        assert(idA == _spec(a, address(payments)));
    }

    // ------------------------------------------------------------------ helpers

    function _assertDifferent(
        IPayments routerA,
        IPayments.PaymentItem memory a,
        IPayments routerB,
        IPayments.PaymentItem memory b
    )
        internal
        view
    {
        _vacuityGuard();
        assert(_idOrFail(routerA, a) != _idOrFail(routerB, b));
    }

    /// @dev One concrete call must succeed with the spec's id; against the reverting stub it fails.
    function _vacuityGuard() internal view {
        IPayments.PaymentItem memory item = IPayments.PaymentItem({
            paymentId: bytes32(0),
            recipient: address(0xA11CE),
            token: address(0x05DC),
            amount: 100e6,
            kind: 1,
            documentHash: keccak256("invoice"),
            jobNonce: keccak256("job"),
            executor: address(0)
        });
        assert(_idOrFail(payments, item) == _spec(item, address(payments)));
    }

    function _idOrFail(IPayments router, IPayments.PaymentItem memory item) internal view returns (bytes32 id) {
        try router.paymentId(item) returns (bytes32 result) {
            id = result;
        } catch {
            assert(false);
        }
    }

    function _spec(IPayments.PaymentItem memory item, address router) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                PAYMENT_TYPEHASH,
                block.chainid,
                router,
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

    function _copy(IPayments.PaymentItem memory a) internal pure returns (IPayments.PaymentItem memory) {
        return IPayments.PaymentItem({
            paymentId: a.paymentId,
            recipient: a.recipient,
            token: a.token,
            amount: a.amount,
            kind: a.kind,
            documentHash: a.documentHash,
            jobNonce: a.jobNonce,
            executor: a.executor
        });
    }
}
