// The equity area: an invited investor is told about the round or SAFE they may join. Equity's round
// process moves an investor's place to `invited` once the Board's invitation landed on chain
// (Invited or SafeInvited); notices follows that transition (dependencies.of-notices: "a round or
// SAFE invitation"). Old organizations sent no email for it: the investor learned of it only from
// `capxul invest`. Equity is low priority, and so is this notice.

import { table_principals } from "../access/data.ts";
import { machine_fundraise_investment, table_fundraise_investments, table_fundraise_rounds } from "../equity/data.ts";
import { table_organizations } from "../organizations/data.ts";
import { table_parties } from "../parties/data.ts";
import { noticeWorkflow } from "./kit.ts";

export const workflow_notices_equity_round_invitation = noticeWorkflow({
  id: "notices.equity.round-invitation",
  title: "Tell an investor they are invited to a round or SAFE",
  about:
    "Follows `invite`: the Board's invitation of an investor landed on chain, so they may commit (a priced round) or " +
    "sign and pay (a SAFE) up to what they were invited for. Sends `round-invitation` to the investor's mailbox, else " +
    "their principal's email, with the company's name, the round's kind and terms, the most they may invest, the close " +
    "or pay-by day and the `capxul invest` line. An investor Capxul has no mailbox for is told nothing.",
  priority: "low",
  trigger: { transition: machine_fundraise_investment.t.invite },
  reads: [table_fundraise_investments, table_fundraise_rounds, table_organizations, table_parties, table_principals],
  steps: [
    { name: "investment", about: "Reads the investor's place and its round: the kind, the terms, the most invited and the days." },
    { name: "investor", about: "The investor at `investor_email`, else the principal at `investor_safe` and its email." },
  ],
  was: [
    "apps/docs/factory/operations/org.round.invite.yaml",
    "apps/docs/factory/operations/org.safe.invite.yaml",
    "books/target/equity/data.ts (fundraise_investment_transitioned: notices reacts to invite)",
  ],
});
