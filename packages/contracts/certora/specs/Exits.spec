// Exits rules (docs/planning/protocol-v4/fv/certora.md "Exits.spec (W8)"; invariants H4 and H5). X1 to X4 are
// Halmos and Foundry checks (test/symbolic/Waterfall.symbolic.t.sol, test/invariant/Exits.invariant.t.sol).
//
// Summaries
// - Every neighbour Exits calls (Captable, Options, Vesting, Payments, EscrowFactory, the claim escrows, the
//   sale token) is NONDET or a fresh value: these rules are about who may call, not what the neighbours do.
// - Every state-changing Hats function sets `hatsMutated` (H5). Exits has no Hats reference at all.

methods {
    function boardSafe() external returns (address) envfree;

    function _.numberOfClasses() external => NONDET;
    function _.getClass(uint8) external => NONDET;
    function _.conversionPriceAt(uint8, uint256) external => NONDET;
    function _.burnForExit(uint8, address, uint128) external => NONDET;
    function _.closeForExit() external => NONDET;
    function _.forcedTransfer(uint8, address, address, uint128, bytes32) external => NONDET;
    function _.allocated() external => NONDET;
    function _.getGrant(uint256) external => NONDET;
    function _.classId() external => NONDET;
    function _.endAllForExit() external => NONDET;
    function _.grantOf(address, uint8, address) external => NONDET;
    function _.accelerateForExit(uint256) external => NONDET;
    function _.paymentId(IPayments.PaymentItem) external => NONDET;
    function _.paid(bytes32) external => NONDET;
    function _.send(IPayments.PaymentItem) external => NONDET;
    function _.deploy(IEscrow.Terms, bytes32) external => NONDET;
    function _.predictAddress(IEscrow.Terms, bytes32) external => NONDET;
    function _.refund() external => NONDET;
    function _.state() external => NONDET;
    function _.balanceOf(address) external => NONDET;
    function _.totalSupply() external => NONDET;
    function _.decimals() external => NONDET;
    function _.transfer(address, uint256) external => NONDET;
    function _.transferFrom(address, address, uint256) external => NONDET;
    function _.approve(address, uint256) external => NONDET;

    function _.mintTopHat(address, string, string) external => hatsMutation() expect uint256;
    function _.createHat(uint256, string, uint32, address, address, bool, string) external
        => hatsMutation() expect uint256;
    function _.mintHat(uint256, address) external => hatsMutationBool() expect bool;
    function _.transferHat(uint256, address, address) external => hatsMutationVoid() expect void;
    function _.changeHatEligibility(uint256, address) external => hatsMutationVoid() expect void;
    function _.changeHatToggle(uint256, address) external => hatsMutationVoid() expect void;
    function _.changeHatMaxSupply(uint256, uint32) external => hatsMutationVoid() expect void;
    function _.checkHatWearerStatus(uint256, address) external => hatsMutationBool() expect bool;
}

ghost bool hatsMutated;

function hatsMutation() returns uint256 {
    hatsMutated = true;
    uint256 x;
    return x;
}

function hatsMutationBool() returns bool {
    hatsMutated = true;
    bool x;
    return x;
}

function hatsMutationVoid() {
    hatsMutated = true;
}

/// H4: `settle` succeeds only for the company Safe. No hat, no Governor and no module satisfies it.
rule H4_boardOnly_Exits_settle(env e, uint256 saleId, IExits.Holding[] holdings, uint256[] claimIndexes) {
    address board = boardSafe();
    settle(e, saleId, holdings, claimIndexes);
    assert e.msg.sender == board, "settle by someone other than the Safe";
}

/// H4: `approveTransfer` succeeds only for the company Safe.
rule H4_boardOnly_Exits_approveTransfer(env e, uint256 transferId) {
    address board = boardSafe();
    approveTransfer(e, transferId);
    assert e.msg.sender == board, "approveTransfer by someone other than the Safe";
}

/// H4: no call changes who the Board is (the wiring is fixed at `initialize`, I3).
rule H4_boardFixed_Exits(env e, method f, calldataarg args) filtered {
    f -> !f.isView && f.selector != sig:initialize(address, address, address, address, address, address, address).selector
} {
    address before = boardSafe();
    require before != 0;
    f(e, args);
    assert boardSafe() == before, "the Board changed";
}

/// H5: Exits never calls a state-changing Hats function.
rule H5_noHatsMutation_Exits(env e, method f, calldataarg args) filtered { f -> !f.isView } {
    require !hatsMutated;
    f(e, args);
    assert !hatsMutated, "Exits changed Hats state";
}
