-- What Core keeps of the domain "budgets" (src/budgets): each budget's creation its Directors were asked to approve
-- (org.budget.create), and, once it landed, the budget the chain made. Every figure of a budget is the chain's
-- (Budgets.sol): Core keeps only its name, never on the chain and never in an event, and what it proposed. A company's
-- top budget is named as the company is, and has no row here. Applied when a world is created.

create table if not exists app.budget_creations (
  creation text primary key,
  org text not null references app.organizations (org),
  -- The budget it goes inside, by its id on the chain, and that budget's hat, which the new hat goes under.
  parent text not null,
  parent_hat text not null,
  name text not null,
  holder text not null,
  -- Per period, in the smallest unit of the parent's token.
  amount text not null,
  -- The hat its transaction makes and mints to the holder's Safe, by the id the chain gives it.
  hat text not null,
  proposal text not null unique,
  nonce integer not null,
  -- proposed until its transaction lands, then created.
  state text not null,
  -- The budget's id on the chain, once created.
  budget text,
  proposed_ms double precision not null
);
create index if not exists budget_creations_waiting on app.budget_creations (org, parent_hat) where state = 'proposed';
create unique index if not exists budget_creations_budget on app.budget_creations (org, budget) where budget is not null;
