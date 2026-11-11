// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @title IExits
/// @notice A company sale and secondary sales (docs/planning/protocol-v4/spec/exits.md). The
/// shareholders approve a sale (a reserved matter), the buyer pays the company Safe, and one Board batch
/// pays every shareholder by the waterfall (`Payments.sendBatch`, kind 8) and then calls `settle`,
/// which burns every share, ends every option and closes the Captable (X2). One clone per company; the
/// Board check is `msg.sender == safe`.
/// @dev Claims (Q15, M5; 27 October follow-up ruling: refused exit payouts go to Escrow, not Exits).
/// A payout the token would refuse (a blocked address, a reverting contract) or a lost wallet would
/// revert the whole batch (FRM-11). The Board lists that payout's index in `claimIndexes`; its batch
/// item then pays a claim escrow (EscrowFactory, condition "payee claimed", owner this contract, payee
/// the shareholder, kind 8, the sale's terms hash) instead of the shareholder. The shareholder takes it
/// with `collect` on the escrow once their Safe is claimed, or with `claim` here to any address they
/// name; a shareholder vote moves a lost wallet's claim to a new payee with `redirectClaim`. Exits never
/// retains no claim funds after a call: every open claim's money sits in its own escrow. Anyone can donate
/// unrelated tokens to Exits or an escrow; an open escrow holds at least the claim amount if the token
/// cannot reduce balances externally.
/// The Waterfall's `WaterfallDidNotSettle` (IWaterfall) bubbles from `preview` and `settle`; the
/// Captable's `ConsentMissing` and `SharesLocked` bubble from `buy`.
interface IExits {
    /// @notice One shareholder's shares of one class, or one live option grant.
    struct Holding {
        address payee;
        uint8 classId;
        /// @dev True for an option grant (`grantId` set, `classId` its class).
        bool option;
        uint256 grantId;
        uint128 shares;
    }

    /// @notice What one holding receives, index for index with the holdings.
    struct Payout {
        address payee;
        uint256 amount;
    }

    struct Sale {
        address token;
        uint256 proceeds;
        bytes32 termsHash;
        bool settled;
    }

    /// @notice An unpaid exit payout waiting in its escrow.
    struct Claim {
        address payee;
        address escrow;
        address token;
        uint256 amount;
    }

    /// @notice A secondary sale the seller offered.
    struct Transfer {
        address seller;
        address buyer;
        uint8 classId;
        uint128 shares;
        /// @dev Token units per share; the buyer pays `shares * price`.
        uint128 price;
        address token;
        bytes32 documentHash;
        bool approved;
        bool bought;
    }

    event SaleApproved(uint256 indexed saleId, address token, uint256 proceeds, bytes32 termsHash);
    event Settled(uint256 indexed saleId);
    event ClaimRecorded(
        uint256 indexed saleId,
        uint256 indexed index,
        address indexed payee,
        address escrow,
        address token,
        uint256 amount
    );
    event Claimed(uint256 indexed saleId, uint256 indexed index, address to);
    event ClaimRedirected(uint256 indexed saleId, uint256 indexed index, address newPayee, address newEscrow);
    event TransferOffered(
        uint256 indexed transferId,
        address indexed seller,
        address indexed buyer,
        uint8 classId,
        uint128 shares,
        uint128 price,
        address token,
        bytes32 documentHash
    );
    event TransferApproved(uint256 indexed transferId);
    event Bought(uint256 indexed transferId, uint256 amount, bytes32 paymentId);

    error AlreadyInitialized();
    error OnlyGovernor();
    error OnlyBoard();
    error ZeroAddress();
    error SaleExists(uint256 saleId);
    /// @notice The sale token's decimals differ from the 6-decimal price unit (decisions.md J4).
    error InvalidSaleToken(address token);
    error SaleNotApproved();
    error AlreadySettled(uint256 saleId);
    error IncompleteHoldings(uint8 classId);
    error PaymentMissing(uint256 index);
    error ProceedsMismatch(uint256 paid, uint256 proceeds);
    error NoClaim(uint256 saleId, uint256 index);
    error NotPayee();
    error UnknownTransfer();
    error NotSeller();
    error NotApproved();
    error AlreadyBought();
    error NotBuyer();

    /// @notice Sets the clone up once; the implementation cannot be initialised (I3).
    /// @param safe The company Safe (the Board).
    /// @param captable The company's Captable.
    /// @param options The company's Options.
    /// @param vesting The shared Vesting contract.
    /// @param payments The shared Payments contract.
    /// @param governor The company Governor.
    /// @param escrowFactory The shared EscrowFactory that deploys claim escrows.
    function initialize(
        address safe,
        address captable,
        address options,
        address vesting,
        address payments,
        address governor,
        address escrowFactory
    )
        external;

    // ---------------------------------------------------------------------- sales

    /// @notice Records a sale the shareholders approved. Company Governor only; a sale id is used once
    /// (`SaleExists`).
    /// @dev Nonzero proceeds require a nonzero terms hash (`IPayments.ZeroDocumentHash`).
    /// @param saleId The sale's id, chosen in the proposal.
    /// @param token What the buyer pays in.
    /// @param proceeds What the buyer pays, all of it to shareholders.
    /// @param termsHash The sale agreement.
    function approveSale(uint256 saleId, address token, uint256 proceeds, bytes32 termsHash) external;

    /// @notice Runs the waterfall over the Captable's classes and the given holdings.
    /// @dev Reverts `IncompleteHoldings` unless the holdings cover every class's whole supply except the
    /// Safe's own shares (ruling D5) and every live option grant.
    /// @param saleId An approved sale.
    /// @param holdings One entry per shareholder per class, plus one per live option grant.
    /// @return One payout per holding; they add up to the proceeds exactly (X1).
    function preview(uint256 saleId, Holding[] calldata holdings) external view returns (Payout[] memory);

    /// @notice Settles an approved sale, in the same Board batch that paid every payout with
    /// `Payments.sendBatch`. Board only. Recomputes the waterfall; for payout `i` derives the Payments
    /// item (token, amount, kind 8, the sale's terms hash, job nonce `keccak256(abi.encode(exits, saleId,
    /// i))`, executor the Safe) with recipient the payee, or the claim escrow
    /// (`predictClaimEscrow(saleId, i, payee, amount)`) when `i` is in `claimIndexes`, and requires it paid
    /// (`PaymentMissing(i)`). Deploys each claim's escrow and records the claim. Then accelerates the
    /// grants that accelerate on exit, burns every share (the Safe's included), ends every option and
    /// closes the Captable (X2).
    /// @param saleId An approved, unsettled sale.
    /// @param holdings As for `preview`.
    /// @param claimIndexes The payouts paid into claim escrows instead of to their payees.
    function settle(uint256 saleId, Holding[] calldata holdings, uint256[] calldata claimIndexes) external;

    /// @notice The claim's payee takes the claim: Exits refunds the claim escrow to itself and sends the
    /// whole balance, including any surplus, to `to` in the same call, clearing the claim first. Transfers
    /// must be exact or revert with `IPayments.InexactTransfer`.
    /// @dev Reverts `NoClaim` when there is none at the index or the payee already collected from the
    /// escrow directly.
    /// @param saleId The sale.
    /// @param index The payout's index.
    /// @param to Where to send it; the payee may name any nonzero address.
    function claim(uint256 saleId, uint256 index, address to) external;

    /// @notice A shareholder vote names a new payee for a claim (a lost wallet). Company Governor only.
    /// Moves the money from the old claim escrow into a new claim escrow for `newPayee` in the same call,
    /// so the old payee can neither `claim` nor `collect`.
    /// @param saleId The sale.
    /// @param index The payout's index.
    /// @param newPayee The new payee; nonzero.
    function redirectClaim(uint256 saleId, uint256 index, address newPayee) external;

    // ------------------------------------------------------------ secondary sales

    /// @notice A seller offers shares to a buyer. Moves nothing and is not consent: the seller sends it
    /// in one batch from their own Safe with `Captable.consentToTransfer(classId, buyer, shares,
    /// documentHash)` (ruling D3).
    /// @dev Zero shares or price revert `IPayments.ZeroAmount`; a zero document hash reverts
    /// `IPayments.ZeroDocumentHash`.
    /// @param classId The class.
    /// @param buyer The buyer.
    /// @param shares The shares.
    /// @param price Token units per share.
    /// @param token What the buyer pays in.
    /// @param documentHash The sale agreement.
    /// @return transferId The offer.
    function offerTransfer(
        uint8 classId,
        address buyer,
        uint128 shares,
        uint128 price,
        address token,
        bytes32 documentHash
    )
        external
        returns (uint256 transferId);

    /// @notice The Board approves an offered sale. Board only.
    /// @param transferId The offer.
    function approveTransfer(uint256 transferId) external;

    /// @notice The buyer completes an approved sale: pays `shares * price` to the seller through Payments
    /// (kind 5) and receives the shares by `Captable.forcedTransfer` with the document hash as reason,
    /// using up the seller's consent, in the same call.
    /// @param transferId The offer.
    function buy(uint256 transferId) external;

    // ---------------------------------------------------------------------- views

    /// @notice The address of the claim escrow for payout `index`, before it exists, so the Board's batch
    /// can pay it. The escrow's terms bind this contract as owner, `payee`, the sale's token, `amount`,
    /// kind 8 and the sale's terms hash.
    /// @param saleId An approved sale.
    /// @param index The payout's index.
    /// @param payee The payout's payee.
    /// @param amount The payout's amount.
    /// @return The escrow's CREATE2 address.
    function predictClaimEscrow(
        uint256 saleId,
        uint256 index,
        address payee,
        uint256 amount
    )
        external
        view
        returns (address);

    /// @notice A sale.
    /// @param saleId The sale.
    /// @return The sale.
    function sale(uint256 saleId) external view returns (Sale memory);

    /// @notice A claim.
    /// @param saleId The sale.
    /// @param index The payout's index.
    /// @return The claim; a zero payee means none.
    function claimOf(uint256 saleId, uint256 index) external view returns (Claim memory);

    /// @notice A secondary sale.
    /// @param transferId The offer.
    /// @return The offer.
    function transfer(uint256 transferId) external view returns (Transfer memory);
}
