// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @title IBudgets
/// @notice A company's money planned as a tree of budgets keyed by the company Safe (spec/budgets.md).
/// Each budget names a Hats hat; its wearers, the wearers of any ancestor budget's hat and the Safe act
/// for it. Children fit inside their parent (B6). Payouts go through the Safe's Roles payout role and
/// Payments. Calendar errors (`ICalendar`) also surface from these functions.
interface IBudgets {
    /// @notice A Safe's payout wiring.
    struct Config {
        address roles;
        bytes32 payoutRoleKey;
    }

    /// @notice One budget. Views return `ownSpent` and `spent` as effective values (0 once the period
    /// has turned).
    struct Budget {
        address safe; // the company
        uint256 parent; // 0 for a top budget
        uint256 hat; // the Hats hat whose wearers act for it; never 0
        address token; // a child always has its parent's token (B4)
        uint8 period; // ICalendar.BUDGET_MONTH, _QUARTER or _YEAR; a child has its parent's (B4)
        uint8 depth; // 1 for a top budget; at most MAX_DEPTH
        bool closed;
        uint128 amount; // per period
        uint128 childrenAmount; // sum of the amounts of its children (B6)
        uint128 ownSpent; // spent directly from this budget in periodIndex
        uint128 ownCommitted; // agreement reservations + pending scheduled payments on this budget
        uint128 spent; // ownSpent plus the children's spent, in periodIndex (B2)
        uint128 committed; // ownCommitted plus the children's committed
        uint64 periodIndex; // ICalendar period index that ownSpent and spent belong to
    }

    /// @notice A scheduled payment's lifecycle.
    enum ScheduleState {
        None,
        Pending,
        Cancelled,
        Paid
    }

    /// @notice A dated payment from a budget (M4).
    struct Scheduled {
        uint256 budgetId;
        address to;
        uint128 amount;
        uint64 payAt;
        uint16 kind;
        ScheduleState state;
        bytes32 documentHash;
        bytes32 jobNonce;
    }

    /// @dev Not in spec/budgets.md's event list; added for architecture.md's "every state change emits".
    event AgreementsSet(address indexed agreements);
    event Configured(address indexed safe, address roles, bytes32 payoutRoleKey);
    event BudgetCreated(
        address indexed safe,
        uint256 indexed id,
        uint256 indexed parent,
        address token,
        uint8 period,
        uint128 amount,
        uint256 hat
    );
    event BudgetAmountSet(address indexed safe, uint256 indexed id, uint128 amount);
    event BudgetHatSet(address indexed safe, uint256 indexed id, uint256 hat);
    event BudgetClosed(address indexed safe, uint256 indexed id);
    event BudgetReopened(address indexed safe, uint256 indexed id);
    event Spent(
        address indexed safe,
        uint256 indexed id,
        address indexed recipient,
        uint128 amount,
        uint16 kind,
        bytes32 documentHash,
        bytes32 paymentId
    );
    event PaymentScheduled(
        address indexed safe,
        uint256 indexed budgetId,
        uint256 indexed scheduledId,
        address to,
        uint128 amount,
        uint16 kind,
        uint64 payAt,
        bytes32 documentHash,
        bytes32 jobNonce
    );
    event ScheduleCancelled(address indexed safe, uint256 indexed budgetId, uint256 indexed scheduledId);
    event ScheduledPaid(address indexed safe, uint256 indexed budgetId, uint256 indexed scheduledId, bytes32 paymentId);
    event Committed(address indexed safe, uint256 indexed id, uint128 amount);
    event Released(address indexed safe, uint256 indexed id, uint128 amount);
    event ReservedPaid(
        address indexed safe, uint256 indexed id, address indexed recipient, uint128 amount, bytes32 paymentId
    );

    error NotConfigured();
    error NotTheSafe();
    error InvalidConfiguration();
    error NotDeployer();
    error AlreadySet();
    error UnknownBudget(uint256 id);
    error NotAuthorised(uint256 id, address who);
    error BudgetIsClosed(uint256 closedId);
    error TooDeep();
    error InvalidToken();
    error InvalidHat();
    error ZeroAmount();
    error ZeroAddress();
    error InvalidKind(uint16 kind);
    error ZeroDocumentHash();
    error ZeroJobNonce();
    error OverBudget(uint256 id, uint128 left, uint128 requested);
    error ChildrenExceedParent(uint256 parent, uint128 left, uint128 requested);
    error AmountBelowUse(uint256 id, uint128 used, uint128 requested);
    error UnknownScheduled(uint256 id);
    error InvalidPayAt();
    error NotPending(uint256 id);
    error NotDue(uint256 id, uint64 payAt);
    error OnlyAgreements();
    error AlreadyClosed();
    error NotClosed();
    error ReentrantCall();

    // ------------------------------------------------------------------ Wiring

    /// @notice The deepest a budget tree may go: a top budget is depth 1.
    /// @return 8.
    function MAX_DEPTH() external view returns (uint8);

    /// @notice The Payments contract every payout goes through.
    /// @return The Payments address.
    function payments() external view returns (address);

    /// @notice Hats Protocol, asked directly for every authority check.
    /// @return The Hats address.
    function hats() external view returns (address);

    /// @notice The Agreements contract, the only caller of `commit`, `release` and `payReserved`.
    /// @return The Agreements address, or zero before `setAgreements`.
    function agreements() external view returns (address);

    /// @notice Sets `agreements` once. Only the deployer (Companies House) may call, in the deploy batch.
    /// Reverts `NotDeployer` for another caller and `AlreadySet` on a second call. Emits `AgreementsSet`.
    /// @param agreements_ The Agreements contract.
    function setAgreements(address agreements_) external;

    /// @notice A Safe's payout wiring.
    /// @param safe The company Safe.
    /// @return roles The Safe's Roles modifier (a module on its Signer Gate).
    /// @return payoutRoleKey The role Budgets holds.
    function configs(address safe) external view returns (address roles, bytes32 payoutRoleKey);

    /// @notice The number of budgets created; ids run from 1.
    /// @return The last budget id.
    function budgetCount() external view returns (uint256);

    /// @notice The number of payments scheduled; ids run from 1.
    /// @return The last scheduled payment id.
    function scheduledCount() external view returns (uint256);

    // ------------------------------------------------------------------ The Safe

    /// @notice The calling Safe points Budgets at its Roles modifier and payout role. Requires
    /// `roles.avatar() == msg.sender` and `roles.target()` to be the Safe's Signer Gate; any failed or odd
    /// read reverts `InvalidConfiguration`. Emits `Configured`.
    /// @param roles The Roles modifier on the Safe's Signer Gate.
    /// @param payoutRoleKey The payout role assigned to Budgets.
    function configure(address roles, bytes32 payoutRoleKey) external;

    /// @notice The calling configured Safe creates a top budget. `amount` may be 0. Emits `BudgetCreated`.
    /// @param token A nonzero token with code.
    /// @param period A budget period (`ICalendar.BUDGET_*`).
    /// @param amount The amount per period.
    /// @param hat The hat whose wearers act for the budget; never 0.
    /// @return id The new budget id.
    function createTopBudget(address token, uint8 period, uint128 amount, uint256 hat) external returns (uint256 id);

    // ------------------------------------------------------------------ Hat wearers

    /// @notice Creates a budget under `parent` with the parent's token and period. Requires
    /// `authorised(parent)`, an open path, depth below `MAX_DEPTH` and room in the parent, else
    /// `ChildrenExceedParent`. Emits `BudgetCreated`.
    /// @param parent The parent budget.
    /// @param amount The amount per period.
    /// @param hat The hat whose wearers act for the budget; never 0.
    /// @return id The new budget id.
    function createChildBudget(uint256 parent, uint128 amount, uint256 hat) external returns (uint256 id);

    /// @notice Sets a budget's amount per period. Top budget: the Safe; child: `authorised(parent)`.
    /// Raising a child needs room in its parent; lowering below what is used reverts `AmountBelowUse`
    /// (D8). Allowed while closed. Emits `BudgetAmountSet`.
    /// @param id The budget.
    /// @param amount The new amount per period.
    function setAmount(uint256 id, uint128 amount) external;

    /// @notice Replaces a budget's hat. Top budget: the Safe; child: `authorised(parent)`. Running
    /// agreements and pending scheduled payments are unchanged. Emits `BudgetHatSet`.
    /// @param id The budget.
    /// @param hat The new hat; never 0.
    function setHat(uint256 id, uint256 hat) external;

    /// @notice Closes a budget to new spends, commitments, schedules and children (B3). Top budget: the
    /// Safe; child: `authorised(parent)`. Emits `BudgetClosed`.
    /// @param id The budget.
    function close(uint256 id) external;

    /// @notice Reopens a closed budget. Top budget: the Safe; child: `authorised(parent)`.
    /// Emits `BudgetReopened`.
    /// @param id The budget.
    function reopen(uint256 id) external;

    /// @notice Pays `amount` from a budget now. Requires `authorised(id)`, an open path, `kind` 0 to 3 and
    /// `amount <= leftOf(id)`. Pays through the payout role with a job nonce bound to this contract and the
    /// budget. Emits `Spent`.
    /// @param id The budget.
    /// @param recipient Who is paid.
    /// @param amount The amount.
    /// @param kind The payment kind, 0 to 3.
    /// @param documentHash The document the payment settles; never zero.
    /// @param jobNonce The caller's nonce for this payment; never zero.
    /// @return paymentId The Payments id.
    function spend(
        uint256 id,
        address recipient,
        uint128 amount,
        uint16 kind,
        bytes32 documentHash,
        bytes32 jobNonce
    )
        external
        returns (bytes32 paymentId);

    /// @notice Schedules a dated payment and reserves its amount now (M4). Requires `authorised(id)`, an
    /// open path, `kind` 0 to 3, `payAt` in the future and `amount <= leftOf(id)`. Emits
    /// `PaymentScheduled`.
    /// @param id The budget.
    /// @param to Who is paid.
    /// @param amount The amount.
    /// @param kind The payment kind, 0 to 3.
    /// @param payAt The earliest time `execute` may pay.
    /// @param documentHash The document the payment settles; never zero.
    /// @param jobNonce The caller's job nonce; never zero. `execute` pays with
    /// `keccak256(abi.encode(address(this), id, jobNonce))`, as `spend` does, so the payment id is known
    /// before the schedule lands.
    /// @return scheduledId The scheduled payment id.
    function schedule(
        uint256 id,
        address to,
        uint128 amount,
        uint16 kind,
        uint64 payAt,
        bytes32 documentHash,
        bytes32 jobNonce
    )
        external
        returns (uint256 scheduledId);

    /// @notice Cancels a pending scheduled payment and frees its reservation, at any time until it is paid
    /// (27 Oct ruling), including after `payAt` if no one has executed it yet. Requires
    /// `authorised(budget)`. Allowed while closed. Emits `ScheduleCancelled`.
    /// @param scheduledId The scheduled payment.
    function cancel(uint256 scheduledId) external;

    // ------------------------------------------------------------------ Anyone

    /// @notice Pays a pending scheduled payment at or after its `payAt`, at most once. Anyone may call.
    /// Allowed while closed. If the payout is refused, the whole call reverts and it stays `Pending`.
    /// Emits `ScheduledPaid`.
    /// @param scheduledId The scheduled payment.
    /// @return paymentId The Payments id.
    function execute(uint256 scheduledId) external returns (bytes32 paymentId);

    // ------------------------------------------------------------------ Agreements only

    /// @notice Reserves `amount` in a budget for an agreement. Requires an open path and
    /// `amount <= leftOf(id)`. Emits `Committed`.
    /// @param id The budget.
    /// @param amount The amount to reserve.
    function commit(uint256 id, uint128 amount) external;

    /// @notice Frees `amount` of an agreement's reservation in a budget. Emits `Released`.
    /// @param id The budget.
    /// @param amount The amount to free.
    function release(uint256 id, uint128 amount) external;

    /// @notice Pays an agreement collection with `kind = 4` against its reservation, without touching
    /// `ownSpent`. Allowed while closed. Emits `ReservedPaid`.
    /// @param id The budget.
    /// @param recipient The payee.
    /// @param amount The amount.
    /// @param documentHash The agreement's document hash.
    /// @param jobNonce The collection's job nonce.
    /// @return paymentId The Payments id.
    function payReserved(
        uint256 id,
        address recipient,
        uint128 amount,
        bytes32 documentHash,
        bytes32 jobNonce
    )
        external
        returns (bytes32 paymentId);

    // ------------------------------------------------------------------ Views

    /// @notice A budget with effective spend values.
    /// @param id The budget.
    /// @return The budget.
    function budgetOf(uint256 id) external view returns (Budget memory);

    /// @notice What a budget can still spend, commit or schedule this period:
    /// `amount - childrenAmount - eff(ownSpent) - ownCommitted`.
    /// @param id The budget.
    /// @return The amount left.
    function leftOf(uint256 id) external view returns (uint128);

    /// @notice A budget's children.
    /// @param id The budget.
    /// @return The child budget ids.
    function childrenOf(uint256 id) external view returns (uint256[] memory);

    /// @notice Whether `who` may act for a budget: the budget's Safe, or a wearer in good standing of the
    /// hat of the budget or of any budget above it.
    /// @param id The budget.
    /// @param who The caller to check.
    /// @return True if authorised.
    function authorised(uint256 id, address who) external view returns (bool);

    /// @notice The budget ids from the top budget down to `id`.
    /// @param id The budget.
    /// @return The path, top first.
    function pathOf(uint256 id) external view returns (uint256[] memory);

    /// @notice A scheduled payment.
    /// @param id The scheduled payment.
    /// @return The scheduled payment.
    function scheduledOf(uint256 id) external view returns (Scheduled memory);
}
