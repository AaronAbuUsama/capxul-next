// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICaptable } from "../../../src/interfaces/ICaptable.sol";

/// @notice Stand-ins for the equity implementations (W3 to W8) the Installer clones in its tests. Each records its
/// `initialize` arguments, refuses a second `initialize`, and keeps only the state the equity install's calls
/// touch. Their own behaviour is tested in their own suites.
abstract contract OnceInitialized {
    error AlreadyInitialized();

    bool public initialized;

    modifier initializer() {
        if (initialized) revert AlreadyInitialized();
        initialized = true;
        _;
    }
}

/// @dev The Captable: wiring, the initial classes, issuer allowances and balances per class.
contract MockCaptable is OnceInitialized {
    error NotTheSafe(address caller);
    error OverIssuerAllowance(address module, uint8 classId);

    string public companyName;
    ICaptable.Wiring internal _wiring;
    uint256 public classCount;
    mapping(uint8 classId => uint128) public authorised;
    mapping(uint8 classId => uint128) public issued;
    mapping(address module => mapping(uint8 classId => uint128)) public issuerAllowance;
    mapping(uint8 classId => mapping(address shareholder => uint128)) public balanceOf;

    function initialize(
        string calldata name,
        ICaptable.Wiring calldata wiring_,
        ICaptable.ClassParams[] calldata initialClasses
    )
        external
        initializer
    {
        companyName = name;
        _wiring = wiring_;
        classCount = initialClasses.length;
        for (uint256 i; i < initialClasses.length; ++i) {
            authorised[uint8(i)] = initialClasses[i].authorised;
        }
    }

    function wiring() external view returns (ICaptable.Wiring memory) {
        return _wiring;
    }

    function setIssuerAllowance(address module, uint8 classId, uint128 amount) external {
        if (msg.sender != _wiring.safe) revert NotTheSafe(msg.sender);
        issuerAllowance[module][classId] = amount;
    }

    function issue(uint8 classId, address to, uint128 amount, bytes32) external {
        if (msg.sender != _wiring.safe) {
            uint128 left = issuerAllowance[msg.sender][classId];
            if (amount > left) revert OverIssuerAllowance(msg.sender, classId);
            issuerAllowance[msg.sender][classId] = left - amount;
        }
        balanceOf[classId][to] += amount;
        issued[classId] += amount;
    }
}

/// @dev The company Governor: its votes, Safe, allowed targets and settings.
contract MockGovernor is OnceInitialized {
    string public name;
    address public votes;
    address public safe;
    address[] internal _allowedTargets;
    uint48 public votingDelay;
    uint32 public votingPeriod;
    uint256 public proposalThreshold;
    uint256 public quorumNumerator;

    function initialize(
        string calldata name_,
        address votes_,
        address safe_,
        address[] calldata allowedTargets_,
        uint48 votingDelay_,
        uint32 votingPeriod_,
        uint256 proposalThreshold_,
        uint256 quorumNumerator_
    )
        external
        initializer
    {
        name = name_;
        votes = votes_;
        safe = safe_;
        _allowedTargets = allowedTargets_;
        votingDelay = votingDelay_;
        votingPeriod = votingPeriod_;
        proposalThreshold = proposalThreshold_;
        quorumNumerator = quorumNumerator_;
    }

    function allowedTargets() external view returns (address[] memory) {
        return _allowedTargets;
    }

    function isAllowedTarget(address target) external view returns (bool) {
        for (uint256 i; i < _allowedTargets.length; ++i) {
            if (_allowedTargets[i] == target) return true;
        }
        return false;
    }
}

/// @dev Options: its wiring and the pool the Safe sets.
contract MockOptions is OnceInitialized {
    error NotTheSafe(address caller);

    address public safe;
    address public captable;
    address public payments;
    uint8 public classId;
    uint128 public pool;

    function initialize(address safe_, address captable_, address payments_, uint8 classId_) external initializer {
        safe = safe_;
        captable = captable_;
        payments = payments_;
        classId = classId_;
    }

    function setPool(uint128 amount) external {
        if (msg.sender != safe) revert NotTheSafe(msg.sender);
        pool = amount;
    }
}

/// @dev Rounds: its wiring.
contract MockRounds is OnceInitialized {
    address public safe;
    address public captable;
    address public payments;

    function initialize(address safe_, address captable_, address payments_) external initializer {
        safe = safe_;
        captable = captable_;
        payments = payments_;
    }
}

/// @dev Exits: its wiring.
contract MockExits is OnceInitialized {
    address public safe;
    address public captable;
    address public options;
    address public vesting;
    address public payments;
    address public governor;
    address public escrowFactory;

    function initialize(
        address safe_,
        address captable_,
        address options_,
        address vesting_,
        address payments_,
        address governor_,
        address escrowFactory_
    )
        external
        initializer
    {
        safe = safe_;
        captable = captable_;
        options = options_;
        vesting = vesting_;
        payments = payments_;
        governor = governor_;
        escrowFactory = escrowFactory_;
    }
}

/// @dev The shared Vesting: `grantAndIssue` from the Captable's Safe records the grant and issues through the
/// Captable under Vesting's issuer allowance.
contract MockVesting {
    struct Grant {
        address captable;
        uint8 classId;
        address shareholder;
        uint128 amount;
        uint64 start;
        uint64 cliff;
        uint64 end;
        bool accelerateOnExit;
        bytes32 documentHash;
    }

    error NotTheSafe(address caller);

    Grant[] internal _grants;

    function grantAndIssue(
        address captable,
        uint8 classId,
        address shareholder,
        uint128 amount,
        uint64 start,
        uint64 cliff,
        uint64 end,
        bool accelerateOnExit,
        bytes32 documentHash
    )
        external
        returns (uint256 id)
    {
        if (msg.sender != MockCaptable(captable).wiring().safe) revert NotTheSafe(msg.sender);
        id = _grants.length;
        _grants.push(Grant(captable, classId, shareholder, amount, start, cliff, end, accelerateOnExit, documentHash));
        MockCaptable(captable).issue(classId, shareholder, amount, documentHash);
    }

    function grantCount() external view returns (uint256) {
        return _grants.length;
    }

    function grant(uint256 id) external view returns (Grant memory) {
        return _grants[id];
    }
}
