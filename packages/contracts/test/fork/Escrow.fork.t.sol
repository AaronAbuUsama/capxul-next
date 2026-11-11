// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { EscrowFactory } from "../../src/money/EscrowFactory.sol";
import { IEscrow } from "../../src/interfaces/IEscrow.sol";

import { Payments } from "../../src/money/Payments.sol";
import { Addresses } from "./Addresses.sol";
import { Fork_Test } from "./Fork_Test.t.sol";
import { ISafe, ISafeProxyFactory } from "./Interfaces.sol";

/// @notice D11 on the real Safe 1.4.1 (invariant S8, "Fork (real Safe, two owners)"): a claim escrow reads
/// the payee Safe's real `isOwner`. There is no beta escrow fork suite (R2 4.5); these are new, plus R2
/// ES20 (beta `CapxulEscrow.t.sol:276`, a claimed payee collecting two escrows in one batch) on a real Safe.
contract Escrow_Fork_Test is Fork_Test {
    uint256 internal constant AMOUNT = 100 * USDC_UNIT;
    uint8 internal constant CLAIM = 1;

    address internal companiesHouse;
    Payments internal payments;
    EscrowFactory internal factory;
    uint256 internal saltNonce = 1000;

    function _deployProtocol() internal override {
        companiesHouse = makeAddr("companies house");
        payments = new Payments();
        factory = new EscrowFactory(address(payments), companiesHouse);
    }

    function test_S8_ARealSafeThatStillListsCompaniesHouseIsNotClaimedUntilItIsRemoved() external {
        address[] memory owners = new address[](2);
        owners[0] = users.amira;
        owners[1] = companiesHouse;
        ISafe payee = _safe(owners);
        IEscrow escrow = _fundedClaimEscrow(address(payee), "one");

        assertFalse(escrow.conditionMet(), "Companies House is still an owner");
        // The escrow refuses with ConditionNotMet, called directly and through the Safe.
        vm.prank(address(payee));
        vm.expectRevert(IEscrow.ConditionNotMet.selector);
        escrow.collect();
        bytes memory collect = abi.encodeCall(IEscrow.collect, ());
        bytes memory sig = _amiraSign(
            payee.getTransactionHash(address(escrow), 0, collect, CALL, 0, 0, 0, address(0), address(0), payee.nonce())
        );
        // Safe 1.5 passes the inner call's revert reason through, where 1.4.1 replaced it with GS013.
        vm.expectRevert(IEscrow.ConditionNotMet.selector);
        payee.execTransaction(address(escrow), 0, collect, CALL, 0, 0, 0, address(0), payable(address(0)), sig);

        // The claim: Companies House is removed; Amira's key stays, threshold 1.
        _exec(
            payee,
            address(payee),
            abi.encodeWithSignature("removeOwner(address,address,uint256)", users.amira, companiesHouse, 1),
            CALL
        );
        assertFalse(payee.isOwner(companiesHouse), "removed");
        assertTrue(escrow.conditionMet(), "claimed");
        _exec(payee, address(escrow), abi.encodeCall(IEscrow.collect, ()), CALL);
        assertEq(usdc.balanceOf(address(payee)), AMOUNT, "collected");
        assertEq(uint256(escrow.state()), uint256(IEscrow.State.Paid), "paid");
    }

    function test_S8_ARealSafeWithTwoOwnersNeitherCompaniesHouseCollects() external {
        address[] memory owners = new address[](2);
        owners[0] = users.amira;
        owners[1] = users.bob; // a recovery key added after the claim
        ISafe payee = _safe(owners);
        IEscrow escrow = _fundedClaimEscrow(address(payee), "two");

        assertTrue(escrow.conditionMet(), "the owner count does not matter (D11)");
        _exec(payee, address(escrow), abi.encodeCall(IEscrow.collect, ()), CALL);
        assertEq(usdc.balanceOf(address(payee)), AMOUNT, "collected");
        assertTrue(payments.paid(escrow.paymentId()), "paid through Payments");
    }

    function test_ES20_AClaimedPayeeCollectsTwoEscrowsInOneBatch() external {
        address[] memory owners = new address[](1);
        owners[0] = users.amira;
        ISafe payee = _safe(owners);
        IEscrow first = _fundedClaimEscrow(address(payee), "first");
        IEscrow second = _fundedClaimEscrow(address(payee), "second");

        Call[] memory calls = new Call[](2);
        calls[0] = Call(address(first), 0, abi.encodeCall(IEscrow.collect, ()));
        calls[1] = Call(address(second), 0, abi.encodeCall(IEscrow.collect, ()));
        _exec(payee, Addresses.MULTI_SEND_CALL_ONLY_141, _multiSend(calls), DELEGATECALL);

        assertEq(usdc.balanceOf(address(payee)), 2 * AMOUNT, "both collected");
        assertEq(uint256(first.state()), uint256(IEscrow.State.Paid), "first paid");
        assertEq(uint256(second.state()), uint256(IEscrow.State.Paid), "second paid");
    }

    // ------------------------------------------------------------------ helpers

    function _fundedClaimEscrow(address payee, string memory job) internal returns (IEscrow escrow) {
        IEscrow.Terms memory terms = IEscrow.Terms({
            ownerSafe: address(companySafe),
            payeeSafe: payee,
            token: address(usdc),
            amount: AMOUNT,
            jobNonce: keccak256(bytes(job)),
            kind: 1,
            documentHash: keccak256("invoice"),
            condition: CLAIM
        });
        escrow = IEscrow(factory.deploy(terms, keccak256(bytes(job))));
        usdc.mint(address(escrow), AMOUNT);
    }

    /// @dev A Safe 1.4.1 with these owners and threshold 1; Amira's key signs for it.
    function _safe(address[] memory owners) internal returns (ISafe) {
        bytes memory init = abi.encodeCall(
            ISafe.setup,
            (
                owners,
                1,
                address(0),
                "",
                Addresses.COMPATIBILITY_FALLBACK_HANDLER_150,
                address(0),
                0,
                payable(address(0))
            )
        );
        return ISafe(
            ISafeProxyFactory(Addresses.SAFE_PROXY_FACTORY_150)
                .createProxyWithNonce(Addresses.SAFE_L2_150, init, ++saltNonce)
        );
    }

    function _exec(ISafe s, address to, bytes memory data, uint8 operation) internal {
        bytes32 txHash = s.getTransactionHash(to, 0, data, operation, 0, 0, 0, address(0), address(0), s.nonce());
        s.execTransaction(to, 0, data, operation, 0, 0, 0, address(0), payable(address(0)), _amiraSign(txHash));
    }
}
