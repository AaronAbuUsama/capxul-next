-- Seat source only. Access and Parties migrations must precede this explicit privileged migration.
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
  -- Party, in a live Organization that has its own live Party. A released Party or Organization admits nothing.
  select exists(select 1 from app.org_members m join app.principals p
    on p.person_id=nullif(current_setting('app.person_id',true),'')
    join app.parties mp on mp.party_id=m.party_id and mp.state<>'released'
    join app.organizations o on o.org_id=m.org_id and not o.released
    join app.parties op on op.kind='organization' and op.owner_kind='organization' and op.owner_id=o.org_id
      and op.safe_address=o.safe and op.state<>'released'
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
    select d.safe_address from app.organizations o join app.parties d on d.safe_address=o.safe
    where d.kind='organization' and d.owner_kind='organization' and d.owner_id=o.org_id
      and d.state<>'released' and not o.released and exists(select 1 from own)
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
