-- The signatures operations ask for (decisions.md, 23) and what they authorise, in the world's `app` schema. Each
-- subject is sent once, when enough of its approvals are signed: as a prepared UserOperation of the signer's own Safe,
-- or as a company Safe's transaction its Directors' Safes sign, carried by the relayer. Applied when a world is created.

create table if not exists app.subjects (
  kind text not null,
  id text not null,
  org text,
  -- How many approvals must be signed, and whose signature must be among them (the sender's owner), if anyone's.
  threshold integer not null,
  needs text,
  -- How the subject reaches the chain: {"via": "operation", ...} or {"via": "company", ...}.
  landing jsonb not null,
  -- What sending it spends, checked before it is sent: {"safe", "amount"} in the test USDC's smallest unit, or null.
  spends jsonb,
  -- What its landing must tell the company's site: for a payment, its document's hash, its amount and its payee.
  about jsonb,
  -- open until it is sent, then sent with its transaction and block.
  state text not null,
  tx text,
  block bigint,
  primary key (kind, id)
);

create table if not exists app.approvals (
  approval text primary key,
  subject_kind text not null,
  subject_id text not null,
  position integer not null,
  signer text not null,
  signer_address text not null,
  -- For a Director's approval of a company transaction: the Director's Safe, whose signature it becomes.
  signer_safe text,
  digest text not null,
  expires_at text not null,
  signature text,
  foreign key (subject_kind, subject_id) references app.subjects (kind, id)
);
create index if not exists approvals_subject on app.approvals (subject_kind, subject_id, position);
