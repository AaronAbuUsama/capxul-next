// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Hats} from "./Hats.sol";
import {TestUSDC} from "./TestUSDC.sol";

/// STAND-IN for the payments module. Moves test USDC out of an org's Safe stand-in.
contract Payments {
    bytes32 internal constant ADMIN = keccak256("admin");
    bytes32 internal constant BUDGET_HOLDER = keccak256("budget-holder");

    Hats public immutable hats;
    TestUSDC public immutable usdc;
    address public immutable deployer = msg.sender;
    address public orgs;
    uint256 public nonce;
    mapping(bytes32 => address) public safeOf;
    mapping(bytes32 => uint256) public budgetLeft;

    error NotOrgs();
    error AlreadySet();
    error UnknownOrg();
    error NotAuthorised();
    error OverBudget(uint256 left, uint256 asked);

    event PaymentSent(
        bytes32 indexed paymentId,
        bytes32 indexed org,
        address from,
        address indexed to,
        uint256 amount,
        bytes32 documentHash
    );

    constructor(Hats h, TestUSDC u) {
        hats = h;
        usdc = u;
    }

    function setOrgs(address o) external {
        if (msg.sender != deployer || orgs != address(0)) revert AlreadySet();
        orgs = o;
    }

    function initOrg(bytes32 org, address safe, uint256 budget) external {
        if (msg.sender != orgs) revert NotOrgs();
        safeOf[org] = safe;
        budgetLeft[org] = budget;
    }

    function send(bytes32 org, address to, uint256 amount, bytes32 documentHash) external returns (bytes32 id) {
        address safe = safeOf[org];
        if (safe == address(0)) revert UnknownOrg();
        if (!hats.wearsHash(org, msg.sender, ADMIN) && !hats.wearsHash(org, msg.sender, BUDGET_HOLDER)) {
            revert NotAuthorised();
        }
        if (amount > budgetLeft[org]) revert OverBudget(budgetLeft[org], amount);
        budgetLeft[org] -= amount;
        usdc.transferFrom(safe, to, amount);
        id = keccak256(abi.encode(org, ++nonce, documentHash));
        emit PaymentSent(id, org, safe, to, amount, documentHash);
    }
}
