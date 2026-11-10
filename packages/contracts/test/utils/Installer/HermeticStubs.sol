// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IHatsSignerGate } from "../../../src/interfaces/external/IHatsSignerGate.sol";

/// @notice Read-only stand-ins for the third-party contracts `buildMoney`, `buildEquity` and the validation steps of
/// the `deploy*` functions read, so the Installer's input ranges can be fuzzed hermetically (10,000 runs, gate 5).
/// Each answers what a test sets; the real contracts run in the fork tests.

/// @dev A Safe 1.4.1's reads: modules (linked-list pages), owners, threshold and raw storage.
contract SafeStub {
    address internal constant SENTINEL = address(0x1);
    bytes32 internal constant FALLBACK_HANDLER_SLOT =
        0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5;

    address[] internal _modules;
    address[] internal _owners;
    uint256 public getThreshold = 1;
    address public fallbackHandler;

    function setModules(address[] memory modules) external {
        _modules = modules;
    }

    function setOwners(address[] memory owners, uint256 threshold) external {
        _owners = owners;
        getThreshold = threshold;
    }

    function setFallbackHandler(address handler) external {
        fallbackHandler = handler;
    }

    function getOwners() external view returns (address[] memory) {
        return _owners;
    }

    function isOwner(address account) external view returns (bool) {
        for (uint256 i; i < _owners.length; ++i) {
            if (_owners[i] == account) return true;
        }
        return false;
    }

    function isModuleEnabled(address module) external view returns (bool) {
        for (uint256 i; i < _modules.length; ++i) {
            if (_modules[i] == module) return true;
        }
        return false;
    }

    /// @dev As Safe 1.4.1: the page after `start` (the sentinel for the first), and the next start or the sentinel.
    function getModulesPaginated(
        address start,
        uint256 pageSize
    )
        external
        view
        returns (address[] memory array, address next)
    {
        uint256 from;
        if (start != SENTINEL) {
            while (from < _modules.length && _modules[from] != start) ++from;
            ++from;
        }
        uint256 count = _modules.length > from ? _modules.length - from : 0;
        if (count > pageSize) count = pageSize;
        array = new address[](count);
        for (uint256 i; i < count; ++i) {
            array[i] = _modules[from + i];
        }
        next = from + count < _modules.length ? array[count - 1] : SENTINEL;
    }

    function getStorageAt(uint256 offset, uint256 length) external view returns (bytes memory out) {
        out = new bytes(length * 32);
        if (bytes32(offset) == FALLBACK_HANDLER_SLOT && length > 0) {
            bytes32 word = bytes32(uint256(uint160(fallbackHandler)));
            assembly ("memory-safe") {
                mstore(add(out, 32), word)
            }
        }
    }
}

/// @dev Zodiac Roles' owner, avatar and target.
contract RolesStub {
    address public owner;
    address public avatar;
    address public target;

    struct Allowance {
        uint128 refill;
        uint128 maxRefill;
        uint64 period;
        uint128 balance;
        uint64 timestamp;
    }

    mapping(bytes32 key => Allowance) internal _allowances;

    constructor(address owner_, address avatar_, address target_) {
        owner = owner_;
        avatar = avatar_;
        target = target_;
    }

    function setAllowanceStub(bytes32 key, Allowance calldata a) external {
        _allowances[key] = a;
    }

    function allowances(bytes32 key)
        external
        view
        returns (uint128 refill, uint128 maxRefill, uint64 period, uint128 balance, uint64 timestamp)
    {
        Allowance memory a = _allowances[key];
        return (a.refill, a.maxRefill, a.period, a.balance, a.timestamp);
    }
}

/// @dev Hats Signer Gate v2's Safe, owner hat and signer hat.
contract GateStub {
    address public safe;
    uint256 public ownerHat;
    uint256 internal _signerHat;

    constructor(address safe_, uint256 ownerHat_, uint256 signerHat_) {
        safe = safe_;
        ownerHat = ownerHat_;
        _signerHat = signerHat_;
    }

    function isValidSignerHat(uint256 hatId) external view returns (bool) {
        return hatId == _signerHat;
    }

    function claimableFor() external pure returns (bool) {
        return true;
    }

    /// @dev ABSOLUTE {1, 1}: the stub Safe's threshold of 1 already matches it, as the fuzz fixtures expect.
    function thresholdConfig() external pure returns (IHatsSignerGate.ThresholdConfig memory) {
        return IHatsSignerGate.ThresholdConfig({
            thresholdType: IHatsSignerGate.TargetThresholdType.ABSOLUTE, min: 1, target: 1
        });
    }
}

/// @dev Hats Protocol v1's reads: who wears what, and each hat's settings.
contract HatsStub {
    struct Hat {
        uint32 maxSupply;
        uint32 supply;
        address eligibility;
        address toggle;
        bool mutable_;
    }

    mapping(uint256 hatId => Hat) internal _hats;
    mapping(uint256 hatId => mapping(address account => bool)) internal _worn;
    mapping(uint256 hatId => mapping(address account => bool)) internal _admin;

    function setHat(
        uint256 hatId,
        uint32 maxSupply,
        uint32 supply,
        address eligibility,
        address toggle,
        bool mutable_
    )
        external
    {
        _hats[hatId] = Hat(maxSupply, supply, eligibility, toggle, mutable_);
    }

    function setWearer(uint256 hatId, address account, bool on) external {
        _worn[hatId][account] = on;
    }

    function setAdmin(uint256 hatId, address account, bool on) external {
        _admin[hatId][account] = on;
    }

    function isWearerOfHat(address account, uint256 hatId) external view returns (bool) {
        return _worn[hatId][account];
    }

    function isInGoodStanding(address, uint256) external pure returns (bool) {
        return true;
    }

    function isAdminOfHat(address account, uint256 hatId) external view returns (bool) {
        return _admin[hatId][account];
    }

    function hatSupply(uint256 hatId) external view returns (uint32) {
        return _hats[hatId].supply;
    }

    function viewHat(uint256 hatId)
        external
        view
        returns (
            string memory details,
            uint32 maxSupply,
            uint32 supply,
            address eligibility,
            address toggle,
            string memory imageURI,
            uint16 lastHatId,
            bool mutable_,
            bool active
        )
    {
        Hat memory h = _hats[hatId];
        return ("", h.maxSupply, h.supply, h.eligibility, h.toggle, "", 0, h.mutable_, h.maxSupply > 0);
    }
}
