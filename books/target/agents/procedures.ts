// Agents' door: the procedures other concepts invoke inside their own transaction. There are none.
//
// A procedure exists only for one money fact (P4, decision rules.procedures), and no concept above
// agents writes an agent or an agent change together with a money fact of its own:
// - a concept that names an agent (budgets' holders and wearers, payments' recipients, requests'
//   payers) names its Party, which parties resolves by its `@handle`; it reads nothing of agents;
// - organizations ends a removed agent's Seats from AgentOwner's AgentRemoved on chain, not from a
//   call here (dependencies.agent-seats), and organizations sits below agents in any case;
// - access proves an agent's sign-in on chain (AgentOwner.agentOf and the Safe's owners), so it
//   needs no agents table (concepts.access).
// Agents itself writes below through parties' (`parties.register`, `parties.activate`,
// `parties.release`, `parties.resolve-recipient`), approvals' (`approvals.open`) and board's
// (`board.propose`) procedures, each one money fact with the agent or change it births or ends.
// Decision agents.no-door.

export {};
