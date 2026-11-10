// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @dev Hats Protocol v1 reads for hermetic tests, set directly by the test. As the real Hats, a
/// wearer in bad standing does not wear the hat. Hat trees, eligibility and toggle modules are tested
/// on the fork.
contract MockHats {
    mapping(uint256 hatId => mapping(address account => bool)) internal _worn;
    mapping(uint256 hatId => mapping(address account => bool)) internal _badStanding;
    mapping(uint256 hatId => mapping(address account => bool)) internal _admin;

    function setWearer(uint256 hatId, address account, bool on) external {
        _worn[hatId][account] = on;
    }

    function setStanding(uint256 hatId, address account, bool good) external {
        _badStanding[hatId][account] = !good;
    }

    function setAdmin(uint256 hatId, address account, bool on) external {
        _admin[hatId][account] = on;
    }

    function isWearerOfHat(address account, uint256 hatId) external view returns (bool) {
        return _worn[hatId][account] && !_badStanding[hatId][account];
    }

    function isInGoodStanding(address account, uint256 hatId) external view returns (bool) {
        return !_badStanding[hatId][account];
    }

    function isAdminOfHat(address account, uint256 hatId) external view returns (bool) {
        return _admin[hatId][account];
    }
}
