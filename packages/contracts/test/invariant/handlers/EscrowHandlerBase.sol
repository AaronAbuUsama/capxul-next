// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { CommonBase } from "forge-std/Base.sol";
import { StdUtils } from "forge-std/StdUtils.sol";

import { IEscrow } from "../../../src/interfaces/IEscrow.sol";
import { IEscrowFactory } from "../../../src/interfaces/IEscrowFactory.sol";
import { IPayments } from "../../../src/interfaces/IPayments.sol";

import { MockERC20 } from "../../mocks/MockERC20.sol";
import { AuthorityMock } from "../../utils/Escrow/AuthorityMock.sol";
import { OwnerSafeMock } from "../../utils/Escrow/OwnerSafeMock.sol";

/// @notice The escrow handler's state, its model of the spec and its accounting (EscrowHandler drives the actions).
/// The model never reads the escrow's own views for what it checks: who can act (G5) comes from the owner Safe's
/// answer and owners, who may refund (G6, G9) from the authority's answer and admissions, and every payout, collect
/// or refund is accounted from token balances before and after.
abstract contract EscrowHandlerBase is CommonBase, StdUtils {
    struct Ghost {
        uint256 totalIn; // every unit the escrow ever received
        uint256 toSender; // units the escrow sent to its sender
        uint256 toOwner; // units the escrow sent to its owner
        uint256 settlements; // successful payouts and collects that paid the owner
        uint256 closings; // calls that moved the state off Open
    }

    uint256 public constant BUDGET_ID = 7;
    uint256 internal constant MAX_ESCROWS = 16;

    IEscrowFactory public immutable factory;
    IPayments public immutable payments;
    MockERC20 public immutable token;
    AuthorityMock public immutable authority;
    address public immutable sender;
    address public immutable companiesHouse;
    address public immutable eve;
    address public immutable alice;
    address public immutable bob;
    address public immutable jordan;
    address public immutable ben;

    IEscrow[] public escrows;
    OwnerSafeMock[] public owners; // escrows[i].owner() == address(owners[i])
    mapping(IEscrow escrow => Ghost) public ghost;
    /// @dev Who wears the budget's hat now, and who wore it before.
    address public wearer;
    address public formerWearer;

    // Breaches, each false while the spec holds.
    bool public settledAfterClose; // G7
    bool public reopenedOrClosedTwice; // G7: the state left Open at most once, and never came back
    bool public escrowLeftHoldingToken; // G8
    bool public paidSomeoneElse; // G3: a payout, collect or refund moved a token to anyone but owner and sender
    bool public predictionWrong; // G1
    bool public paymentIdPredictionWrong; // G1
    bool public earlyMoneyLostOrMoved; // G2
    bool public paidWithoutConditionOrInexact; // G5, G11: paid the owner other than exactly `amount` once met
    bool public collectByNonOwner; // G4
    bool public ownerCollectRefused; // G4: an owner who can act, open and funded, was refused
    bool public refundByUnadmitted; // G6, G9: a refund by a caller the model does not admit succeeded
    bool public admittedRefundRefused; // G6, G9: an admitted caller was refused while open and refundable
    bool public refundPaidTheWrongSide; // G6: a refund moved money to anyone but the sender
    bool public canRefundDisagrees; // canRefund differs from the model
    bool public invoiceRefundedWhileHeld; // G11
    bool public surplusMisrouted; // ownerTakesSurplus decides who gets the surplus
    bool public executorBypassed; // a claim id was sent by someone but its escrow

    mapping(bytes4 => uint256) public calls;
    mapping(bytes4 => uint256) public successes;
    uint256 internal _nonce;

    struct Actors {
        address eve;
        address alice;
        address bob;
        address jordan;
        address ben;
    }

    constructor(
        IEscrowFactory factory_,
        IPayments payments_,
        MockERC20 token_,
        AuthorityMock authority_,
        address sender_,
        address companiesHouse_,
        Actors memory a
    ) {
        factory = factory_;
        payments = payments_;
        token = token_;
        authority = authority_;
        sender = sender_;
        companiesHouse = companiesHouse_;
        eve = a.eve;
        alice = a.alice;
        bob = a.bob;
        jordan = a.jordan;
        ben = a.ben;
        wearer = a.jordan;
        formerWearer = a.ben;
        authority_.admit(BUDGET_ID, a.jordan);
    }

    /// @dev Setup only: registers an escrow and its owner Safe.
    function add(IEscrow escrow, OwnerSafeMock owner_) external {
        escrows.push(escrow);
        owners.push(owner_);
    }

    function escrowCount() external view returns (uint256) {
        return escrows.length;
    }

    // ------------------------------------------------------------------ the model

    /// @dev G5's model of "the owner can act", from the owner Safe's answer and owners.
    function modelCanAct(IEscrow escrow, OwnerSafeMock o) public view returns (bool) {
        address bootstrap = escrow.bootstrapOwner();
        if (bootstrap == address(0)) return true;
        OwnerSafeMock.Answer answer = o.answer();
        if (answer == OwnerSafeMock.Answer.Word) return o.word() == 0;
        if (answer != OwnerSafeMock.Answer.Owners) return false;
        address[] memory list = o.getOwners();
        for (uint256 i; i < list.length; ++i) {
            if (list[i] == bootstrap) return false;
        }
        return true;
    }

    /// @dev G6's and G9's model of who may refund: the sender, or exactly `true` from the authority now.
    function modelAdmitted(IEscrow escrow, address who) public view returns (bool) {
        if (who == sender) return true;
        if (escrow.authority() == address(0)) return false;
        AuthorityMock.Answer answer = authority.answer();
        if (answer == AuthorityMock.Answer.Word) return authority.word() == 1;
        if (answer != AuthorityMock.Answer.Honest) return false;
        return authority.admitted(escrow.authorityKey(), who);
    }

    struct Snap {
        uint256 escrow;
        uint256 sender;
        uint256 owner;
        uint256 others; // everyone else the handler knows, every other escrow and owner included
    }


    function _snap(IEscrow escrow) internal view returns (Snap memory s) {
        address owner_ = escrow.owner();
        s.escrow = token.balanceOf(address(escrow));
        s.sender = token.balanceOf(sender);
        s.owner = token.balanceOf(owner_);
        address[8] memory people = [eve, alice, bob, jordan, ben, companiesHouse, address(payments), address(authority)];
        for (uint256 i; i < people.length; ++i) {
            s.others += token.balanceOf(people[i]);
        }
        for (uint256 i; i < escrows.length; ++i) {
            if (escrows[i] != escrow) s.others += token.balanceOf(address(escrows[i]));
            if (address(owners[i]) != owner_) s.others += token.balanceOf(address(owners[i]));
        }
    }

    /// @dev G3 and G8 for one payout, collect or refund: the escrow ends empty, and everything it held went to its
    /// owner or its sender, nobody else.
    function _account(IEscrow escrow, Snap memory before, Snap memory after_) internal {
        if (after_.escrow != 0) escrowLeftHoldingToken = true;
        if (after_.others != before.others) paidSomeoneElse = true;
        uint256 toSender = after_.sender - before.sender;
        uint256 toOwner = after_.owner - before.owner;
        if (toSender + toOwner != before.escrow) paidSomeoneElse = true;
        ghost[escrow].toSender += toSender;
        ghost[escrow].toOwner += toOwner;
    }

    /// @dev 0 the sender, 1 the current wearer, 2 the former wearer, 3 the owner, else Eve.
    function _actor(IEscrow escrow, uint8 who) internal view returns (address) {
        uint8 w = who % 6;
        if (w == 0) return sender;
        if (w == 1) return wearer;
        if (w == 2) return formerWearer;
        if (w == 3) return escrow.owner();
        return eve;
    }

    function _indexOf(IEscrow escrow) internal view returns (uint256 i) {
        while (escrows[i] != escrow) ++i;
    }

    function _one(address a) internal pure returns (address[] memory list) {
        list = new address[](1);
        list[0] = a;
    }

    function _pick(uint256 seed) internal view returns (IEscrow) {
        return escrows[seed % escrows.length];
    }
}
