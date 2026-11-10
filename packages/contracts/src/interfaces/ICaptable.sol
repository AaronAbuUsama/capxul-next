// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC5805 } from "@openzeppelin/contracts/interfaces/IERC5805.sol";

import { IShareClass } from "./IShareClass.sol";

/// @title ICaptable
/// @notice One registry per company holding every share class (spec/captable.md). Each class is its own
/// ERC20Votes token (IShareClass) with a voting weight, an authorised amount, a transfer rule, an optional
/// conversion target and its economic terms on chain (Q14). The Captable answers the company's weighted,
/// as-converted votes on the timestamp clock (IERC5805) for the Governor. Ported from Firm `Captable.sol`.
/// @dev The Board check everywhere is `msg.sender == safe()`. Reserved matters are the company Governor's (E2).
interface ICaptable is IERC5805 {
    /// @notice Who may receive a class's shares in an ordinary transfer (Q10: `DenyAll` is the default).
    enum TransferRule {
        DenyAll,
        AllowAll,
        ToClassShareholders,
        ToAnyShareholder,
        Custom
    }

    /// @notice A share class as stored.
    struct Class {
        IShareClass token; // its ERC20Votes clone
        uint16 weight; // votes per as-converted share: 0, 1, 10 ...
        uint8 convertsInto; // a class id, or NONE()
        TransferRule rule;
        address customRule; // the rule contract when rule == Custom, never zero then
        address classGovernor; // its class Governor, or zero (ruling D6)
        bool frozen; // no further change to authorised or rule, ever
        uint128 authorised;
        uint128 originalIssuePrice; // PRICE_DECIMALS (6, USD); 0 for Common
        uint128 conversionFloorPrice; // anti-dilution floor; > 0 when originalIssuePrice > 0
        uint128 preferenceMultipleBps; // 10,000 = 1x; 0 for Common
        bool participating;
        uint8 seniority; // 0 is most senior; equal ranks are pari passu
        bytes32 termsHash; // the class's full terms document
    }

    /// @notice The terms of a class to create. The class Governor is set later, by `setClassGovernor`.
    struct ClassParams {
        string name; // the class's name; the token is named "<company> <name>"
        string ticker; // the token's symbol
        uint16 weight;
        uint8 convertsInto;
        TransferRule rule;
        address customRule;
        uint128 authorised;
        uint128 originalIssuePrice;
        uint128 conversionFloorPrice;
        uint128 preferenceMultipleBps;
        bool participating;
        uint8 seniority;
        bytes32 termsHash;
    }

    /// @notice The fixed addresses a Captable is wired to at `initialize`. None may be zero.
    struct Wiring {
        address safe; // the company Safe, which is the Board
        address governor; // the company Governor
        address vesting;
        address options;
        address rounds;
        address exits;
        address shareClassImpl; // the ShareClass implementation each class clones
    }

    // ------------------------------------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------------------------------------

    /// @notice A class was created with every term in `params` (name, ticker, weight, convertsInto, rule,
    /// customRule, authorised, original issue price, floor, preference, participation, seniority, terms hash).
    /// @dev The terms travel as one tuple: thirteen flat fields are "stack too deep" to emit without via-IR.
    event ClassCreated(uint8 indexed classId, address indexed token, ClassParams params);

    /// @notice A class's authorised amount was set.
    event AuthorisedSet(uint8 indexed classId, uint128 authorised);

    /// @notice A class's transfer rule was changed.
    event TransferRuleSet(uint8 indexed classId, TransferRule rule, address customRule);

    /// @notice A class was frozen: its authorised amount and transfer rule can never change again.
    event ClassFrozen(uint8 indexed classId);

    /// @notice A class Governor was set for a class (once per class).
    event ClassGovernorSet(uint8 indexed classId, address indexed classGovernor);

    /// @notice Shares were issued.
    event Issued(uint8 indexed classId, address indexed to, uint128 amount, bytes32 reason);

    /// @notice A shareholder converted `amount` shares of `fromClassId` into `minted` shares of `toClassId`.
    event Converted(
        address indexed shareholder, uint8 indexed fromClassId, uint8 indexed toClassId, uint128 amount, uint128 minted
    );

    /// @notice A shareholder consented to one forced transfer of their shares (ruling D3).
    event TransferConsented(
        bytes32 indexed consentId,
        uint8 indexed classId,
        address indexed from,
        address to,
        uint128 amount,
        bytes32 reason
    );

    /// @notice Shares were moved past the transfer rule by a voted or consented forced transfer (ruling D3).
    event ForcedTransfer(
        uint8 indexed classId, address indexed from, address indexed to, uint128 amount, bytes32 reason
    );

    /// @notice A class's conversion price was lowered (E4).
    event ConversionPriceSet(uint8 indexed classId, uint128 price);

    /// @notice A module's issuer allowance on a class was replaced.
    event IssuerAllowanceSet(address indexed module, uint8 indexed classId, uint128 amount);

    /// @notice Vesting burned a shareholder's unvested shares back into the authorised headroom.
    event BurnedUnvested(uint8 indexed classId, address indexed from, uint128 amount);

    /// @notice Exits burned a shareholder's shares at an approved sale.
    event BurnedForExit(uint8 indexed classId, address indexed from, uint128 amount);

    /// @notice The Captable was closed at an approved sale; nothing can be issued again.
    event ClosedForExit();

    // ------------------------------------------------------------------------------------------------
    // Errors (errors and events never share a name)
    // ------------------------------------------------------------------------------------------------

    error AlreadyInitialized();
    error OnlyBoard();
    error OnlyGovernor();
    error OnlyModule();
    error UnknownClass(uint8 classId);
    error TooManyClasses();
    error FrozenClass(uint8 classId);
    error ZeroAmount();
    error AuthorisedExceeded(uint8 classId, uint128 authorised, uint128 issued, uint128 amount);
    error IssuerAllowanceExceeded(address module, uint8 classId, uint128 left, uint128 amount);
    error ProposalPending(uint8 classId, uint48 until);
    error VotesBoundExceeded(uint8 classId);
    error TransferNotAllowed(uint8 classId, address from, address to);
    error SharesLocked(address account, uint128 locked);
    error ConsentMissing();
    error NotConvertible(uint8 classId);
    error ConversionPriceNotLower(uint128 current, uint128 requested);
    error BelowFloor(uint128 floor, uint128 requested);
    error ZeroReason();
    error CaptableClosed();
    error InvalidClass(string reason);
    /// @notice `delegate` and `delegateBySig` on the Captable: delegate on each class token instead.
    error DelegateOnClassToken();

    // ------------------------------------------------------------------------------------------------
    // Constants and wiring
    // ------------------------------------------------------------------------------------------------

    /// @notice At most 32 classes per company: the 32nd succeeds, the 33rd reverts `TooManyClasses`.
    function MAX_CLASSES() external view returns (uint8);

    /// @notice The bound on `weight * authorised * ratioMax` for every class: 2**200 (N-4, E9).
    function MAX_CLASS_VOTES() external view returns (uint256);

    /// @notice Decimals of every price (original issue, conversion, floor): 6.
    function PRICE_DECIMALS() external view returns (uint8);

    /// @notice The gas a `Custom` transfer rule contract is given; running out is `TransferNotAllowed` (C-28).
    function CUSTOM_RULE_GAS() external view returns (uint256);

    /// @notice The `convertsInto` value of a class that converts into nothing: `type(uint8).max`.
    function NONE() external view returns (uint8);

    /// @notice The company's name; each class token is named "<name> <class name>".
    function name() external view returns (string memory);

    /// @notice The company Safe, which is the Board.
    function safe() external view returns (address);

    /// @notice The company Governor, which decides reserved matters.
    function governor() external view returns (address);

    /// @notice The shared Vesting contract.
    function vesting() external view returns (address);

    /// @notice The company's Options clone.
    function options() external view returns (address);

    /// @notice The company's Rounds clone.
    function rounds() external view returns (address);

    /// @notice The company's Exits clone.
    function exits() external view returns (address);

    /// @notice The ShareClass implementation each class clones.
    function shareClassImpl() external view returns (address);

    // ------------------------------------------------------------------------------------------------
    // Setup and reserved matters (the company Governor)
    // ------------------------------------------------------------------------------------------------

    /// @notice Sets the wiring once and creates the template's initial classes with the same checks as
    /// `createClass` (a new company has no shareholders to vote them in). The implementation cannot be
    /// initialised (N-6). Reverts `AlreadyInitialized` on a second call and `InvalidClass` if any wiring
    /// address is zero.
    /// @param companyName The company's name, the prefix of every class token's name.
    /// @param wiring The fixed addresses.
    /// @param initialClasses The template's classes, created in order with ids 0, 1, ...
    function initialize(
        string calldata companyName,
        Wiring calldata wiring,
        ClassParams[] calldata initialClasses
    )
        external;

    /// @notice Creates a class and its ShareClass clone, with its first conversion price equal to its
    /// original issue price. Only the company Governor. Emits `ClassCreated`.
    /// @param p The class's terms.
    /// @return classId The new class's id (the number of classes before the call).
    function createClass(ClassParams calldata p) external returns (uint8 classId);

    /// @notice Sets a class's authorised amount. Only the company Governor; refuses a frozen class, an amount
    /// below issued plus convertible reserve (E1), the vote bound (E9), and E1 in the conversion target.
    /// Emits `AuthorisedSet`.
    /// @param classId The class.
    /// @param amount The new authorised amount.
    function setAuthorised(uint8 classId, uint128 amount) external;

    /// @notice Sets a class's transfer rule. Only the company Governor; refuses a frozen class, and `Custom`
    /// with a zero rule contract. Emits `TransferRuleSet`.
    /// @param classId The class.
    /// @param rule The rule.
    /// @param customRule The rule contract when `rule == Custom`; ignored otherwise.
    function setTransferRule(uint8 classId, TransferRule rule, address customRule) external;

    /// @notice Freezes a class forever: no further change to its authorised amount or transfer rule.
    /// Issuance and conversion continue. Only the company Governor. Emits `ClassFrozen`.
    /// @param classId The class.
    function freeze(uint8 classId) external;

    /// @notice Sets a class's class Governor, once per class; from then on issuance in the class also waits
    /// for that Governor's pending window (ruling D6). Only the company Governor. Emits `ClassGovernorSet`.
    /// @param classId The class.
    /// @param classGovernor_ The class Governor, never zero.
    function setClassGovernor(uint8 classId, address classGovernor_) external;

    /// @notice Moves a shareholder's unlocked shares past the transfer rule (ruling D3). The company Governor
    /// may (a passed vote); the Safe or Exits may only with `from`'s recorded consent for exactly these terms,
    /// which this uses up (`ConsentMissing`); anyone else reverts `OnlyBoard`. Never moves locked shares
    /// (`SharesLocked`).
    /// Emits `ForcedTransfer`.
    /// @param classId The class.
    /// @param from The shareholder.
    /// @param to The receiver.
    /// @param amount The shares to move.
    /// @param reason The document hash, never zero (`ZeroReason`).
    function forcedTransfer(uint8 classId, address from, address to, uint128 amount, bytes32 reason) external;

    // ------------------------------------------------------------------------------------------------
    // Shareholders
    // ------------------------------------------------------------------------------------------------

    /// @notice Records the caller's consent to one forced transfer of their own shares, with id
    /// `keccak256(abi.encode(classId, msg.sender, to, amount, reason))` (ruling D3). Moves no shares. Reverts
    /// `UnknownClass`, `ZeroReason` and `ZeroAmount`.
    /// Emits `TransferConsented`.
    /// @param classId The class.
    /// @param to The receiver the shareholder agrees to.
    /// @param amount The shares, never 0.
    /// @param reason The document hash, never zero.
    function consentToTransfer(uint8 classId, address to, uint128 amount, bytes32 reason) external;

    /// @notice Converts the caller's unlocked shares into the class's conversion target: burns `amount`,
    /// lowers the source's authorised by `amount` (N-5, E10), and mints
    /// `amount * originalIssuePrice / conversionPriceAt(now)` rounded down in the target. Works on a frozen
    /// source and while a proposal is pending. Emits `Converted`.
    /// @param classId The source class.
    /// @param amount The shares to convert.
    function convert(uint8 classId, uint128 amount) external;

    // ------------------------------------------------------------------------------------------------
    // The Board and modules
    // ------------------------------------------------------------------------------------------------

    /// @notice Issues new shares. The Safe, or a module whose issuer allowance covers `amount` (then
    /// lowered). Refuses 0 (`ZeroAmount`), a closed Captable (`CaptableClosed`), a voting class or a class
    /// with a class Governor while a proposal is pending (`ProposalPending`, ruling D6), and E1
    /// (`AuthorisedExceeded`). Shares issued to the Safe carry no votes (D5). Emits `Issued`.
    /// @param classId The class.
    /// @param to The receiver.
    /// @param amount The shares.
    /// @param reason The document hash.
    function issue(uint8 classId, address to, uint128 amount, bytes32 reason) external;

    /// @notice Replaces a module's issuer allowance on a class. Only the Safe; `module` must be Options,
    /// Rounds or Vesting (`OnlyModule`). Emits `IssuerAllowanceSet`.
    /// @param module The module.
    /// @param classId The class.
    /// @param amount The new allowance.
    function setIssuerAllowance(address module, uint8 classId, uint128 amount) external;

    /// @notice Lowers a priced class's conversion price, checkpointed at `block.timestamp`. Only the company
    /// Governor or Rounds (27 Oct ruling: never the Board alone), else `OnlyGovernor`; a class with no issue price reverts `NotConvertible`; only lower
    /// (`ConversionPriceNotLower`) and never below the floor (`BelowFloor`) (E4).
    /// Emits `ConversionPriceSet`.
    /// @param classId The class.
    /// @param price The new price.
    function setConversionPrice(uint8 classId, uint128 price) external;

    /// @notice Burns a shareholder's unvested shares back into the authorised headroom. Only Vesting.
    /// Emits `BurnedUnvested`.
    /// @param classId The class.
    /// @param from The shareholder.
    /// @param amount The shares.
    function burnUnvested(uint8 classId, address from, uint128 amount) external;

    /// @notice Burns a shareholder's shares at a sale the Governor approved. Only Exits. Emits `BurnedForExit`.
    /// @param classId The class.
    /// @param from The shareholder (the Safe included).
    /// @param amount The shares.
    function burnForExit(uint8 classId, address from, uint128 amount) external;

    /// @notice Closes the Captable at an approved sale; nothing can be issued afterwards. Only Exits.
    /// Emits `ClosedForExit`.
    function closeForExit() external;

    /// @notice Called by a class token before every transfer between two nonzero addresses that is not a
    /// Captable operation. Reverts `SharesLocked` if the amount would dip into the sender's locked shares
    /// (never panics when `amount > balance`), then `TransferNotAllowed` unless the class rule allows it.
    /// Reverts `OnlyModule` unless the caller is the class's token.
    /// @param classId The class.
    /// @param from The sender.
    /// @param to The receiver.
    /// @param amount The shares.
    function checkTransfer(uint8 classId, address from, address to, uint256 amount) external view;

    // ------------------------------------------------------------------------------------------------
    // Reads
    // ------------------------------------------------------------------------------------------------

    /// @notice The number of classes; class ids run from 0 to this minus 1.
    /// @return The number of classes.
    function numberOfClasses() external view returns (uint8);

    /// @notice A class as stored. Reverts `UnknownClass`.
    /// @param classId The class.
    /// @return The class.
    function getClass(uint8 classId) external view returns (Class memory);

    /// @notice A class's conversion price at a timepoint (its original issue price before any change).
    /// Reverts `UnknownClass`.
    /// @param classId The class.
    /// @param timepoint A timestamp, now or in the past.
    /// @return The conversion price.
    function conversionPriceAt(uint8 classId, uint256 timepoint) external view returns (uint128);

    /// @notice The shares reserved in `classId` for conversions into it: the sum over sources `s` converting
    /// into it of `ceil(authorised(s) * originalIssuePrice(s) / conversionFloorPrice(s))`.
    /// @param classId The target class.
    /// @return The reserve.
    function convertibleReserved(uint8 classId) external view returns (uint256);

    /// @notice What a module may still issue in a class.
    /// @param module The module.
    /// @param classId The class.
    /// @return The allowance.
    function issuerAllowance(address module, uint8 classId) external view returns (uint128);

    /// @notice Whether a consent id is recorded and not yet used.
    /// @param consentId The consent id.
    /// @return True while the consent can be used.
    function transferConsent(bytes32 consentId) external view returns (bool);

    /// @notice Whether the Captable was closed at a sale.
    /// @return True after `closeForExit`.
    function closedForExit() external view returns (bool);
}
