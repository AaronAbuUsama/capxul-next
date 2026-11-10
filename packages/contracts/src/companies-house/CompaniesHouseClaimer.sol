// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

interface ISafeProxyFactoryForClaim {
    function createProxyWithNonce(
        address singleton,
        bytes memory initializer,
        uint256 saltNonce
    )
        external
        returns (address proxy);
}

interface ISafeForClaim {
    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes memory signatures
    )
        external
        payable
        returns (bool);
    function swapOwner(address prevOwner, address oldOwner, address newOwner) external;
}

interface IMultiSendForClaim {
    function multiSend(bytes memory transactions) external payable;
}

interface ISafeModuleSetupForClaim {
    function enableModules(address[] calldata modules) external;
}

/// @title CompaniesHouseClaimer
/// @notice The one thing a Companies House service role may do: deploy a Capxul
/// personal Safe if it is not there yet, and swap the Companies House owner out
/// for the person's signer.
/// @dev Companies House is the bootstrap owner of every Capxul personal Safe
/// (CAP-985). A Roles role on Companies House may only DELEGATECALL `claim`
/// here, with its tier's salt namespace pinned, so the code runs as Companies
/// House: `address(this)` is the bootstrap owner, and the Safe accepts the swap
/// through Safe's "caller is owner" signature (v = 1). Roles can only allow
/// fixed target addresses, so this fixed contract keeps the permission narrow:
/// it can only reach the Safe that the namespace and email derive.
///
/// The derivation repeats the protocol package's `safe-address.ts` byte for byte:
/// `setup([owner], 1, MULTI_SEND, multiSend(delegatecall SafeModuleSetup.enableModules([SAFE_4337_MODULE])),
/// SAFE_4337_MODULE, 0, 0, 0)`, salt nonce `keccak256(namespace ":" email)`.
/// It holds no state and writes no storage, so a delegatecall cannot change
/// Companies House.
contract CompaniesHouseClaimer {
    // Safe v1.5.0 (SafeL2) and Safe4337Module 0.3.0, the same address on every
    // chain with the canonical deployments. MultiSend stays 1.4.1: it is a stateless library that
    // works with any Safe version.
    address internal constant SAFE_PROXY_FACTORY = 0x14F2982D601c9458F93bd70B218933A6f8165e7b;
    address internal constant SAFE_L2_SINGLETON = 0xEdd160fEBBD92E350D4D398fb636302fccd67C7e;
    address internal constant SAFE_MODULE_SETUP = 0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47;
    address internal constant SAFE_4337_MODULE = 0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226;
    address internal constant MULTI_SEND = 0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526;
    address internal constant SENTINEL_OWNERS = address(0x1);

    /// @dev This contract's own address, to refuse a plain call.
    address private immutable self;

    /// @notice A Capxul personal Safe now has the person's signer as its sole owner.
    event CapxulSafeClaimed(address indexed safe, address indexed signer, bool deployed);

    /// @notice `claim` ran as a plain call, not as Companies House's delegatecall.
    error NotDelegateCall();
    /// @notice The namespace is empty.
    error EmptyNamespace();
    /// @notice The email is empty, not trimmed and lowercased, or not ASCII.
    error EmailNotNormalized();
    /// @notice The signer is zero, the owners sentinel, or Companies House itself.
    error InvalidSigner();
    /// @notice The factory deployed somewhere other than the derived address.
    error DerivedAddressMismatch(address expected, address deployed);
    /// @notice The Safe refused the owner swap.
    error SwapRefused();

    constructor() {
        self = address(this);
    }

    /// @notice Deploy the Capxul personal Safe for `namespace` and `email` if it
    /// has no code, then make `signer` its sole owner.
    /// @param namespace The tier's salt namespace, for example `capxul:beta:email:v1`.
    /// @param email The person's email, already trimmed and lowercased, ASCII only.
    /// @param signer The person's signer address.
    /// @return safe The claimed Safe.
    function claim(string calldata namespace, string calldata email, address signer) external returns (address safe) {
        if (address(this) == self) revert NotDelegateCall();
        if (bytes(namespace).length == 0) revert EmptyNamespace();
        _requireNormalized(bytes(email));
        address bootstrap = address(this);
        if (signer == address(0) || signer == SENTINEL_OWNERS || signer == bootstrap) revert InvalidSigner();

        bytes memory initializer = _initializer(bootstrap);
        // Must equal safe-address.ts's `namespace:email` salt; Roles pins each tier's namespace.
        // forge-lint: disable-next-line(encode-packed-collision)
        uint256 saltNonce = uint256(keccak256(abi.encodePacked(namespace, ":", email)));
        safe = _safeAddress(initializer, saltNonce);

        bool deployed = safe.code.length == 0;
        if (deployed) {
            address proxy = ISafeProxyFactoryForClaim(SAFE_PROXY_FACTORY)
                .createProxyWithNonce(SAFE_L2_SINGLETON, initializer, saltNonce);
            if (proxy != safe) revert DerivedAddressMismatch(safe, proxy);
        }

        // v = 1: the signature is approved because msg.sender (Companies House) is the owner named in r.
        bytes memory signature = abi.encodePacked(uint256(uint160(bootstrap)), bytes32(0), uint8(1));
        bool swapped = ISafeForClaim(safe)
            .execTransaction(
                safe,
                0,
                abi.encodeCall(ISafeForClaim.swapOwner, (SENTINEL_OWNERS, bootstrap, signer)),
                0,
                0,
                0,
                0,
                address(0),
                payable(address(0)),
                signature
            );
        if (!swapped) revert SwapRefused();
        // Calls go only to the canonical factory and the derived Safe proxy; neither can reenter here.
        // forge-lint: disable-next-line(reentrancy-events)
        emit CapxulSafeClaimed(safe, signer, deployed);
    }

    /// @notice The Capxul personal Safe address for an owner, namespace and email.
    function safeAddressFor(
        address owner,
        string calldata namespace,
        string calldata email
    )
        external
        pure
        returns (address)
    {
        // The same `namespace:email` salt as `claim`, byte for byte with safe-address.ts.
        // forge-lint: disable-next-line(encode-packed-collision)
        return _safeAddress(_initializer(owner), uint256(keccak256(abi.encodePacked(namespace, ":", email))));
    }

    function _initializer(address owner) internal pure returns (bytes memory) {
        address[] memory modules = new address[](1);
        modules[0] = SAFE_4337_MODULE;
        bytes memory enableModules = abi.encodeCall(ISafeModuleSetupForClaim.enableModules, (modules));
        // MultiSend payload: operation (1 = delegatecall), to, value, data length, data.
        bytes memory payload =
            abi.encodePacked(uint8(1), SAFE_MODULE_SETUP, uint256(0), uint256(enableModules.length), enableModules);
        bytes memory setupData = abi.encodeCall(IMultiSendForClaim.multiSend, (payload));
        address[] memory owners = new address[](1);
        owners[0] = owner;
        return abi.encodeWithSignature(
            "setup(address[],uint256,address,bytes,address,address,uint256,address)",
            owners,
            uint256(1),
            MULTI_SEND,
            setupData,
            SAFE_4337_MODULE,
            address(0),
            uint256(0),
            address(0)
        );
    }

    function _safeAddress(bytes memory initializer, uint256 saltNonce) internal pure returns (address) {
        bytes32 salt = keccak256(abi.encodePacked(keccak256(initializer), saltNonce));
        bytes32 codeHash = keccak256(abi.encodePacked(_proxyCreationCode(), uint256(uint160(SAFE_L2_SINGLETON))));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), SAFE_PROXY_FACTORY, salt, codeHash)))));
    }

    /// @dev `SafeProxyFactory.proxyCreationCode()` for Safe v1.5.0, as `SAFE_PROXY_CREATION_CODE`.
    function _proxyCreationCode() internal pure returns (bytes memory) {
        return hex"608060405234801561001057600080fd5b506040516101b63803806101b68339818101604052602081101561003357600080fd5b8101908080519060200190929190505050600073ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1614156100ca576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260228152602001806101946022913960400191505060405180910390fd5b806000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff16021790555050607b806101196000396000f3fe608060405260005463a619486e60003560e01c14156024578060601b606c5260206060f35b3660008037600080366000845af43d6000803e806040573d6000fd5b3d6000f3fea2646970667358221220e61834ebd2d8cd909d362bf67c47ef58fd665df38e6dd036ce65611101d072e964736f6c63430007060033496e76616c69642073696e676c65746f6e20616464726573732070726f7669646564";
    }

    function _requireNormalized(bytes calldata email) internal pure {
        uint256 length = email.length;
        if (length == 0 || uint8(email[0]) <= 0x20 || uint8(email[length - 1]) <= 0x20) {
            revert EmailNotNormalized();
        }
        for (uint256 index; index < length; ++index) {
            bytes1 character = email[index];
            // ASCII only: on chain no rule can lowercase other letters as `normalizeSafeSaltEmail` does.
            // Refusing at the first bad byte is the intent: the whole claim must revert.
            // forge-lint: disable-next-line(require-revert-in-loop)
            if ((character >= 0x41 && character <= 0x5a) || character >= 0x80) revert EmailNotNormalized();
        }
    }
}
