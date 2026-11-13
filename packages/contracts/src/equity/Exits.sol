// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { ICaptable } from "../interfaces/ICaptable.sol";
import { IEscrow } from "../interfaces/IEscrow.sol";
import { IEscrowFactory } from "../interfaces/IEscrowFactory.sol";
import { IExits } from "../interfaces/IExits.sol";
import { IOptions } from "../interfaces/IOptions.sol";
import { IPayments } from "../interfaces/IPayments.sol";
import { IVesting } from "../interfaces/IVesting.sol";
import { IWaterfall } from "../interfaces/IWaterfall.sol";
import { Waterfall } from "../libraries/Waterfall.sol";

/// @title Exits
/// @notice A company sale and secondary sales (spec/exits.md). The shareholders approve a sale, the Board pays
/// every payout in one `Payments.sendBatch` and settles in the same batch: every share is burned, every option
/// ended and the Captable closed (X2). A payout the token would refuse waits in a claim escrow this contract
/// owns (F5), so the Board cannot take it back. Exits retains no claim funds after a call (X3).
/// @dev One EIP-1167 clone per company; the implementation is sealed (I3). Neighbours are the company's own
/// contracts, wired once at `initialize`. Payout `i` is the holdings' `i`: class payouts are split among a
/// class's holdings by shares, the class's rounding remainder to its last holding.
// forge-lint: disable-start(block-timestamp) -- the conversion price is read now; seconds of drift change nothing
// forge-lint: disable-start(reentrancy-events) -- every external call is to this company's own trusted contracts
// forge-lint: disable-start(calls-loop, require-revert-in-loop, uninitialized-local) -- the loops walk one company's holdings and classes; a bad entry aborts the whole call
contract Exits is IExits {
    using SafeERC20 for IERC20;

    /// @dev Payment kinds (architecture.md): 5 share purchase, 8 exit payout.
    uint16 internal constant KIND_SHARE_PURCHASE = 5;
    uint16 internal constant KIND_EXIT = 8;
    /// @dev The sale token's decimals: preferences are priced in 6-decimal units (J4).
    uint8 internal constant PRICE_DECIMALS = 6;
    /// @dev IEscrow.CONDITION_OWNER_COLLECTS.
    uint8 internal constant CONDITION_OWNER_COLLECTS = 1;
    uint256 internal constant BPS = 10_000;

    /// @dev The company Safe (the Board), fixed at `initialize`.
    address internal _safe;
    address internal _captable;
    address internal _options;
    address internal _vesting;
    address internal _payments;
    address internal _governor;
    address internal _escrowFactory;
    bool private _initialized;

    uint256 private _lastTransferId;
    mapping(uint256 saleId => Sale) private _sales;
    mapping(uint256 saleId => mapping(uint256 index => Claim)) private _claims;
    /// @dev How many times a claim was redirected; each redirect gets a fresh escrow address.
    mapping(uint256 saleId => mapping(uint256 index => uint256)) private _redirects;
    mapping(uint256 transferId => Transfer) private _transfers;

    /// @dev The holdings checked against the Captable and Options, and the waterfall's inputs built from them.
    struct Book {
        /// @dev Per Captable class: shares outstanding (the Safe's left out, D5).
        uint256[] outstanding;
        /// @dev Per Captable class: 1 + the index of its last holding, or 0.
        uint256[] lastHolding;
        /// @dev Per Captable class: 1 + its index in `classes`, or 0 when nothing is outstanding.
        uint256[] slot;
        IWaterfall.ClassInput[] classes;
        /// @dev One per option holding, in holdings order.
        IWaterfall.OptionGroup[] groups;
    }

    /// @dev The implementation is sealed (I3); clones start unset.
    constructor() {
        _initialized = true;
    }

    /// @inheritdoc IExits
    function initialize(
        address safe,
        address captable,
        address options,
        address vesting,
        address payments,
        address governor,
        address escrowFactory
    )
        external
    {
        if (_initialized) revert AlreadyInitialized();
        if (
            safe == address(0) || captable == address(0) || options == address(0) || vesting == address(0)
                || payments == address(0) || governor == address(0) || escrowFactory == address(0)
        ) revert ZeroAddress();
        _initialized = true;
        _safe = safe;
        _captable = captable;
        _options = options;
        _vesting = vesting;
        _payments = payments;
        _governor = governor;
        _escrowFactory = escrowFactory;
    }

    // ---------------------------------------------------------------------- sales

    /// @inheritdoc IExits
    function approveSale(uint256 saleId, address token, uint256 proceeds, bytes32 termsHash) external {
        if (msg.sender != _governor) revert OnlyGovernor();
        if (token == address(0)) revert ZeroAddress();
        if (_sales[saleId].token != address(0)) revert SaleExists(saleId);
        if (_decimals(token) != PRICE_DECIMALS) revert InvalidSaleToken(token);
        if (proceeds != 0 && termsHash == bytes32(0)) revert IPayments.ZeroDocumentHash();
        _sales[saleId] = Sale({ token: token, proceeds: proceeds, termsHash: termsHash, settled: false });
        emit SaleApproved(saleId, token, proceeds, termsHash);
    }

    /// @inheritdoc IExits
    function preview(uint256 saleId, Holding[] calldata holdings) external view returns (Payout[] memory) {
        return _payouts(_approved(saleId), holdings);
    }

    /// @inheritdoc IExits
    function settle(uint256 saleId, Holding[] calldata holdings, uint256[] calldata claimIndexes) external {
        if (msg.sender != _safe) revert OnlyBoard();
        Sale memory s = _approved(saleId);
        if (s.settled) revert AlreadySettled(saleId);
        Payout[] memory p = _payouts(s, holdings);
        bool[] memory isClaim = _claimSet(saleId, p, claimIndexes);
        _requirePaid(saleId, s, p, isClaim);

        _sales[saleId].settled = true;
        for (uint256 i; i < p.length; ++i) {
            if (!isClaim[i]) continue;
            address escrow = IEscrowFactory(_escrowFactory)
                .deploy(_terms(saleId, i, p[i].payee, p[i].amount, s, 0), _salt(saleId, i, 0));
            _claims[saleId][i] = Claim({ payee: p[i].payee, escrow: escrow, token: s.token, amount: p[i].amount });
            emit ClaimRecorded(saleId, i, p[i].payee, escrow, s.token, p[i].amount);
        }
        _closeOut(holdings);
        emit Settled(saleId);
    }

    /// @inheritdoc IExits
    function claim(uint256 saleId, uint256 index, address to) external {
        Claim memory c = _openClaim(saleId, index);
        if (msg.sender != c.payee) revert NotPayee();
        // Exits itself or the claim's own escrow would strand the money (X3): refused like the zero address.
        if (to == address(0) || to == address(this) || to == c.escrow) revert ZeroAddress();
        delete _claims[saleId][index];
        emit Claimed(saleId, index, to);
        _sendExact(c.token, to, _takeBack(c));
    }

    /// @inheritdoc IExits
    function redirectClaim(uint256 saleId, uint256 index, address newPayee) external {
        if (msg.sender != _governor) revert OnlyGovernor();
        Claim memory c = _openClaim(saleId, index);
        // Exits or the old escrow as payee could never claim or collect: refused like the zero address.
        if (newPayee == address(0) || newPayee == address(this) || newPayee == c.escrow) revert ZeroAddress();
        uint256 round = ++_redirects[saleId][index];
        IEscrow.Terms memory terms = _terms(saleId, index, newPayee, c.amount, _sales[saleId], round);
        bytes32 salt = _salt(saleId, index, round);
        IEscrowFactory factory = IEscrowFactory(_escrowFactory);
        address escrow = factory.predictAddress(terms, salt);
        _claims[saleId][index] = Claim({ payee: newPayee, escrow: escrow, token: c.token, amount: c.amount });
        emit ClaimRedirected(saleId, index, newPayee, escrow);
        // forge-lint: disable-next-line(unused-return) -- the address was predicted and recorded above
        factory.deploy(terms, salt);
        _sendExact(c.token, escrow, _takeBack(c));
    }

    // ------------------------------------------------------------ secondary sales

    /// @inheritdoc IExits
    function offerTransfer(
        uint8 classId,
        address buyer,
        uint128 shares,
        uint128 price,
        address token,
        bytes32 documentHash
    )
        external
        returns (uint256 transferId)
    {
        if (buyer == address(0) || token == address(0)) revert ZeroAddress();
        if (shares == 0 || price == 0) revert IPayments.ZeroAmount();
        if (documentHash == bytes32(0)) revert IPayments.ZeroDocumentHash();
        transferId = ++_lastTransferId;
        _transfers[transferId] = Transfer({
            seller: msg.sender,
            buyer: buyer,
            classId: classId,
            shares: shares,
            price: price,
            token: token,
            documentHash: documentHash,
            approved: false,
            bought: false
        });
        emit TransferOffered(transferId, msg.sender, buyer, classId, shares, price, token, documentHash);
    }

    /// @inheritdoc IExits
    function approveTransfer(uint256 transferId) external {
        if (msg.sender != _safe) revert OnlyBoard();
        Transfer storage t = _transfers[transferId];
        if (t.seller == address(0)) revert UnknownTransfer();
        if (t.bought) revert AlreadyBought();
        t.approved = true;
        emit TransferApproved(transferId);
    }

    /// @inheritdoc IExits
    /// @dev Pulls the price from the buyer and pays it on through Payments in the same call (X3).
    function buy(uint256 transferId) external {
        Transfer memory t = _transfers[transferId];
        if (t.seller == address(0)) revert UnknownTransfer();
        if (msg.sender != t.buyer) revert NotBuyer();
        if (!t.approved) revert NotApproved();
        if (t.bought) revert AlreadyBought();
        _transfers[transferId].bought = true;

        uint256 amount = uint256(t.shares) * t.price;
        IPayments.PaymentItem memory item = IPayments.PaymentItem({
            paymentId: bytes32(0),
            recipient: t.seller,
            token: t.token,
            amount: amount,
            kind: KIND_SHARE_PURCHASE,
            documentHash: t.documentHash,
            jobNonce: keccak256(abi.encode(address(this), transferId)),
            executor: address(this)
        });
        IPayments payments = IPayments(_payments);
        item.paymentId = payments.paymentId(item);
        IERC20 token = IERC20(t.token);
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 funded = token.balanceOf(address(this));
        uint256 received = funded >= before ? funded - before : 0;
        if (received != amount) revert IPayments.InexactTransfer(t.token, amount, received);
        token.forceApprove(address(payments), amount);
        payments.send(item);
        uint256 after_ = token.balanceOf(address(this));
        if (after_ != before) {
            uint256 spent = funded >= after_ ? funded - after_ : 0;
            revert IPayments.InexactTransfer(t.token, amount, spent);
        }
        ICaptable(_captable).forcedTransfer(t.classId, t.seller, t.buyer, t.shares, t.documentHash);
        emit Bought(transferId, amount, item.paymentId);
    }

    // ---------------------------------------------------------------------- views

    /// @inheritdoc IExits
    function predictClaimEscrow(
        uint256 saleId,
        uint256 index,
        address payee,
        uint256 amount
    )
        external
        view
        returns (address)
    {
        Sale memory s = _approved(saleId);
        return IEscrowFactory(_escrowFactory)
            .predictAddress(_terms(saleId, index, payee, amount, s, 0), _salt(saleId, index, 0));
    }

    /// @inheritdoc IExits
    function sale(uint256 saleId) external view returns (Sale memory) {
        return _sales[saleId];
    }

    /// @inheritdoc IExits
    function claimOf(uint256 saleId, uint256 index) external view returns (Claim memory) {
        return _claims[saleId][index];
    }

    /// @inheritdoc IExits
    function transfer(uint256 transferId) external view returns (Transfer memory) {
        return _transfers[transferId];
    }

    // ------------------------------------------------------------------ internals

    function _approved(uint256 saleId) private view returns (Sale memory s) {
        s = _sales[saleId];
        if (s.token == address(0)) revert SaleNotApproved();
    }

    /// @dev A token without `decimals` (no code, a revert, short or out-of-range return data) reads as 0, so it is
    /// refused like any other wrong unit. A low-level call, because `try` cannot catch a failed decode.
    function _decimals(address token) private view returns (uint256) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeCall(IERC20Metadata.decimals, ()));
        if (!ok || data.length < 32) return 0;
        uint256 d = abi.decode(data, (uint256));
        return d > type(uint8).max ? 0 : d;
    }

    /// @dev The waterfall's payouts, one per holding; they add up to the proceeds exactly (X1).
    function _payouts(Sale memory s, Holding[] calldata holdings) private view returns (Payout[] memory p) {
        Book memory book = _book(holdings);
        IWaterfall.Result memory r = Waterfall.compute(s.proceeds, book.classes, book.groups);

        p = new Payout[](holdings.length);
        uint256[] memory given = new uint256[](book.outstanding.length);
        uint256 group;
        uint256 total;
        for (uint256 i; i < holdings.length; ++i) {
            Holding calldata h = holdings[i];
            uint256 amount;
            if (h.option) {
                amount = r.optionPayouts[group++];
            } else if (book.slot[h.classId] != 0) {
                uint256 classPayout = r.classPayouts[book.slot[h.classId] - 1];
                amount = book.lastHolding[h.classId] == i + 1
                    ? classPayout - given[h.classId]
                    : Math.mulDiv(classPayout, h.shares, book.outstanding[h.classId]);
                given[h.classId] += amount;
            }
            p[i] = Payout({ payee: h.payee, amount: amount });
            total += amount;
        }
        if (total != s.proceeds) revert ProceedsMismatch(total, s.proceeds);
    }

    /// @dev Checks the holdings cover every class's outstanding shares and every live option grant exactly, once
    /// each, and builds the waterfall's inputs.
    function _book(Holding[] calldata holdings) private view returns (Book memory book) {
        ICaptable captable = ICaptable(_captable);
        uint8 n = captable.numberOfClasses();
        book.outstanding = new uint256[](n);
        book.lastHolding = new uint256[](n);
        book.slot = new uint256[](n);
        IERC20[] memory tokens = new IERC20[](n);
        for (uint8 c; c < n; ++c) {
            tokens[c] = IERC20(address(captable.getClass(c).token));
            book.outstanding[c] = tokens[c].totalSupply() - tokens[c].balanceOf(_safe);
        }

        IOptions options = IOptions(_options);
        uint8 optionClass = options.classId();
        uint256[] memory listed = new uint256[](n);
        uint256 optionShares;
        uint256 groups;
        for (uint256 i; i < holdings.length; ++i) {
            Holding calldata h = holdings[i];
            if (h.option) {
                if (h.classId != optionClass || h.payee == address(0) || _listedBefore(holdings, i)) {
                    revert IncompleteHoldings(optionClass);
                }
                optionShares += h.shares;
                ++groups;
            } else {
                if (h.classId >= n) revert IncompleteHoldings(h.classId);
                if (
                    // forge-lint: disable-next-line(incorrect-strict-equality) -- a holding is the payee's whole balance
                    h.payee == address(0) || h.payee == _safe || h.shares != tokens[h.classId].balanceOf(h.payee)
                        || _listedBefore(holdings, i)
                ) {
                    revert IncompleteHoldings(h.classId);
                }
                listed[h.classId] += h.shares;
                book.lastHolding[h.classId] = i + 1;
            }
        }
        for (uint8 c; c < n; ++c) {
            if (listed[c] != book.outstanding[c]) revert IncompleteHoldings(c);
        }
        if (optionShares != options.allocated()) revert IncompleteHoldings(optionClass);

        book.groups = _groups(holdings, options, groups);
        book.classes = _classes(captable, book);
    }

    /// @dev One option group per option holding, each the grant's live unexercised options at its strike. An ended
    /// grant keeps only what had vested at its end (the rest went back to the pool and left `allocated`), the
    /// same count `Options.lapse` returns.
    function _groups(
        Holding[] calldata holdings,
        IOptions options,
        uint256 count
    )
        private
        view
        returns (IWaterfall.OptionGroup[] memory groups)
    {
        groups = new IWaterfall.OptionGroup[](count);
        uint256 k;
        for (uint256 i; i < holdings.length; ++i) {
            Holding calldata h = holdings[i];
            if (!h.option) continue;
            IOptions.OptionGrant memory g = options.getGrant(h.grantId);
            uint128 live = g.endedAt == 0 ? g.shares : options.vestedOf(h.grantId, g.endedAt);
            if (g.grantee != h.payee || g.cancelled || live - g.exercised != h.shares) {
                revert IncompleteHoldings(h.classId);
            }
            groups[k++] = IWaterfall.OptionGroup({ shares: h.shares, strike: g.strikePrice });
        }
    }

    /// @dev One waterfall class per Captable class with shares outstanding, with its terms.
    function _classes(
        ICaptable captable,
        Book memory book
    )
        private
        view
        returns (IWaterfall.ClassInput[] memory classes)
    {
        uint256 count;
        for (uint256 c; c < book.outstanding.length; ++c) {
            if (book.outstanding[c] != 0) book.slot[c] = ++count;
        }
        classes = new IWaterfall.ClassInput[](count);
        for (uint8 c; c < book.outstanding.length; ++c) {
            if (book.slot[c] == 0) continue;
            ICaptable.Class memory k = captable.getClass(c);
            uint256 shares = book.outstanding[c];
            uint256 asConverted = shares;
            uint256 preference;
            if (k.originalIssuePrice != 0) {
                uint128 conversionPrice = captable.conversionPriceAt(c, block.timestamp);
                if (conversionPrice != 0) asConverted = Math.mulDiv(shares, k.originalIssuePrice, conversionPrice);
                preference = Math.mulDiv(shares * k.originalIssuePrice, k.preferenceMultipleBps, BPS);
            }
            classes[book.slot[c] - 1] = IWaterfall.ClassInput({
                classId: c,
                asConvertedShares: asConverted,
                preference: preference,
                participating: k.participating,
                seniority: k.seniority
            });
        }
    }

    /// @dev Whether holding `i` repeats an earlier one: the same grant, or the same shareholder in the same class.
    function _listedBefore(Holding[] calldata holdings, uint256 i) private pure returns (bool) {
        Holding calldata h = holdings[i];
        for (uint256 j; j < i; ++j) {
            Holding calldata e = holdings[j];
            if (e.option != h.option) continue;
            if (h.option ? e.grantId == h.grantId : (e.payee == h.payee && e.classId == h.classId)) return true;
        }
        return false;
    }

    /// @dev The claim indexes as a set: each names a nonzero payout, once.
    function _claimSet(
        uint256 saleId,
        Payout[] memory p,
        uint256[] calldata claimIndexes
    )
        private
        pure
        returns (bool[] memory isClaim)
    {
        isClaim = new bool[](p.length);
        for (uint256 k; k < claimIndexes.length; ++k) {
            uint256 i = claimIndexes[k];
            if (i >= p.length || p[i].amount == 0 || isClaim[i]) revert NoClaim(saleId, i);
            isClaim[i] = true;
        }
    }

    /// @dev Requires every nonzero payout paid by the Board's batch, item exactly as the spec derives it.
    function _requirePaid(uint256 saleId, Sale memory s, Payout[] memory p, bool[] memory isClaim) private view {
        IPayments payments = IPayments(_payments);
        IEscrowFactory factory = IEscrowFactory(_escrowFactory);
        for (uint256 i; i < p.length; ++i) {
            if (p[i].amount == 0) continue;
            address recipient = isClaim[i]
                ? factory.predictAddress(_terms(saleId, i, p[i].payee, p[i].amount, s, 0), _salt(saleId, i, 0))
                : p[i].payee;
            IPayments.PaymentItem memory item = IPayments.PaymentItem({
                paymentId: bytes32(0),
                recipient: recipient,
                token: s.token,
                amount: p[i].amount,
                kind: KIND_EXIT,
                documentHash: s.termsHash,
                jobNonce: keccak256(abi.encode(address(this), saleId, i)),
                executor: _safe
            });
            if (!payments.paid(payments.paymentId(item))) revert PaymentMissing(i);
        }
    }

    /// @dev Accelerates the grants that accelerate on exit, burns every share (the Safe's included), ends every
    /// option and closes the Captable (X2).
    function _closeOut(Holding[] calldata holdings) private {
        ICaptable captable = ICaptable(_captable);
        IVesting vesting = IVesting(_vesting);
        for (uint256 i; i < holdings.length; ++i) {
            if (holdings[i].option) continue;
            uint256 grantId = vesting.grantOf(address(captable), holdings[i].classId, holdings[i].payee);
            if (grantId != 0) vesting.accelerateForExit(grantId);
        }
        for (uint256 i; i < holdings.length; ++i) {
            Holding calldata h = holdings[i];
            if (!h.option && h.shares != 0) captable.burnForExit(h.classId, h.payee, h.shares);
        }
        uint8 n = captable.numberOfClasses();
        for (uint8 c; c < n; ++c) {
            uint256 own = IERC20(address(captable.getClass(c).token)).balanceOf(_safe);
            if (own != 0) captable.burnForExit(c, _safe, SafeCast.toUint128(own));
        }
        IOptions(_options).endAllForExit();
        captable.closeForExit();
    }

    /// @dev An open claim: recorded, and its escrow not yet collected or refunded.
    function _openClaim(uint256 saleId, uint256 index) private view returns (Claim memory c) {
        c = _claims[saleId][index];
        if (c.payee == address(0) || IEscrow(c.escrow).state() != IEscrow.State.Open) revert NoClaim(saleId, index);
    }

    /// @dev Refunds a claim escrow to Exits and returns what arrived, to be sent on in the same call (X3).
    function _takeBack(Claim memory c) private returns (uint256) {
        IERC20 token = IERC20(c.token);
        uint256 before = token.balanceOf(address(this));
        uint256 expected = token.balanceOf(c.escrow);
        IEscrow(c.escrow).refund();
        uint256 after_ = token.balanceOf(address(this));
        uint256 received = after_ >= before ? after_ - before : 0;
        if (received != expected || received < c.amount) {
            revert IPayments.InexactTransfer(c.token, expected < c.amount ? c.amount : expected, received);
        }
        return received;
    }

    /// @dev A token that changes its transfer rules must not short a claim or use Exits' other funds.
    function _sendExact(address tokenAddress, address to, uint256 amount) private {
        IERC20 token = IERC20(tokenAddress);
        uint256 senderBefore = token.balanceOf(address(this));
        uint256 before = token.balanceOf(to);
        token.safeTransfer(to, amount);
        uint256 after_ = token.balanceOf(to);
        uint256 received = after_ >= before ? after_ - before : 0;
        if (received != amount) revert IPayments.InexactTransfer(tokenAddress, amount, received);
        uint256 senderAfter = token.balanceOf(address(this));
        uint256 spent = senderBefore >= senderAfter ? senderBefore - senderAfter : 0;
        if (spent != amount) revert IPayments.InexactTransfer(tokenAddress, amount, spent);
    }

    /// @dev A claim escrow's terms: sent by Exits (F5) to the payee, the sale's token and terms, kind 8, owner-collects
    /// once Companies House no longer owns the payee, and the surplus to the payee. `round` counts redirects, so a
    /// redirected claim always gets a fresh escrow.
    function _terms(
        uint256 saleId,
        uint256 index,
        address payee,
        uint256 amount,
        Sale memory s,
        uint256 round
    )
        private
        view
        returns (IEscrow.Terms memory)
    {
        return IEscrow.Terms({
            owner: payee,
            sender: address(this),
            authority: address(0),
            authorityKey: 0,
            bootstrapOwner: IEscrowFactory(_escrowFactory).bootstrapOwner(),
            token: s.token,
            amount: amount,
            jobNonce: _salt(saleId, index, round),
            kind: KIND_EXIT,
            documentHash: s.termsHash,
            condition: CONDITION_OWNER_COLLECTS,
            ownerTakesSurplus: true
        });
    }

    function _salt(uint256 saleId, uint256 index, uint256 round) private view returns (bytes32) {
        return keccak256(abi.encode(address(this), saleId, index, round));
    }
}
