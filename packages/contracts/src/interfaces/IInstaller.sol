// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IHatsSignerGate } from "./external/IHatsSignerGate.sol";
import { ICaptable } from "./ICaptable.sol";

/// @title IInstaller
/// @notice Installs Capxul's protocol onto an existing company Safe (spec/installer.md, spec/board.md, rulings D1,
/// D2). Each install has a permissionless `deploy*` that creates what must exist and keeps no authority, and a view
/// `build*` that returns the calls the company Safe (or the founder's Safe, or the Governor) executes in one
/// MultiSendCallOnly 1.4.1 batch. The Installer is one shared contract: never delegatecalled, never a Safe module or
/// Roles member, and it holds no token and wears no hat after any call returns (I2).
interface IInstaller {
    /// @notice One call of a batch. MultiSendCallOnly runs each as a plain call (operation 0).
    struct Call {
        address to;
        uint256 value;
        bytes data;
    }

    /// @notice An officer (budget) hat created as a direct child of the Board's top hat.
    struct Officer {
        string details;
        uint32 maxSupply;
    }

    /// @notice `deployMoney`'s input.
    /// @param safe The company Safe.
    /// @param founderSafe The founder's personal Safe: it wears the Director hat and the Shareholders' top hat, and
    /// is the Director hat's eligibility and toggle until the equity install.
    /// @param coDirectors The other founding Directors' personal Safes (27 Oct ruling: every founding Director
    /// wears the Director hat); may be empty. The Director hat's max supply is `1 + coDirectors.length`.
    /// @param threshold The Gate's threshold config, chosen at setup (27 Oct ruling). `min` must be at least 1 and
    /// at most the number of founding Directors, so the Board can always sign.
    /// @param officers The officer hats to create now (more can be created later by the Safe).
    /// @param salt The ModuleProxyFactory salt nonce for Roles and the Gate.
    struct MoneyDeploy {
        address safe;
        address founderSafe;
        address[] coDirectors;
        IHatsSignerGate.ThresholdConfig threshold;
        Officer[] officers;
        bytes32 salt;
    }

    /// @notice What `deployMoney` created.
    /// @param boardTopHat The Board's top hat, worn by the company Safe.
    /// @param shareholdersTopHat The Shareholders' top hat, worn by the founder's Safe until the equity install.
    /// @param directorHat The Director hat (mutable, the Gate's signer hat), worn by every founding Director's Safe.
    /// @param officerHats The officer hats, in `MoneyDeploy.officers` order.
    /// @param roles The company's Zodiac Roles modifier (owner and avatar the Safe).
    /// @param gate The company's Hats Signer Gate v2.
    struct MoneyDeployment {
        uint256 boardTopHat;
        uint256 shareholdersTopHat;
        uint256 directorHat;
        uint256[] officerHats;
        address roles;
        address gate;
    }

    /// @notice One token the company pays in.
    /// @param token The ERC-20 token.
    /// @param ceiling The payout role's Roles allowance for this token per refill period (a backstop under
    /// Budgets' own checks; normally the top budget's amount, the beta rule).
    /// @param budgetPeriod The top budget's period: `Calendar.BUDGET_MONTH`, `_QUARTER` or `_YEAR`.
    /// @param topAmount The top budget's amount per period.
    /// @param topHat The top budget's hat (normally the Board's top hat). Never 0.
    struct Token {
        address token;
        uint128 ceiling;
        uint8 budgetPeriod;
        uint128 topAmount;
        uint256 topHat;
    }

    /// @notice `buildMoney`'s input. `coDirectors` as given to `deployMoney`: each is claimed as a signer
    /// beside the founder's Safe, and every other current owner is removed.
    struct MoneyInstall {
        address safe;
        address founderSafe;
        address[] coDirectors;
        MoneyDeployment deployment;
        Token[] tokens;
    }

    /// @notice The company Governor's settings at `initialize` (OpenZeppelin 5 `GovernorSettings` and
    /// `GovernorVotesQuorumFraction`); the shareholders change them later by vote.
    struct GovernorSettings {
        uint48 votingDelay;
        uint32 votingPeriod;
        uint256 proposalThreshold;
        uint256 quorumNumerator;
    }

    /// @notice `deployEquity`'s input.
    /// @param safe The company Safe.
    /// @param money The company's money deployment (the Governor's allowed targets include its hats and Gate).
    /// @param name The company's name, for the Governor and the share class tokens.
    /// @param initialClasses The template's first classes, passed unchanged to `Captable.initialize`.
    /// @param poolClassId The class the option pool is in, fixed in `Options.initialize`.
    /// @param governor The company Governor's settings.
    struct EquityDeploy {
        address safe;
        MoneyDeployment money;
        string name;
        ICaptable.ClassParams[] initialClasses;
        uint8 poolClassId;
        GovernorSettings governor;
    }

    /// @notice The company's equity clones, as `deployEquity` created them.
    /// @param elections The Hats Elections clone's predicted address (HatsModuleFactory, salt nonce 0). It is in
    /// the Governor's allowed targets, which are fixed at `initialize`; `deployElections` creates it later.
    struct EquityDeployment {
        address captable;
        address governor;
        address options;
        address rounds;
        address exits;
        address elections;
    }

    /// @notice A founder's shares, issued under a live Vesting grant (`Vesting.grantAndIssue`), or with no
    /// vesting when `end` is 0.
    struct FounderShares {
        address shareholder;
        uint8 classId;
        uint128 amount;
        uint64 start;
        uint64 cliff;
        uint64 end;
        bool accelerateOnExit;
        bytes32 documentHash;
    }

    /// @notice `buildEquity`'s input.
    /// @param optionPool The option pool's size, in `EquityDeploy.poolClassId`.
    struct EquityInstall {
        address safe;
        address founderSafe;
        MoneyDeployment money;
        EquityDeployment equity;
        FounderShares[] founders;
        uint128 optionPool;
    }

    /// @notice `deployElections`' input.
    /// @param directorHat The seat group's Director hat (J5: one Director hat and one Elections clone per group, all
    /// signer hats on the Gate). The first group's is `money.directorHat`; another group's is a mutable hat under
    /// the Shareholders' top hat that the Governor created.
    /// @param firstTermEnd The first term's end (a Unix time in the future).
    struct ElectionsDeploy {
        address safe;
        MoneyDeployment money;
        uint256 directorHat;
        uint128 firstTermEnd;
    }

    /// @notice `buildElections`' input.
    /// @param directorHat The seat group's Director hat, as given to `deployElections`.
    /// @param elections The Elections clone `deployElections` returned.
    /// @param winners The first term's Directors, every sitting Director who keeps the seat included.
    /// @param seats The Director hat's max supply after the election.
    /// @param threshold The Gate's threshold config for the new Board size.
    struct ElectionsInstall {
        address safe;
        MoneyDeployment money;
        uint256 directorHat;
        address elections;
        uint128 firstTermEnd;
        address[] winners;
        uint32 seats;
        IHatsSignerGate.ThresholdConfig threshold;
    }

    /// @notice `buildAddToken`'s input (J12).
    /// @param roles The company's Roles modifier.
    /// @param existing Every token the payout role is scoped to now. The `send` scope is rebuilt as one condition
    /// over all tokens, so a token left out loses its `send` permission (its allowance is untouched).
    /// @param token The new token, its ceiling and its top budget.
    struct AddToken {
        address safe;
        address roles;
        Token[] existing;
        Token token;
    }

    /// @notice `buildSetCeiling`'s input (J12).
    /// @param roles The company's Roles modifier.
    /// @param token A token the payout role is scoped to.
    /// @param ceiling The new ceiling per refill period.
    struct SetCeiling {
        address safe;
        address roles;
        address token;
        uint128 ceiling;
    }

    /// @notice Why an install was refused.
    enum InstallRefusal {
        SafeInvalid, // the company Safe is zero or has no code
        FounderSafeInvalid, // the founder's Safe is zero or has no code
        RolesNotForSafe, // the deployment's Roles does not name the Safe as owner and avatar
        GateNotForSafe, // the deployment's Gate does not name the Safe
        FounderNotDirector, // the founder's Safe or a co-Director's Safe does not wear the Director hat
        NoToken, // no token given
        DuplicateToken, // a token given twice
        ZeroTopHat, // a top budget's hat is 0
        EquityExists, // the company already has equity
        NotCompanyClones, // the equity addresses are not this company's clones
        DirectorHatInvalid, // the Director hat does not exist or is not mutable
        FirstTermEndInvalid, // the first term's end is not in the future
        ElectionsTermMismatch, // a clone already at the predicted address has another first term
        CoDirectorInvalid, // a co-Director's Safe is zero, has no code, is repeated or is the founder's Safe
        ThresholdInvalid, // the threshold's min is 0 or above the number of founding Directors
        BudgetPeriodInvalid, // a top budget's period is above BUDGET_YEAR (J11)
        TokenUnknown // the token has no payout ceiling on the company's Roles (J12)
    }

    /// @notice A money deployment was created for `safe`.
    event MoneyDeployed(address indexed safe, address indexed founderSafe, MoneyDeployment deployment);

    /// @notice The equity clones were created and initialised for `safe`.
    event EquityDeployed(address indexed safe, EquityDeployment deployment);

    /// @notice The Hats Elections clone for `safe`'s Director hat was created (or an identical one accepted).
    event ElectionsDeployed(address indexed safe, address elections, uint256 directorHat, uint128 firstTermEnd);

    /// @notice The install was refused.
    error InvalidInstall(InstallRefusal reason);

    /// @notice Creates the company's two hat trees, its Roles modifier and its Gate (installer.md step 1). Anyone
    /// may call it. Accepts a correct Roles or Gate already at its predicted address. Emits `MoneyDeployed`.
    /// @param p The Safe, the founding Directors' Safes, the threshold, the officer hats and the salt.
    /// @return d The hats, Roles and the Gate.
    function deployMoney(MoneyDeploy calldata p) external returns (MoneyDeployment memory d);

    /// @notice The batch the company Safe's current owners sign to install money (installer.md step 2): disable
    /// every module, point Roles at the Gate, scope the payout role to Budgets per token, configure Budgets, create
    /// the top budgets, enable the Gate as module and guard, then claim every founding Director's Safe as signer and
    /// remove every other owner. Roles is never enabled on the Safe.
    /// @param p The Safe, the founder's Safe, the money deployment and the tokens.
    /// @return calls The calls, in order.
    function buildMoney(MoneyInstall calldata p) external view returns (Call[] memory calls);

    /// @notice The calls the company Safe runs to pay in one more token (J12, B10): scope `approve` on the token,
    /// rebuild the `send` scope over every token, set the token's allowance and create its top budget. Every other
    /// token's allowance is left as it is.
    /// @param p The Safe, its Roles, the tokens scoped now and the new token.
    /// @return calls The calls, in order.
    function buildAddToken(AddToken calldata p) external view returns (Call[] memory calls);

    /// @notice The call that resizes one token's payout ceiling (J12, B10). It keeps what was spent this period (the
    /// new balance is the new ceiling less the spend) and every other token's allowance.
    /// @param p The Safe, its Roles, the token and the new ceiling.
    /// @return calls The calls, in order.
    function buildSetCeiling(SetCeiling calldata p) external view returns (Call[] memory calls);

    /// @notice Clones and initialises the company's Captable, Governor, Options, Rounds and Exits, each wired to the
    /// others once; no clone has any power until the Safe runs `buildEquity`'s calls. The Governor's allowed
    /// targets are the Captable, Hats, the predicted Elections clone, the Gate, Rounds and Exits (spec/governor.md). Anyone may call it. Emits
    /// `EquityDeployed`.
    /// @param p The Safe, its money deployment, the company name, the first classes, the pool class and the
    /// Governor's settings.
    /// @return d The clones.
    function deployEquity(EquityDeploy calldata p) external returns (EquityDeployment memory d);

    /// @notice The calls that finish the equity install: the company Safe's calls (issuer allowances, founder shares
    /// and their vesting, the option pool), then the founder's Safe's calls that hand the shareholders their tree
    /// (`changeHatEligibility` and `changeHatToggle` of the Director hat to the Governor, then
    /// `transferHat(shareholdersTopHat, founderSafe, governor)` last).
    /// @param p The Safe, the founder's Safe, the deployments, the founders' shares and the option pool.
    /// @return safeCalls The company Safe's batch.
    /// @return founderCalls The founder's Safe's batch, run after `safeCalls`.
    function buildEquity(EquityInstall calldata p)
        external
        view
        returns (Call[] memory safeCalls, Call[] memory founderCalls);

    /// @notice Creates the Hats Elections clone for the Director hat through HatsModuleFactory, with the
    /// Shareholders' top hat as ballot box, ADMIN_HAT 0, salt nonce 0 (the address `deployEquity` predicted for the
    /// Governor's allowed targets) and `firstTermEnd` as init data, and reads
    /// `currentTermEnd()` back in the same transaction. Accepts an identical clone already deployed; refuses one
    /// deployed first with another first term. Anyone may call it. Emits `ElectionsDeployed`.
    /// @param p The Safe, its money deployment and the first term's end.
    /// @return elections The Elections clone.
    function deployElections(ElectionsDeploy calldata p) external returns (address elections);

    /// @notice The Governor's batch that attaches elections (board.md): `elect` first, the Director hat's max supply
    /// if the seat count changes, `changeHatEligibility` to the clone, burn unelected Directors' hats, mint the hat
    /// to each new winner, and set the Gate's threshold config. Claiming new signers and removing former Directors
    /// are permissionless calls anyone sends afterwards.
    /// @param p The Safe, its money deployment, the clone, the term, the winners, the seats and the threshold.
    /// @return governorCalls The Governor's calls, in order.
    function buildElections(ElectionsInstall calldata p) external view returns (Call[] memory governorCalls);

    /// @notice The payout role's key on every company's Roles: `keccak256("v4-payout")`.
    /// @return The role key.
    function PAYOUT_ROLE_KEY() external view returns (bytes32);

    /// @notice A token's payout ceiling key: `keccak256(abi.encodePacked("v4-payout-ceiling:", token))`.
    /// @param token The token.
    /// @return The Roles allowance key.
    function payoutAllowanceKey(address token) external pure returns (bytes32);

    /// @notice The shared Payments contract.
    /// @return The address.
    function payments() external view returns (address);

    /// @notice The shared Budgets contract, the payout role's only member.
    /// @return The address.
    function budgets() external view returns (address);

    /// @notice The shared Agreements contract.
    /// @return The address.
    function agreements() external view returns (address);

    /// @notice The shared Vesting contract.
    /// @return The address.
    function vesting() external view returns (address);

    /// @notice Hats Protocol v1.
    /// @return The address.
    function hats() external view returns (address);

    /// @notice The Zodiac ModuleProxyFactory that deploys Roles and the Gate.
    /// @return The address.
    function moduleProxyFactory() external view returns (address);

    /// @notice The Zodiac Roles v2.1 mastercopy.
    /// @return The address.
    function rolesMastercopy() external view returns (address);

    /// @notice The Hats Signer Gate v2 implementation.
    /// @return The address.
    function gateImplementation() external view returns (address);

    /// @notice HatsModuleFactory v0.7.0.
    /// @return The address.
    function hatsModuleFactory() external view returns (address);

    /// @notice The Hats Election Eligibility v0.2.0 implementation.
    /// @return The address.
    function electionsImplementation() external view returns (address);

    /// @notice CompatibilityFallbackHandler 1.5.0, set when the Safe's handler is the 4337 module.
    /// @return The address.
    function fallbackHandler() external view returns (address);

    /// @notice The Safe 4337 module 0.3.0, recognised as a Capxul Safe's handler.
    /// @return The address.
    function safe4337Module() external view returns (address);

    /// @notice The Captable implementation the company clone is made from.
    /// @return The address.
    function captableImplementation() external view returns (address);

    /// @notice The ShareClass implementation, passed to `Captable.initialize`.
    /// @return The address.
    function shareClassImplementation() external view returns (address);

    /// @notice The Governor implementation.
    /// @return The address.
    function governorImplementation() external view returns (address);

    /// @notice The Options implementation.
    /// @return The address.
    function optionsImplementation() external view returns (address);

    /// @notice The Rounds implementation.
    /// @return The address.
    function roundsImplementation() external view returns (address);

    /// @notice The Exits implementation.
    /// @return The address.
    function exitsImplementation() external view returns (address);

    /// @notice The shared EscrowFactory, passed to `Exits.initialize`.
    /// @return The address.
    function escrowFactory() external view returns (address);
}
