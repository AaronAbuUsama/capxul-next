// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { CommonBase } from "forge-std/Base.sol";
import { StdUtils } from "forge-std/StdUtils.sol";

import { IEscrow } from "../../../src/interfaces/IEscrow.sol";
import { IExits } from "../../../src/interfaces/IExits.sol";
import { IPayments } from "../../../src/interfaces/IPayments.sol";

import { EscrowFactory } from "../../../src/money/EscrowFactory.sol";
import { Payments } from "../../../src/money/Payments.sol";
import { MockBlacklistToken } from "../../utils/Exits/ExitsMocks.sol";

/// @notice Drives one company's exit (invariants.md "Exits.invariant.t.sol": settle with random claim indexes,
/// claim, redirectClaim), plus direct collects from claim escrows and Eve's attacks. Actors: the Board (the
/// company Safe), the Governor, the payees (Amira, Ben, the investor, Alice), Bob and Eve. The sale token
/// blacklists the investor on demand, as USDC can (X4). Every input is bounded and every call is one the
/// rules allow, so `fail_on_revert` holds: a revert is a failure.
contract ExitsHandler is CommonBase, StdUtils {
    uint256 public constant SALE = 1;
    bytes32 public constant TERMS = keccak256("share purchase agreement");
    uint256 internal constant INVESTOR = 2;

    IExits public immutable exits;
    Payments public immutable payments;
    EscrowFactory public immutable factory;
    MockBlacklistToken public immutable token;
    address public immutable safe;
    address public immutable governor;
    address public immutable eve;
    address public immutable bob;

    IExits.Holding[] internal _holdings;

    // Ghosts.
    bool public settled;
    uint256 public settleCalls;
    uint256 public proceeds;
    uint256 public previewSum;
    uint256 public payoutCount;
    mapping(uint256 index => bool) public open; // a claim whose money is still in its escrow
    mapping(uint256 index => uint256) public amountOf;
    mapping(uint256 index => uint256) public paidOut; // claims + collects per index (X4: at most 1)
    uint256 public eveWins;
    uint256 public donatedToExits;

    constructor(
        IExits exits_,
        Payments payments_,
        EscrowFactory factory_,
        MockBlacklistToken token_,
        address safe_,
        address governor_,
        address eve_,
        address bob_,
        IExits.Holding[] memory holdings_
    ) {
        exits = exits_;
        payments = payments_;
        factory = factory_;
        token = token_;
        safe = safe_;
        governor = governor_;
        eve = eve_;
        bob = bob_;
        for (uint256 i; i < holdings_.length; ++i) {
            _holdings.push(holdings_[i]);
        }
    }

    function holdingCount() external view returns (uint256) {
        return _holdings.length;
    }

    // ------------------------------------------------------------------ actions

    /// @dev The Governor approves a sale, the Board pays every payout in one batch (the masked ones and a
    /// blacklisted investor's into claim escrows) and settles. Once per company (X2 closes the Captable).
    function settle(uint256 proceedsSeed, uint8 mask, bool blockInvestor) external {
        if (settled) return;
        ++settleCalls;
        proceeds = bound(proceedsSeed, 1e6, 1e12);
        vm.prank(governor);
        exits.approveSale(SALE, address(token), proceeds, TERMS);
        if (blockInvestor) token.setBlocked(_holdings[INVESTOR].payee, true);

        IExits.Holding[] memory h = _holdings;
        IExits.Payout[] memory p = exits.preview(SALE, h);
        payoutCount = p.length;
        uint256[] memory claims = new uint256[](p.length);
        uint256 nClaims;
        uint256 nItems;
        for (uint256 i; i < p.length; ++i) {
            previewSum += p[i].amount;
            if (p[i].amount == 0) continue;
            ++nItems;
            bool blocked = token.blocked(p[i].payee);
            if (blocked || mask & (1 << i) != 0) claims[nClaims++] = i;
        }
        assembly ("memory-safe") {
            mstore(claims, nClaims)
        }

        IPayments.PaymentItem[] memory items = new IPayments.PaymentItem[](nItems);
        nItems = 0;
        for (uint256 i; i < p.length; ++i) {
            if (p[i].amount == 0) continue;
            bool isClaim = _contains(claims, i);
            address to = isClaim ? exits.predictClaimEscrow(SALE, i, p[i].payee, p[i].amount) : p[i].payee;
            items[nItems++] = _item(i, to, p[i].amount);
            if (isClaim) {
                open[i] = true;
                amountOf[i] = p[i].amount;
            }
        }
        token.mint(safe, proceeds);
        vm.startPrank(safe);
        token.approve(address(payments), proceeds);
        payments.sendBatch(items);
        exits.settle(SALE, h, claims);
        vm.stopPrank();
        settled = true;
    }

    /// @dev The claim's payee takes it to themselves, Bob or a fresh address (never a blacklisted one).
    function claim(uint256 indexSeed, uint256 toSeed) external {
        (bool found, uint256 i) = _pickOpen(indexSeed);
        if (!found) return;
        IExits.Claim memory c = exits.claimOf(SALE, i);
        address[3] memory choices = [c.payee, bob, address(uint160(uint256(keccak256(abi.encode(toSeed)))))];
        address to = choices[toSeed % 3];
        if (token.blocked(to)) to = bob;
        vm.prank(c.payee);
        exits.claim(SALE, i, to);
        open[i] = false;
        ++paidOut[i];
    }

    /// @dev A shareholder vote moves a claim to a new payee (Bob or a fresh address).
    function redirect(uint256 indexSeed, uint256 payeeSeed) external {
        (bool found, uint256 i) = _pickOpen(indexSeed);
        if (!found) return;
        address newPayee = payeeSeed % 2 == 0 ? bob : address(uint160(uint256(keccak256(abi.encode(payeeSeed)))));
        vm.prank(governor);
        exits.redirectClaim(SALE, i, newPayee);
    }

    /// @dev The payee's Safe is claimed and they collect from the escrow directly.
    function collect(uint256 indexSeed) external {
        (bool found, uint256 i) = _pickOpen(indexSeed);
        if (!found) return;
        IExits.Claim memory c = exits.claimOf(SALE, i);
        if (token.blocked(c.payee)) return; // the token refuses them: they must `claim` to another address
        vm.etch(c.payee, hex"00");
        vm.mockCall(c.payee, abi.encodeWithSignature("isOwner(address)", factory.bootstrapOwner()), abi.encode(false));
        vm.prank(c.payee);
        IEscrow(c.escrow).collect();
        open[i] = false;
        ++paidOut[i];
    }

    /// @dev Anyone can transfer tokens to Exits or an open claim escrow without calling either contract.
    function donate(uint256 indexSeed, uint256 amountSeed, bool toExits) external {
        uint256 amount = bound(amountSeed, 1, 1e6);
        address destination = address(exits);
        if (!toExits) {
            (bool found, uint256 i) = _pickOpen(indexSeed);
            if (!found) return;
            destination = exits.claimOf(SALE, i).escrow;
        } else {
            donatedToExits += amount;
        }
        token.mint(eve, amount);
        vm.prank(eve);
        token.transfer(destination, amount);
    }

    /// @dev Eve tries to settle, claim, redirect and refund an escrow; every attempt must fail.
    function attack(uint256 indexSeed) external {
        uint256 i = payoutCount == 0 ? 0 : indexSeed % payoutCount;
        IExits.Holding[] memory h = _holdings;
        bytes[3] memory calls = [
            abi.encodeCall(IExits.claim, (SALE, i, eve)),
            abi.encodeCall(IExits.redirectClaim, (SALE, i, eve)),
            abi.encodeCall(IExits.settle, (SALE, h, new uint256[](0)))
        ];
        for (uint256 k; k < 3; ++k) {
            vm.prank(eve);
            (bool ok,) = address(exits).call(calls[k]);
            if (ok) ++eveWins;
        }
        if (settled && open[i]) {
            vm.prank(eve);
            (bool ok,) = exits.claimOf(SALE, i).escrow.call(abi.encodeCall(IEscrow.refund, ()));
            if (ok) ++eveWins;
        }
    }

    // ------------------------------------------------------------------ helpers

    function _pickOpen(uint256 seed) internal view returns (bool, uint256) {
        if (!settled) return (false, 0);
        for (uint256 k; k < payoutCount; ++k) {
            uint256 i = (seed % payoutCount + k) % payoutCount; // `seed + k` would overflow near 2**256
            if (open[i]) return (true, i);
        }
        return (false, 0);
    }

    function _item(uint256 i, address to, uint256 amount) internal view returns (IPayments.PaymentItem memory it) {
        it = IPayments.PaymentItem({
            paymentId: bytes32(0),
            recipient: to,
            token: address(token),
            amount: amount,
            kind: 8,
            documentHash: TERMS,
            jobNonce: keccak256(abi.encode(address(exits), SALE, i)),
            executor: safe
        });
        it.paymentId = payments.paymentId(it);
    }

    function _contains(uint256[] memory a, uint256 x) internal pure returns (bool) {
        for (uint256 k; k < a.length; ++k) {
            if (a[k] == x) return true;
        }
        return false;
    }
}
