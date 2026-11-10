// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// STAND-IN for the hats protocol. Four hat names only. A department is carried in the event, not enforced.
contract Hats {
    bytes32 internal constant ADMIN = keccak256("admin");
    bytes32 internal constant BUDGET_HOLDER = keccak256("budget-holder");
    bytes32 internal constant PAYROLL_APPROVER = keccak256("payroll-approver");
    bytes32 internal constant MEMBER = keccak256("member");

    address public immutable deployer = msg.sender;
    address public orgs;
    mapping(bytes32 => mapping(address => mapping(bytes32 => bool))) private worn;

    error NotAdmin();
    error NotOrgs();
    error UnknownHat();
    error AlreadyWorn();
    error NotWorn();
    error AlreadySet();

    event HatGranted(bytes32 indexed org, address indexed wearer, string hat, string department, address by);
    event HatRevoked(bytes32 indexed org, address indexed wearer, string hat, string department, address by);

    function setOrgs(address o) external {
        if (msg.sender != deployer || orgs != address(0)) revert AlreadySet();
        orgs = o;
    }

    function wears(bytes32 org, address who, string calldata hat) external view returns (bool) {
        return worn[org][who][keccak256(bytes(hat))];
    }

    function wearsHash(bytes32 org, address who, bytes32 hatHash) external view returns (bool) {
        return worn[org][who][hatHash];
    }

    function grant(bytes32 org, string calldata hat, address to, string calldata department) external {
        if (!worn[org][msg.sender][ADMIN]) revert NotAdmin();
        _grant(org, hat, to, department);
    }

    function revoke(bytes32 org, string calldata hat, address from, string calldata department) external {
        if (!worn[org][msg.sender][ADMIN]) revert NotAdmin();
        bytes32 h = keccak256(bytes(hat));
        if (!worn[org][from][h]) revert NotWorn();
        worn[org][from][h] = false;
        emit HatRevoked(org, from, hat, department, msg.sender);
    }

    /// Called once by Orgs when an org is created: the creator's chosen admin gets the admin hat.
    function bootstrapAdmin(bytes32 org, address admin) external {
        if (msg.sender != orgs) revert NotOrgs();
        _grant(org, "admin", admin, "");
    }

    function _grant(bytes32 org, string memory hat, address to, string memory department) internal {
        bytes32 h = keccak256(bytes(hat));
        if (h != ADMIN && h != BUDGET_HOLDER && h != PAYROLL_APPROVER && h != MEMBER) revert UnknownHat();
        if (worn[org][to][h]) revert AlreadyWorn();
        worn[org][to][h] = true;
        emit HatGranted(org, to, hat, department, msg.sender);
    }
}
