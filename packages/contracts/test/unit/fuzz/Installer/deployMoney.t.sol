// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IInstaller } from "../../../../src/interfaces/IInstaller.sol";
import { Installer_Hermetic_Base } from "../../../utils/Installer/Installer_Hermetic_Base.sol";

/// @notice deployMoney's refusals over their whole input ranges (trees/Installer/deployMoney.tree). The valid path
/// creates hats and modules on the real contracts, so it is a fork test (test/unit/concrete/Installer/deployMoney).
contract DeployMoney_Installer_Unit_Fuzz_Test is Installer_Hermetic_Base {
    /// @dev Any address without code, as the Safe or the founder's Safe, is refused.
    function testFuzz_RevertWhen_TheSafeOrTheFoundersSafeHasNoCode(address noCode, bool asFounder) external {
        vm.assume(noCode.code.length == 0);
        IInstaller.MoneyDeploy memory p = _moneyDeploy(new address[](0), 1);
        if (asFounder) p.founderSafe = noCode;
        else p.safe = noCode;
        vm.expectRevert(
            _refused(asFounder ? IInstaller.InstallRefusal.FounderSafeInvalid : IInstaller.InstallRefusal.SafeInvalid)
        );
        installer.deployMoney(p);
    }

    /// @dev Any co-Director list with one entry zero, code-less, the founder's Safe, or repeated, is refused.
    function testFuzz_RevertWhen_ACoDirectorIsInvalid(uint8 count, uint256 at, uint256 other, uint8 kind) external {
        uint256 n = bound(count, 2, MAX_CO_DIRECTORS);
        address[] memory co = _coDirectors(n, 0);
        uint256 i = bound(at, 0, n - 1);
        uint256 k = bound(kind, 0, 3);
        if (k == 0) {
            co[i] = address(0);
        } else if (k == 1) {
            co[i] = makeAddr("no code");
        } else if (k == 2) {
            co[i] = address(founderSafe);
        } else {
            uint256 j = bound(other, 0, n - 1);
            if (j == i) j = (i + 1) % n;
            co[i] = co[j];
        }
        vm.expectRevert(_refused(IInstaller.InstallRefusal.CoDirectorInvalid));
        installer.deployMoney(_moneyDeploy(co, 1));
    }

    /// @dev A minimum of 0, or above the number of founding Directors (1 + co-Directors), is refused (F3).
    function testFuzz_RevertWhen_TheThresholdMinIsZeroOrAboveTheDirectors(
        uint8 count,
        uint120 min,
        bool zero
    )
        external
    {
        uint256 n = bound(count, 0, MAX_CO_DIRECTORS);
        address[] memory co = _coDirectors(n, 0);
        uint120 bad = zero ? 0 : uint120(bound(min, n + 2, type(uint120).max));
        vm.expectRevert(_refused(IInstaller.InstallRefusal.ThresholdInvalid));
        installer.deployMoney(_moneyDeploy(co, bad));
    }
}
