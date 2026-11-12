-- Explicit privileged migration after Access and Parties; never tenant-request or restore provisioning.
create table if not exists app.profiles (
  person_id text primary key references app.principals,
  party_id text not null unique references app.parties,
  country text not null check (country ~ '^[A-Z]{2}$'),
  created_at bigint not null, updated_at bigint not null
);
alter table app.profiles enable row level security;
alter table app.profiles force row level security;
drop policy if exists profile_read on app.profiles;
create policy profile_read on app.profiles for select to capxul_core
  using (person_id=nullif(current_setting('app.person_id',true),''));
drop policy if exists profile_worker on app.profiles;
create policy profile_worker on app.profiles to capxul_worker using (true) with check (true);
revoke all on app.profiles from public,capxul_core,capxul_worker;
grant select on app.profiles to capxul_core,capxul_worker;
grant insert,update on app.profiles to capxul_worker;
