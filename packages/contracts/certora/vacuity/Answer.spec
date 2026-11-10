// Gate 11's vacuity probe (docs/planning/protocol-v4/verification-loop.md, "TDD"). The rule calls
// get() without @withrevert, so the Prover drops reverting paths: on AnswerStub every path reverts and
// the rule holds vacuously unless --rule_sanity basic flags it.
methods {
    function get() external returns (uint256) envfree;
}

rule getReturnsOne() {
    assert get() == 1;
}
