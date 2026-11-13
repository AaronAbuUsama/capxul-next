// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";

import { IEscrow } from "../interfaces/IEscrow.sol";
import { IEscrowFactory } from "../interfaces/IEscrowFactory.sol";
import { IPayments } from "../interfaces/IPayments.sol";
import { Escrow } from "./Escrow.sol";

/// @title EscrowFactory
/// @notice Deploys general escrows at deterministic addresses (aaron.escrow-general). v4's factory with the
/// general escrow's terms; its constructor is unchanged, so the deploy manifest is too.
contract EscrowFactory is IEscrowFactory {
    /// @inheritdoc IEscrowFactory
    IPayments public immutable payments;
    /// @inheritdoc IEscrowFactory
    address public immutable bootstrapOwner;

    /// @param payments_ The Payments contract every escrow pays through.
    /// @param bootstrapOwner_ The chain's Companies House Safe.
    constructor(address payments_, address bootstrapOwner_) {
        if (payments_ == address(0) || bootstrapOwner_ == address(0)) revert ZeroAddress();
        payments = IPayments(payments_);
        bootstrapOwner = bootstrapOwner_;
    }

    /// @inheritdoc IEscrowFactory
    function deploy(IEscrow.Terms calldata terms, bytes32 salt) external returns (address escrow) {
        escrow = predictAddress(terms, salt);
        if (escrow.code.length != 0) return escrow;
        escrow = address(new Escrow{ salt: salt }(terms, address(payments)));
        bytes32 id = IEscrow(escrow).paymentId();
        // forge-lint: disable-next-line(reentrancy-events)
        emit EscrowDeployed(escrow, terms.owner, terms.sender, id, salt, terms.authority, terms.authorityKey);
    }

    /// @inheritdoc IEscrowFactory
    function predictAddress(IEscrow.Terms calldata terms, bytes32 salt) public view returns (address) {
        _validate(terms);
        bytes32 initCodeHash =
        // forge-lint: disable-next-line(encode-packed-collision)
        keccak256(abi.encodePacked(type(Escrow).creationCode, abi.encode(terms, address(payments))));
        return Create2.computeAddress(salt, initCodeHash);
    }

    /// @inheritdoc IEscrowFactory
    function predictPaymentId(IEscrow.Terms calldata terms, bytes32 salt) external view returns (bytes32) {
        address escrow = predictAddress(terms, salt);
        return payments.paymentId(
            IPayments.PaymentItem({
                paymentId: bytes32(uint256(1)),
                recipient: terms.owner,
                token: terms.token,
                amount: terms.amount,
                kind: terms.kind,
                documentHash: terms.documentHash,
                jobNonce: terms.jobNonce,
                executor: terms.condition == 1 ? escrow : address(0)
            })
        );
    }

    function _validate(IEscrow.Terms calldata terms) private pure {
        if (terms.owner == address(0) || terms.sender == address(0) || terms.token == address(0)) {
            revert ZeroAddress();
        }
        if (terms.amount == 0) revert ZeroAmount();
        if (terms.jobNonce == bytes32(0)) revert ZeroJobNonce();
        if (terms.documentHash == bytes32(0)) revert ZeroDocumentHash();
        if (terms.condition > 1) revert InvalidCondition(terms.condition);
    }
}
