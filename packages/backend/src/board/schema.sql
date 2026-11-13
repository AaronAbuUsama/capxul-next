-- Blueprint board/data.ts. Epoch milliseconds are numbers; Safe nonces/blocks are safe integers.
create table if not exists app.board_proposals (
  org_id text not null references app.organizations, proposal_id text not null,
  chain_id integer not null, safe_address text not null, nonce bigint not null check (nonce between 0 and 9007199254740991),
  safe_tx_hash text not null, kind text not null check (kind in ('transaction','rejection','scheduled_payment')),
  rejects text, "to" text not null, value text not null, data text not null,
  operation text not null check (operation in ('call','delegatecall')), calls jsonb not null check (jsonb_typeof(calls)='array'),
  note text, opener text not null check (opener in ('board','agents','budgets','payments','payroll','equity')),
  subject_kind text not null, subject_id text not null, payment jsonb,
  proposer_principal_id text not null, proposer_safe text not null,
  status text not null check (status in ('awaiting_approvals','executed','failed','rejected','replaced')),
  approved_by text[] not null, threshold bigint check (threshold between 1 and 9007199254740991),
  settled_by_safe_tx_hash text, execution_user_op_hash text, execution_tx_hash text,
  settled_block bigint check (settled_block between 0 and 9007199254740991),
  created_at double precision not null, settled_at double precision, updated_at double precision not null,
  primary key (org_id,proposal_id)
);
create unique index if not exists board_proposals_by_id on app.board_proposals (proposal_id);
create index if not exists board_proposals_by_org_nonce on app.board_proposals (org_id,nonce,created_at);
create index if not exists board_proposals_by_org_status_nonce on app.board_proposals (org_id,status,nonce);
create unique index if not exists board_proposals_by_org_subject on app.board_proposals (org_id,opener,subject_kind,subject_id);
create unique index if not exists board_proposals_by_org_safe_tx on app.board_proposals (org_id,safe_tx_hash);
create index if not exists board_proposals_by_org_rejects on app.board_proposals (org_id,rejects);

create table if not exists app.officer_changes (
  org_id text not null references app.organizations, change_id text not null, member_id text not null,
  party_id text not null, principal_id text, member_safe text not null, email text, name text,
  change text not null check (change in ('grant','revoke')),
  permission text not null check (permission in ('manage-books','issue-invoices','manage-people')),
  hat_id text not null, proposal_id text not null, note text not null,
  state text not null check (state in ('proposed','applied','ended')), waiting boolean check (waiting is null or waiting),
  created_at double precision not null, settled_at double precision, updated_at double precision not null,
  primary key (org_id,change_id),
  foreign key (org_id,proposal_id) references app.board_proposals (org_id,proposal_id)
);
create unique index if not exists officer_changes_by_org_member_permission on app.officer_changes (org_id,member_id,permission,waiting);
create unique index if not exists officer_changes_by_org_proposal on app.officer_changes (org_id,proposal_id);
create index if not exists officer_changes_by_org_hat_waiting on app.officer_changes (org_id,hat_id,waiting);

create table if not exists app.proposal_approvals (
  org_id text not null references app.organizations, proposal_id text not null, approval_id text not null,
  director_principal_id text not null, director_safe text not null, step text not null check (step in ('approve','execute')),
  created_at double precision not null, primary key (org_id,proposal_id,approval_id),
  foreign key (org_id,proposal_id) references app.board_proposals (org_id,proposal_id)
);
create index if not exists proposal_approvals_by_org_proposal_director on app.proposal_approvals (org_id,proposal_id,director_principal_id,created_at);
