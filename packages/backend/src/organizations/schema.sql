-- The security-definer functions in this file run as their owner and read RLS-forced tables (principals, org_members,
-- parties, organizations) whose policies name only the runtime roles: an owner without BYPASSRLS would make
-- them admit nothing, silently. Refuse such an owner here instead.
do $$ begin
  if not exists (select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then
    raise exception 'PROVISIONING_ROLE: Organizations must be migrated by a superuser or BYPASSRLS role';
  end if;
end $$;

-- The Organizations concept's tables (blueprint/organizations/data.ts). Explicit privileged migration after
-- Access, Accounts, Parties and the canonical outbox. Tenant roles read their Organization only as a current
-- member (the founder also reads an unfinished setup); every write is the worker's; nothing deletes.

-- The legacy shared app.organizations (site, token, delivery cursors) must be cut over before this runs.
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='app' and table_name='organizations' and column_name='site') then
    raise exception 'LEGACY_ORGANIZATIONS: cut app.organizations over to the blueprint shape before migrating Organizations';
  end if;
end $$;
create table if not exists app.organizations (
  org_id text primary key, party_id text not null references app.parties, name text not null,
  country text not null check (country ~ '^[A-Z]{2}$'),
  bio text check (char_length(bio) between 1 and 280), size text check (size <> ''), logo_file_id text,
  chain_id bigint not null check (chain_id > 0),
  safe_address text not null check (safe_address ~ '^0x[0-9a-f]{40}$'),
  founder_party_id text not null references app.parties,
  founder_safe text not null check (founder_safe ~ '^0x[0-9a-f]{40}$'),
  seat_limit integer not null check (seat_limit >= 0), seat_limit_raised_by text, seat_limit_raised_at bigint,
  abbr text not null check (abbr ~ '^[A-Z0-9]{1,5}$'), default_currency text not null check (default_currency ~ '^[A-Z]{3}$'),
  time_zone text not null, fiscal_year_start text not null check (fiscal_year_start ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  created_at bigint not null, updated_at bigint not null,
  check ((seat_limit_raised_by is null) = (seat_limit_raised_at is null))
);
create unique index if not exists organizations_by_party on app.organizations(party_id);

create table if not exists app.org_setups (
  org_id text primary key references app.organizations, founder_principal_id text not null,
  intent_hash text not null check (intent_hash ~ '^[0-9a-f]{64}$'), with_fde boolean not null,
  status text not null check (status in ('processing','awaiting_authorization','needs_attention','ready','failed')),
  steps text[] not null check (steps <@ array['safe_minted','money_deployed','installed']),
  mint_tx_hash text, deploy_tx_hash text, install_approval_id text, issue jsonb,
  fde_signer text, fde_safe text, fde_party_id text references app.parties,
  checked_at bigint not null, ready_at bigint, created_at bigint not null, updated_at bigint not null,
  check ((status = 'ready') = (ready_at is not null))
);
create index if not exists org_setups_by_founder_status on app.org_setups(founder_principal_id,status);

create table if not exists app.org_deployments (
  org_id text primary key references app.organizations, safe_address text not null,
  board_top_hat text not null, shareholders_top_hat text not null, director_hat text not null,
  books_hat text not null, invoicing_hat text not null, people_hat text not null,
  roles_address text not null, gate_address text not null, deploy_tx_hash text not null,
  block_number bigint not null, created_at bigint not null
);

create table if not exists app.org_seat_purchases (
  org_id text not null references app.organizations, payment_id text not null, command_id text not null,
  seats integer not null check (seats between 1 and 1000), status text not null check (status in ('counted','returned')),
  chain_id bigint not null, token_address text not null, asset text not null, amount_raw text not null check (amount_raw ~ '^[0-9]+$'),
  bought_by_party_id text not null, limit_after integer not null, tx_hash text not null, block_number bigint not null,
  counted_at bigint not null, returned_at bigint, created_at bigint not null, updated_at bigint not null,
  primary key (org_id, payment_id), check ((status = 'returned') = (returned_at is not null))
);
create index if not exists org_seat_purchases_by_org_counted on app.org_seat_purchases(org_id,counted_at,payment_id);

create table if not exists app.org_apps (
  org_id text not null references app.organizations, app text not null, modules text[] not null, native boolean not null,
  status text not null check (status in ('wanted','installed','removed')), added_by text, version text,
  installed_at bigint, created_at bigint not null, updated_at bigint not null,
  primary key (org_id, app), check (not native or status = 'installed')
);
create index if not exists org_apps_by_org_status on app.org_apps(org_id,status,app);

create table if not exists app.org_fdes (
  org_id text primary key references app.organizations, host_agent_id text not null, party_id text not null references app.parties,
  safe_address text not null, signer_address text not null,
  status text not null check (status in ('provisioned','running','due','paused','resuming','retired')),
  started_at bigint, paid_through bigint, paused_at bigint, resumed_at bigint, retired_at bigint,
  retire_reason text check (retire_reason in ('setup_failed','agent_removed','key_moved')),
  last_asked_at bigint, last_asked_by text, created_at bigint not null, updated_at bigint not null
);
create unique index if not exists org_fdes_by_safe on app.org_fdes(safe_address);

-- Seats.
create table if not exists app.org_members (
  org_id text not null references app.organizations, member_id text not null,
  party_id text not null references app.parties, principal_id text,
  kind text not null check (kind in ('human','agent')), safe_address text not null,
  invitation_id text, seat_use text not null check (seat_use in ('seat','owner-seat','organization')),
  covering_member_id text, status text not null check (status in ('active','removed')),
  removed_reason text check (removed_reason='agent_removed'), joined_at bigint not null,
  removed_at bigint, updated_at bigint not null, primary key(org_id,member_id)
);
create index if not exists org_members_by_org_principal on app.org_members(org_id,principal_id);
create index if not exists org_members_by_org_safe on app.org_members(org_id,safe_address);
create unique index if not exists org_members_by_org_party on app.org_members(org_id,party_id);
create index if not exists org_members_by_org_joined on app.org_members(org_id,joined_at,member_id);
create index if not exists org_members_by_org_seat_use on app.org_members(org_id,status,seat_use);
create index if not exists org_members_by_org_covering on app.org_members(org_id,covering_member_id);
create index if not exists org_members_by_principal on app.org_members(principal_id,org_id);
create index if not exists org_members_by_safe on app.org_members(safe_address);

-- Owned by the privileged provisioning role, with no dynamic SQL or caller-supplied identity.
-- This avoids policy recursion; neither an owner label nor an org selector proves an actor.
create or replace function app.current_member(p_org text) returns boolean
language sql stable security definer set search_path=pg_catalog,app as $$
  -- The one Seat admission rule (requireSeat and RLS use it; caller_safes builds on it): an active Seat of a live
  -- Party, in an Organization whose own Party is live. A released Party or Organization admits nothing.
  select exists(select 1 from app.org_members m join app.principals p
    on p.person_id=nullif(current_setting('app.person_id',true),'')
    join app.parties mp on mp.party_id=m.party_id and mp.state<>'released'
    join app.organizations o on o.org_id=m.org_id
    join app.parties op on op.party_id=o.party_id and op.kind='organization' and op.owner_kind='organization'
      and op.owner_id=o.org_id and op.safe_address=o.safe_address and op.state<>'released'
    where m.org_id=p_org and m.status='active'
    and ((m.kind='human' and p.kind='person' and m.principal_id=p.person_id)
      or (m.kind='agent' and p.kind='agent' and m.safe_address=p.safe_address)))
$$;
revoke all on function app.current_member(text) from public;
grant execute on function app.current_member(text) to capxul_core,capxul_worker;

create or replace function app.caller_safes() returns text[]
language sql stable security definer set search_path=pg_catalog,app as $$
  with own as (
    select d.safe_address from app.principals p join app.parties d on d.safe_address=p.safe_address
    where p.person_id=nullif(current_setting('app.person_id',true),'') and d.state<>'released'
  ), admitted as (
    select safe_address from own
    union
    select d.safe_address from app.organizations o join app.parties d on d.party_id=o.party_id and d.safe_address=o.safe_address
    where d.kind='organization' and d.owner_kind='organization' and d.owner_id=o.org_id
      and d.state<>'released' and exists(select 1 from own)
      and app.current_member(o.org_id)
  ) select coalesce(array_agg(safe_address order by safe_address),array[]::text[]) from admitted
$$;
revoke all on function app.caller_safes() from public;
grant execute on function app.caller_safes() to capxul_core,capxul_worker;

alter table app.org_members enable row level security;
alter table app.org_members force row level security;
drop policy if exists tenant on app.org_members;
create policy tenant on app.org_members to capxul_core,capxul_worker
  using (current_user='capxul_worker' or app.current_member(org_id))
  with check (current_user='capxul_worker');
revoke all on app.org_members from public,capxul_core,capxul_worker;
grant select on app.org_members to capxul_core,capxul_worker;
grant insert,update on app.org_members to capxul_worker;

-- The other Organization tables: a current member reads; the founder reads their own setup; only the worker writes.
do $$ declare t text; begin
  foreach t in array array['organizations','org_setups','org_deployments','org_seat_purchases','org_apps','org_fdes'] loop
    execute format('alter table app.%I enable row level security; alter table app.%I force row level security', t, t);
    execute format('drop policy if exists tenant on app.%I', t);
    execute format('revoke all on app.%I from public, capxul_core, capxul_worker', t);
    execute format('grant select on app.%I to capxul_core, capxul_worker; grant insert, update on app.%I to capxul_worker', t, t);
  end loop;
end $$;
create policy tenant on app.organizations to capxul_core, capxul_worker
  using (current_user='capxul_worker' or app.current_member(org_id)) with check (current_user='capxul_worker');
create policy tenant on app.org_setups to capxul_core, capxul_worker
  using (current_user='capxul_worker' or app.current_member(org_id)
    or founder_principal_id=nullif(current_setting('app.person_id',true),'')) with check (current_user='capxul_worker');
create policy tenant on app.org_deployments to capxul_core, capxul_worker
  using (current_user='capxul_worker' or app.current_member(org_id)) with check (current_user='capxul_worker');
create policy tenant on app.org_seat_purchases to capxul_core, capxul_worker
  using (current_user='capxul_worker' or app.current_member(org_id)) with check (current_user='capxul_worker');
create policy tenant on app.org_apps to capxul_core, capxul_worker
  using (current_user='capxul_worker' or app.current_member(org_id)) with check (current_user='capxul_worker');
create policy tenant on app.org_fdes to capxul_core, capxul_worker
  using (current_user='capxul_worker' or app.current_member(org_id)) with check (current_user='capxul_worker');
