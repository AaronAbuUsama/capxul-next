// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Hats} from "./Hats.sol";
import {Payments} from "./Payments.sol";
import {TestUSDC} from "./TestUSDC.sol";

/// STAND-IN Safe: a contract that lets Payments spend its test USDC. The real thing is a Safe with a module.
contract SafeStandIn {
    constructor(TestUSDC usdc, address spender) {
        usdc.approve(spender, type(uint256).max);
    }
}

/// STAND-IN for org creation.
contract Orgs {
    Hats public immutable hats;
    Payments public immutable payments;
    TestUSDC public immutable usdc;
    mapping(bytes32 => bool) public exists;

    error OrgExists();

    event OrgCreated(bytes32 indexed org, string slug, address safe, address admin, uint256 budget);

    constructor(Hats h, Payments p, TestUSDC u) {
        hats = h;
        payments = p;
        usdc = u;
    }

    function createOrg(string calldata slug, address admin, uint256 budget, uint256 funding)
        external
        returns (address safe)
    {
        bytes32 org = keccak256(bytes(slug));
        if (exists[org]) revert OrgExists();
        exists[org] = true;
        safe = address(new SafeStandIn(usdc, address(payments)));
        usdc.mint(safe, funding);
        payments.initOrg(org, safe, budget);
        hats.bootstrapAdmin(org, admin);
        emit OrgCreated(org, slug, safe, admin, budget);
    }
}
