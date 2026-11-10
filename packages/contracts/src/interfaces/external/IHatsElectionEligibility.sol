// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @title IHatsElectionEligibility
/// @notice The parts of Hats Election Eligibility v0.2.0 (implementation 0xd3b916a8F0C4f9D1d5B6Af29c3C012dbd4f3149E)
/// that the protocol calls. A company's instance is a clone from HatsModuleFactory. Signatures checked against the
/// source verified on Base Sepolia Blockscout (Hats-Protocol/hats-elections-eligibility,
/// `src/HatsElectionEligibility.sol`). A term is named by its end, the first second after it.
interface IHatsElectionEligibility {
    /// @notice Records the winners of the election for the term ending `termEnd`. Ballot-box hat only; once per
    /// term; at most the hat's max supply of winners.
    /// @param termEnd The term.
    /// @param winners The winners.
    function elect(uint128 termEnd, address[] calldata winners) external;

    /// @notice Removes accounts from the winners of the term ending `termEnd`. Ballot-box hat only.
    /// @param termEnd The term.
    /// @param recallees The accounts.
    function recall(uint128 termEnd, address[] calldata recallees) external;

    /// @notice Opens the election for the next term. Admin hat only (the hat's admins when ADMIN_HAT is 0).
    /// @param newTermEnd The next term's end.
    function setNextTerm(uint128 newTermEnd) external;

    /// @notice Makes the next term current. Anyone may call it once the current term has ended and the next
    /// term's election is closed.
    function startNextTerm() external;

    /// @notice The current term's end. Every wearer is ineligible from it until `startNextTerm`.
    /// @return The current term's end.
    function currentTermEnd() external view returns (uint128);

    /// @notice The next term's end, or 0 when none is open.
    /// @return The next term's end.
    function nextTermEnd() external view returns (uint128);
}
