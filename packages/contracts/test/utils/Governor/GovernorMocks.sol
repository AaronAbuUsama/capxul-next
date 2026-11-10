// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ERC1155 } from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ERC20Votes } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { Checkpoints } from "@openzeppelin/contracts/utils/structs/Checkpoints.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @notice Votes on the timestamp clock as the Governor reads them, with the company Safe's rules (ruling
/// D5): the Safe is never delegated, so it has 0 votes, and its balance is checkpointed. Every other
/// account self-delegates on first receipt. The test mints, burns and moves at will.
abstract contract SafeAwareVotes is ERC20, ERC20Votes {
    using Checkpoints for Checkpoints.Trace208;

    address public immutable safe;
    Checkpoints.Trace208 internal _safeBalance;

    constructor(string memory name_, address safe_) ERC20(name_, name_) EIP712(name_, "1") {
        safe = safe_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }

    function move(address from, address to, uint256 amount) external {
        _transfer(from, to, amount);
    }

    function clock() public view override returns (uint48) {
        return SafeCast.toUint48(block.timestamp);
    }

    // solhint-disable-next-line func-name-mixedcase
    function CLOCK_MODE() public pure override returns (string memory) {
        return "mode=timestamp";
    }

    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Votes) {
        super._update(from, to, value);
        if (from == safe || to == safe) _safeBalance.push(clock(), SafeCast.toUint208(balanceOf(safe)));
        if (to != address(0) && to != safe && delegates(to) == address(0)) _delegate(to, to);
    }

    function _safeBalanceAt(uint256 timepoint) internal view returns (uint256) {
        return _safeBalance.upperLookupRecent(SafeCast.toUint48(timepoint));
    }
}

/// @notice The Captable as the company Governor sees it (spec/captable.md "Votes"): its past total supply
/// already leaves the Safe's shares out (E8), and it has no `safeBalanceAt`.
contract MockCaptableVotes is SafeAwareVotes {
    constructor(address safe_) SafeAwareVotes("Captable votes", safe_) { }

    function getPastTotalSupply(uint256 timepoint) public view override returns (uint256) {
        return super.getPastTotalSupply(timepoint) - _safeBalanceAt(timepoint);
    }
}

/// @notice A ShareClass token as a class Governor sees it (spec/share-class.md): the Safe's shares stay in
/// `getPastTotalSupply` and `safeBalanceAt` reads them.
contract MockClassVotes is SafeAwareVotes {
    constructor(address safe_) SafeAwareVotes("Class votes", safe_) { }

    function safeBalanceAt(uint256 timepoint) external view returns (uint256) {
        return _safeBalanceAt(timepoint);
    }
}

/// @notice An allowed target standing for the Captable, Rounds, Exits or the Gate: it records who called.
contract GovernorTarget {
    error Refused();

    uint256 public number;
    address public lastCaller;
    uint256 public calls;

    function setNumber(uint256 n) external {
        number = n;
        lastCaller = msg.sender;
        ++calls;
    }

    function refuse() external pure {
        revert Refused();
    }
}

/// @notice An ERC-721 anyone can mint.
contract MockNFT721 is ERC721 {
    constructor() ERC721("Mock NFT", "NFT") { }

    function mint(address to, uint256 id) external {
        _mint(to, id);
    }
}

/// @notice An ERC-1155 anyone can mint.
contract MockNFT1155 is ERC1155 {
    constructor() ERC1155("") { }

    function mint(address to, uint256 id, uint256 amount) external {
        _mint(to, id, amount, "");
    }
}
