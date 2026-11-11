// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";

import { ShareClass } from "../../../src/equity/ShareClass.sol";
import { ICaptable } from "../../../src/interfaces/ICaptable.sol";
import { IShareClass } from "../../../src/interfaces/IShareClass.sol";
import { Base_Test } from "../../Base.t.sol";
import { MockCaptableForShareClass } from "./MockCaptableForShareClass.sol";

/// @notice What every ShareClass test shares: an implementation, a clone of it owned by a mock Captable
/// whose Safe is Base_Test's company Safe, and helpers that act as the Captable.
abstract contract ShareClass_Shared_Test is Base_Test {
    string internal constant NAME = "Acme Ltd Common";
    string internal constant SYMBOL = "ACME.C";
    uint8 internal constant CLASS_ID = 1;

    /// @dev OpenZeppelin `Initializable`'s error, the "initializer error" of the trees.
    bytes4 internal constant INVALID_INITIALIZATION = bytes4(keccak256("InvalidInitialization()"));
    bytes32 internal constant DELEGATION_TYPEHASH =
        keccak256("Delegation(address delegatee,uint256 nonce,uint256 expiry)");
    bytes32 internal constant EIP712_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    ShareClass internal implementation;
    IShareClass internal token;
    MockCaptableForShareClass internal captable;

    function setUp() public virtual override {
        super.setUp();
        captable = new MockCaptableForShareClass(address(safe));
        implementation = new ShareClass();
        token = IShareClass(Clones.clone(address(implementation)));
        vm.label(address(captable), "Captable");
        vm.label(address(implementation), "ShareClass implementation");
        vm.label(address(token), "ShareClass");
        // Red first: on the stub `initialize` reverts NotImplemented, and every test then fails on its own
        // first call into the token. The initialize tree asserts the initialised state explicitly.
        try token.initialize(NAME, SYMBOL, address(captable), CLASS_ID) { } catch { }
    }

    function _mint(address to, uint256 amount) internal {
        vm.prank(address(captable));
        token.mint(to, amount);
    }

    function _burn(address from, uint256 amount) internal {
        vm.prank(address(captable));
        token.burn(from, amount);
    }

    function _forcedMove(address from, address to, uint256 amount) internal {
        vm.prank(address(captable));
        token.forcedMove(from, to, amount);
    }

    /// @dev Fails the test if `checkTransfer` is called during the next call.
    function _expectNoTransferCheck() internal {
        vm.expectCall(address(captable), abi.encodeWithSelector(ICaptable.checkTransfer.selector), 0);
    }

    /// @dev The EIP-712 delegation signature ERC20Votes accepts, domain (name, "1").
    function _delegationSig(
        uint256 key,
        address delegatee,
        uint256 nonce,
        uint256 expiry
    )
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 domain = keccak256(
            abi.encode(EIP712_TYPEHASH, keccak256(bytes(NAME)), keccak256("1"), block.chainid, address(token))
        );
        bytes32 structHash = keccak256(abi.encode(DELEGATION_TYPEHASH, delegatee, nonce, expiry));
        (v, r, s) = vm.sign(key, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
    }
}
