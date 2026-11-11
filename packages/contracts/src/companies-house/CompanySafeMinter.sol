// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

interface ISafeProxyFactoryForMint {
    function createProxyWithNonce(
        address singleton,
        bytes memory initializer,
        uint256 saltNonce
    )
        external
        returns (address proxy);
}

interface ISafeForMint {
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

/// @title CompanySafeMinter
/// @notice The one thing a Companies House company role may do: deploy a company's Safe if it is not
/// there yet, and swap the Companies House owner out for the founder's personal Safe.
/// @dev The company counterpart of `CompaniesHouseClaimer` (CAP-1093). A Roles role on Companies House
/// may only DELEGATECALL `mint` here, with its tier's company namespace pinned, so the code runs as
/// Companies House: `address(this)` is the bootstrap owner written into the Safe's `setup`, and the
/// Safe accepts the swap through Safe's "caller is owner" signature (v = 1). Only Companies House can
/// therefore make a Safe at a derived company address with anyone but itself as owner.
///
/// The company Safe is `setup([companiesHouse], 1, 0, "", COMPATIBILITY_FALLBACK_HANDLER, 0, 0, 0)`:
/// no module and no 4337 module, the shape the Installer's money install expects (installer.md).
/// The salt nonce is `keccak256(abi.encode(namespace, company, founderSafe))`, so the founder is part
/// of the address and a role member cannot take a company's address for another founder.
/// It holds no state and writes no storage, so a delegatecall cannot change Companies House.
contract CompanySafeMinter {
    // Safe v1.5.0 (SafeL2) and its CompatibilityFallbackHandler, the same address on every chain with
    // the canonical deployments.
    address internal constant SAFE_PROXY_FACTORY = 0x14F2982D601c9458F93bd70B218933A6f8165e7b;
    address internal constant SAFE_L2_SINGLETON = 0xEdd160fEBBD92E350D4D398fb636302fccd67C7e;
    address internal constant COMPATIBILITY_FALLBACK_HANDLER = 0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4;
    address internal constant SENTINEL_OWNERS = address(0x1);

    /// @dev This contract's own address, to refuse a plain call.
    address private immutable self;

    /// @notice A company's Safe now has the founder's personal Safe as its sole owner.
    event CompanySafeMinted(address indexed safe, address indexed founderSafe, string company, bool deployed);

    /// @notice `mint` ran as a plain call, not as Companies House's delegatecall.
    error NotDelegateCall();
    /// @notice The namespace is empty.
    error EmptyNamespace();
    /// @notice The company id is empty.
    error EmptyCompany();
    /// @notice The founder's Safe is zero, the owners sentinel, Companies House, or has no code.
    error InvalidFounderSafe();
    /// @notice The factory deployed somewhere other than the derived address.
    error DerivedAddressMismatch(address expected, address deployed);
    /// @notice The Safe refused the owner swap.
    error SwapRefused();

    constructor() {
        self = address(this);
    }

    /// @notice Deploy the company Safe for `namespace`, `company` and `founderSafe` if it has no code,
    /// then make `founderSafe` its sole owner.
    /// @param namespace The tier's company namespace, for example `capxul:devnet:company:v1`.
    /// @param company The company's id in Capxul.
    /// @param founderSafe The founder's personal Safe.
    /// @return safe The minted company Safe.
    function mint(
        string calldata namespace,
        string calldata company,
        address founderSafe
    )
        external
        returns (address safe)
    {
        if (address(this) == self) revert NotDelegateCall();
        if (bytes(namespace).length == 0) revert EmptyNamespace();
        if (bytes(company).length == 0) revert EmptyCompany();
        address bootstrap = address(this);
        if (
            founderSafe == address(0) || founderSafe == SENTINEL_OWNERS || founderSafe == bootstrap
                || founderSafe.code.length == 0
        ) revert InvalidFounderSafe();

        bytes memory initializer = _initializer(bootstrap);
        uint256 saltNonce = _saltNonce(namespace, company, founderSafe);
        safe = _safeAddress(initializer, saltNonce);

        bool deployed = safe.code.length == 0;
        if (deployed) {
            address proxy = ISafeProxyFactoryForMint(SAFE_PROXY_FACTORY)
                .createProxyWithNonce(SAFE_L2_SINGLETON, initializer, saltNonce);
            if (proxy != safe) revert DerivedAddressMismatch(safe, proxy);
        }

        // v = 1: the signature is approved because msg.sender (Companies House) is the owner named in r.
        bytes memory signature = abi.encodePacked(uint256(uint160(bootstrap)), bytes32(0), uint8(1));
        bool swapped = ISafeForMint(safe)
            .execTransaction(
                safe,
                0,
                abi.encodeCall(ISafeForMint.swapOwner, (SENTINEL_OWNERS, bootstrap, founderSafe)),
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
        emit CompanySafeMinted(safe, founderSafe, company, deployed);
    }

    /// @notice The company Safe address for a bootstrap owner, namespace, company and founder's Safe.
    function companySafeAddressFor(
        address owner,
        string calldata namespace,
        string calldata company,
        address founderSafe
    )
        external
        pure
        returns (address)
    {
        return _safeAddress(_initializer(owner), _saltNonce(namespace, company, founderSafe));
    }

    function _saltNonce(
        string calldata namespace,
        string calldata company,
        address founderSafe
    )
        internal
        pure
        returns (uint256)
    {
        return uint256(keccak256(abi.encode(namespace, company, founderSafe)));
    }

    function _initializer(address owner) internal pure returns (bytes memory) {
        address[] memory owners = new address[](1);
        owners[0] = owner;
        return abi.encodeWithSignature(
            "setup(address[],uint256,address,bytes,address,address,uint256,address)",
            owners,
            uint256(1),
            address(0),
            bytes(""),
            COMPATIBILITY_FALLBACK_HANDLER,
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
}
