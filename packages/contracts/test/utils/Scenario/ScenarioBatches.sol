// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IGovernor } from "../../../src/interfaces/IGovernor.sol";
import { IInstaller } from "../../../src/interfaces/IInstaller.sol";
import { ISafe } from "../../fork/Interfaces.sol";
import { ScenarioExitCalls } from "./ScenarioExitCalls.sol";

/// @notice Batches and votes, the calls that wrap other calls:
///
/// - `Board.approveHash` (`args: {}`): a Director's Safe approves the company Safe transaction of the next
///   `Board.execTransaction` event, at the Safe's current nonce (ruling D1).
/// - `Board.execTransaction` (`args: { calls }`): a Director's Safe executes it, with a v = 1 signature for itself
///   and for every Director whose Safe approved since the last Board batch, in owner order.
/// - `Safe.batch` (`args: { calls }`): the actor's own Safe runs the calls as one MultiSendCallOnly batch.
/// - `Governor.propose` (`{ calls, description }`), `Governor.castVote` (`{ description, support }`),
///   `Governor.execute` (`{ description }`): a vote names its proposal by description.
///
/// In a batch, one plain call is sent as a call; anything else is a MultiSendCallOnly 1.4.1 delegatecall.
/// `Installer.buildMoney` and `Installer.buildEquity` stand for the calls they return (`buildEquity`: the Safe's
/// calls in a Board batch, the founder's calls in a `Safe.batch`).
abstract contract ScenarioBatches is ScenarioExitCalls {
    error NoBoardBatchAfter(string eventPath);
    error NoProposal(string description);

    function _encode(
        string memory call,
        string memory args
    )
        internal
        view
        virtual
        override
        returns (address target, bytes memory data)
    {
        bytes32 c = keccak256(bytes(call));
        args = _ref(args);
        if (c == keccak256("Board.approveHash")) return _approve(args);
        if (c == keccak256("Board.execTransaction")) return _boardExec(args);
        if (c == keccak256("Safe.batch")) return _safeBatch(args);
        if (_startsWith(call, "Governor.")) return (_equity().governor, _governor(c, args, _eventOf(args)));
        bool found;
        (found, target, data) = _moneyCall(call, args);
        if (found) return (target, data);
        (found, target, data) = _equityCall(call, args);
        if (found) return (target, data);
        (found, target, data) = _exitCall(call, args);
        if (found) return (target, data);
        return super._encode(call, args);
    }

    // ------------------------------------------------------------------ Board batches (D1)

    function _approve(string memory args) internal view returns (address, bytes memory) {
        uint256 j = _indexOf(_eventOf(args)) + 1;
        while (true) {
            if (!vm.keyExistsJson(json, string.concat(".events[", vm.toString(j), "]"))) {
                revert NoBoardBatchAfter(_eventOf(args));
            }
            if (keccak256(bytes(_call(j))) == keccak256("Board.execTransaction")) break;
            ++j;
        }
        (address to, bytes memory data, uint8 op) =
            _batch(string.concat(".events[", vm.toString(j), "].args.calls"), true);
        ISafe company = ISafe(_company());
        bytes32 h = company.getTransactionHash(to, 0, data, op, 0, 0, 0, address(0), address(0), company.nonce());
        return (address(company), abi.encodeCall(ISafe.approveHash, (h)));
    }

    function _boardExec(string memory args) internal view returns (address, bytes memory) {
        (address to, bytes memory data, uint8 op) = _batch(string.concat(args, ".calls"), true);
        bytes memory signatures = _approvals(_eventOf(args));
        return (
            _company(),
            abi.encodeCall(ISafe.execTransaction, (to, 0, data, op, 0, 0, 0, address(0), payable(0), signatures))
        );
    }

    /// @dev v = 1 signatures, ascending: the executing Director and every Director who approved since the last
    /// Board batch.
    function _approvals(string memory eventPath) internal view returns (bytes memory signatures) {
        uint256 i = _indexOf(eventPath);
        address[] memory signers = new address[](i + 1);
        uint256 n;
        signers[n++] = _identity(vm.parseJsonString(json, string.concat(eventPath, ".actor")));
        for (uint256 k = i; k > 0; --k) {
            bytes32 c = keccak256(bytes(_call(k - 1)));
            if (c == keccak256("Board.execTransaction")) break;
            if (c != keccak256("Board.approveHash")) continue;
            signers[n++] = _identity(vm.parseJsonString(json, string.concat(".events[", vm.toString(k - 1), "].actor")));
        }
        for (uint256 a; a < n; ++a) {
            for (uint256 b = a + 1; b < n; ++b) {
                if (signers[b] < signers[a]) (signers[a], signers[b]) = (signers[b], signers[a]);
            }
        }
        for (uint256 a; a < n; ++a) {
            if (a > 0 && signers[a] == signers[a - 1]) continue;
            signatures =
                bytes.concat(signatures, abi.encodePacked(bytes32(uint256(uint160(signers[a]))), bytes32(0), uint8(1)));
        }
    }

    // ------------------------------------------------------------------ a person's own batch

    /// @dev One call goes out as a call from the actor's Safe. A batch goes out as the Safe executing its own
    /// MultiSendCallOnly delegatecall, signed by the actor's key at the nonce after the outer transaction's.
    function _safeBatch(string memory args) internal view returns (address, bytes memory) {
        (address to, bytes memory data, uint8 op) = _batch(string.concat(args, ".calls"), false);
        if (op == CALL) return (to, data);
        string memory actor = vm.parseJsonString(json, string.concat(_eventOf(args), ".actor"));
        ISafe safe = ISafe(_identity(actor));
        bytes32 h = safe.getTransactionHash(to, 0, data, op, 0, 0, 0, address(0), address(0), safe.nonce() + 1);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(uint256(keccak256(abi.encodePacked(actor))), h);
        return (
            address(safe),
            abi.encodeCall(
                ISafe.execTransaction, (to, 0, data, op, 0, 0, 0, address(0), payable(0), abi.encodePacked(r, s, v))
            )
        );
    }

    // ------------------------------------------------------------------ batches

    function _batch(string memory callsPath, bool board) internal view returns (address, bytes memory, uint8) {
        callsPath = _ref(callsPath);
        uint256 n = _count(callsPath);
        bytes memory packed;
        for (uint256 i; i < n; ++i) {
            string memory cp = string.concat(callsPath, "[", vm.toString(i), "]");
            string memory call = _str(cp, "call");
            string memory ap = _ref(string.concat(cp, ".args"));
            if (_startsWith(call, "Installer.build")) {
                IInstaller.Call[] memory built = _built(call, ap, board);
                for (uint256 k; k < built.length; ++k) {
                    packed = bytes.concat(packed, _packed(built[k].to, built[k].value, built[k].data));
                }
                continue;
            }
            (address t, bytes memory d) = _encode(call, ap);
            if (n == 1) return (t, d, CALL);
            packed = bytes.concat(packed, _packed(t, 0, d));
        }
        return (MULTI_SEND_CALL_ONLY, abi.encodeWithSignature("multiSend(bytes)", packed), DELEGATECALL);
    }

    function _built(string memory call, string memory ap, bool board) internal view returns (IInstaller.Call[] memory) {
        IInstaller installer = IInstaller(_contract("Installer"));
        string memory p = string.concat(ap, ".p");
        if (keccak256(bytes(call)) == keccak256("Installer.buildMoney")) return installer.buildMoney(_moneyInstall(p));
        if (keccak256(bytes(call)) != keccak256("Installer.buildEquity")) revert UnknownCall(call);
        (IInstaller.Call[] memory safeCalls, IInstaller.Call[] memory founderCalls) =
            installer.buildEquity(_equityInstall(p));
        return board ? safeCalls : founderCalls;
    }

    /// @dev MultiSendCallOnly's encoding of one plain call (operation 0).
    function _packed(address to, uint256 value, bytes memory data) internal pure returns (bytes memory) {
        return abi.encodePacked(uint8(0), to, value, data.length, data);
    }

    // ------------------------------------------------------------------ the company Governor

    function _governor(bytes32 c, string memory args, string memory eventPath) internal view returns (bytes memory) {
        if (c == keccak256("Governor.propose")) {
            (address[] memory t, uint256[] memory v, bytes[] memory d) = _proposal(args);
            return abi.encodeWithSignature(
                "propose(address[],uint256[],bytes[],string)", t, v, d, _str(args, "description")
            );
        }
        string memory description = _str(args, "description");
        (address[] memory targets, uint256[] memory values, bytes[] memory calldatas) =
            _proposal(_proposed(description, _indexOf(eventPath)));
        bytes32 descriptionHash = keccak256(bytes(description));
        if (c == keccak256("Governor.execute")) {
            return abi.encodeWithSignature(
                "execute(address[],uint256[],bytes[],bytes32)", targets, values, calldatas, descriptionHash
            );
        }
        if (c != keccak256("Governor.castVote")) revert UnknownCall("Governor");
        uint256 id = IGovernor(_equity().governor).hashProposal(targets, values, calldatas, descriptionHash);
        return abi.encodeWithSignature("castVote(uint256,uint8)", id, uint8(_u(args, "support")));
    }

    function _proposal(string memory args)
        internal
        view
        returns (address[] memory targets, uint256[] memory values, bytes[] memory calldatas)
    {
        string memory calls = _ref(string.concat(args, ".calls"));
        uint256 n = _count(calls);
        targets = new address[](n);
        values = new uint256[](n);
        calldatas = new bytes[](n);
        for (uint256 i; i < n; ++i) {
            string memory cp = string.concat(calls, "[", vm.toString(i), "]");
            (targets[i], calldatas[i]) = _encode(_str(cp, "call"), string.concat(cp, ".args"));
        }
    }

    /// @dev The args of the latest `Governor.propose` event before event `before` with this description.
    function _proposed(string memory description, uint256 before) internal view returns (string memory) {
        for (uint256 i = before; i > 0; --i) {
            if (keccak256(bytes(_call(i - 1))) != keccak256("Governor.propose")) continue;
            string memory args = string.concat(".events[", vm.toString(i - 1), "].args");
            if (keccak256(bytes(_str(args, "description"))) == keccak256(bytes(description))) return args;
        }
        revert NoProposal(description);
    }
}
