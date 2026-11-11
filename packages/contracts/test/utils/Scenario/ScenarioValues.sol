// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IInstaller } from "../../../src/interfaces/IInstaller.sol";
import { Addresses } from "../../fork/Addresses.sol";
import { Scenario_Test } from "../../scenario/Scenario_Test.t.sol";
import { ScenarioRelay } from "./ScenarioRelay.sol";

/// @notice How a v4 scenario names things (spec/scenario-player.md, extended for the money and equity chapters).
/// Every value in an event or a checkpoint can be a name:
///
/// - a uint: digits, digits `e` digits (`250000e6`), a UTC time (its Unix seconds), a name in `ids`, or a hat
///   (`Board`, `Shareholders`, `Director`, an officer's details);
/// - a bytes32: 0x and 64 hex digits, or any text, which stands for its keccak256;
/// - an address: a token or an `addresses` name, `money.<field>` / `equity.<field>` of the recorded deployment,
///   or anything `Scenario_Test._address` reads;
/// - a whole `args` object, or an array: a string that starts with an at sign, then a name, stands for `data.<name>`.
///
/// `anyone` calls to `Installer.deployMoney` and `Installer.deployEquity` go through a ScenarioRelay, which keeps
/// what they returned; the TypeScript player keeps the same from the dry run.
abstract contract ScenarioValues is Scenario_Test {
    address internal constant MULTI_SEND_CALL_ONLY = Addresses.MULTI_SEND_CALL_ONLY_141;

    ScenarioRelay internal relay;
    /// @dev The company Safe (the `company` actor's), cached: every Board batch and check reads it.
    address internal companySafe;

    error UnknownName(string name);
    error NotRecorded(string call);
    error NoCompany();

    // ------------------------------------------------------------------ values

    function _str(string memory p, string memory key) internal view returns (string memory) {
        return vm.parseJsonString(json, string.concat(p, ".", key));
    }

    function _u(string memory p, string memory key) internal view returns (uint256) {
        return _uint(_str(p, key));
    }

    function _a(string memory p, string memory key) internal view returns (address) {
        return _addr(_str(p, key));
    }

    function _b32(string memory p, string memory key) internal view returns (bytes32) {
        return _bytes32(_str(p, key));
    }

    function _bool(string memory p, string memory key) internal view returns (bool) {
        return vm.parseJsonBool(json, string.concat(p, ".", key));
    }

    function _addrs(string memory p) internal view returns (address[] memory out) {
        string[] memory names = vm.parseJsonStringArray(json, p);
        out = new address[](names.length);
        for (uint256 i; i < names.length; ++i) {
            out[i] = _addr(names[i]);
        }
    }

    function _uints(string memory p) internal view returns (uint256[] memory out) {
        string[] memory names = vm.parseJsonStringArray(json, p);
        out = new uint256[](names.length);
        for (uint256 i; i < names.length; ++i) {
            out[i] = _uint(names[i]);
        }
    }

    /// @dev Digits; digits `e` digits (`600000e6`); a UTC time `YYYY-MM-DDTHH:MM:SSZ` (Unix seconds); or a name.
    function _uint(string memory s) internal view returns (uint256) {
        bytes memory b = bytes(s);
        if (b.length == 20 && b[4] == "-" && b[10] == "T" && b[19] == "Z") return _isoTime(s);
        if (_digits(b)) return vm.parseUint(s);
        string[] memory parts = vm.split(s, "e");
        if (parts.length == 2 && _digits(bytes(parts[0])) && _digits(bytes(parts[1]))) {
            return vm.parseUint(parts[0]) * 10 ** vm.parseUint(parts[1]);
        }
        return _named(s);
    }

    function _digits(bytes memory b) internal pure returns (bool ok) {
        ok = b.length > 0;
        for (uint256 i; i < b.length && ok; ++i) {
            ok = b[i] >= "0" && b[i] <= "9";
        }
    }

    function _bytes32(string memory s) internal pure returns (bytes32) {
        bytes memory b = bytes(s);
        if (b.length == 66 && b[0] == "0" && b[1] == "x") return vm.parseBytes32(s);
        return keccak256(b);
    }

    /// @dev An `ids` name, or a hat of the recorded money deployment.
    function _named(string memory name) internal view returns (uint256) {
        string memory id = string.concat(".ids.", name);
        if (vm.keyExistsJson(json, id)) return vm.parseUint(vm.parseJsonString(json, id));
        IInstaller.MoneyDeployment memory d = _money();
        bytes32 h = keccak256(bytes(name));
        if (h == keccak256("Board")) return d.boardTopHat;
        if (h == keccak256("Shareholders")) return d.shareholdersTopHat;
        if (h == keccak256("Director")) return d.directorHat;
        string memory officers = string.concat(_eventCalling("Installer.deployMoney"), ".args.p.officers");
        for (uint256 i; i < d.officerHats.length; ++i) {
            if (keccak256(bytes(_str(string.concat(officers, "[", vm.toString(i), "]"), "details"))) == h) {
                return d.officerHats[i];
            }
        }
        revert UnknownName(name);
    }

    /// @dev See the contract's NatSpec for the forms.
    function _addr(string memory expression) internal view returns (address) {
        if (vm.keyExistsJson(json, string.concat(".tokens.", expression, ".address"))) {
            return vm.parseJsonAddress(json, string.concat(".tokens.", expression, ".address"));
        }
        if (vm.keyExistsJson(json, string.concat(".addresses.", expression))) {
            return vm.parseJsonAddress(json, string.concat(".addresses.", expression));
        }
        string[] memory parts = vm.split(expression, ".");
        if (parts.length == 2 && keccak256(bytes(parts[0])) == keccak256("money")) return _moneyField(parts[1]);
        if (parts.length == 2 && keccak256(bytes(parts[0])) == keccak256("equity")) return _equityField(parts[1]);
        return _address(expression);
    }

    /// @dev A string at `p` that starts with an at sign, then a name, stands for `.data.<name>`; else `p`.
    function _ref(string memory p) internal view returns (string memory) {
        try vm.parseJsonString(json, p) returns (string memory s) {
            bytes memory b = bytes(s);
            if (b.length > 1 && b[0] == "@") return string.concat(".data.", vm.replace(s, "@", ""));
        } catch { }
        return p;
    }

    // ------------------------------------------------------------------ the recorded deployment

    function _money() internal view returns (IInstaller.MoneyDeployment memory) {
        return
            abi.decode(
                _recorded(IInstaller.deployMoney.selector, "Installer.deployMoney"), (IInstaller.MoneyDeployment)
            );
    }

    function _equity() internal view returns (IInstaller.EquityDeployment memory) {
        return abi.decode(
            _recorded(IInstaller.deployEquity.selector, "Installer.deployEquity"), (IInstaller.EquityDeployment)
        );
    }

    function _hasEquity() internal view returns (bool) {
        return relay.result(_contract("Installer"), IInstaller.deployEquity.selector).length > 0;
    }

    function _recorded(bytes4 selector, string memory call) internal view returns (bytes memory r) {
        r = relay.result(_contract("Installer"), selector);
        if (r.length == 0) revert NotRecorded(call);
    }

    function _moneyField(string memory f) internal view returns (address) {
        IInstaller.MoneyDeployment memory d = _money();
        if (keccak256(bytes(f)) == keccak256("roles")) return d.roles;
        if (keccak256(bytes(f)) == keccak256("gate")) return d.gate;
        revert UnknownName(f);
    }

    function _equityField(string memory f) internal view returns (address) {
        IInstaller.EquityDeployment memory d = _equity();
        bytes32 h = keccak256(bytes(f));
        if (h == keccak256("captable")) return d.captable;
        if (h == keccak256("governor")) return d.governor;
        if (h == keccak256("options")) return d.options;
        if (h == keccak256("rounds")) return d.rounds;
        if (h == keccak256("exits")) return d.exits;
        if (h == keccak256("elections")) return d.elections;
        revert UnknownName(f);
    }

    // ------------------------------------------------------------------ the timeline

    /// @dev The company Safe: the one actor whose role is `company`.
    function _company() internal view returns (address) {
        return companySafe;
    }

    function _companyActor() internal view returns (string memory) {
        string[] memory names = vm.parseJsonKeys(json, ".actors");
        for (uint256 i; i < names.length; ++i) {
            if (keccak256(bytes(_role(names[i]))) == keccak256("company")) return names[i];
        }
        revert NoCompany();
    }

    /// @dev `.events[N]` from any path inside that event.
    function _eventOf(string memory p) internal pure returns (string memory) {
        bytes memory b = bytes(p);
        uint256 end;
        while (end < b.length && b[end] != "]") ++end;
        bytes memory out = new bytes(end + 1);
        for (uint256 i; i <= end; ++i) {
            out[i] = b[i];
        }
        return string(out);
    }

    function _indexOf(string memory eventPath) internal pure returns (uint256) {
        return vm.parseUint(vm.replace(vm.replace(eventPath, ".events[", ""), "]", ""));
    }

    function _call(uint256 i) internal view returns (string memory) {
        return vm.parseJsonString(json, string.concat(".events[", vm.toString(i), "].call"));
    }

    /// @dev The first event that calls `call`.
    function _eventCalling(string memory call) internal view returns (string memory) {
        for (uint256 i; vm.keyExistsJson(json, string.concat(".events[", vm.toString(i), "]")); ++i) {
            if (keccak256(bytes(_call(i))) == keccak256(bytes(call))) {
                return string.concat(".events[", vm.toString(i), "]");
            }
        }
        revert NotRecorded(call);
    }
}
