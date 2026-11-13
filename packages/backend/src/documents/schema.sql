do $$ begin
  if not exists (select 1 from pg_roles where rolname='capxul_documents_writer') then
    create role capxul_documents_writer nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
end $$;
grant usage on schema app to capxul_documents_writer;
create table if not exists app.documents (
  owner_id text not null, owner_kind text not null check(owner_kind in ('person','organization')),
  document_id text not null, document_hash text not null check(document_hash ~ '^0x[0-9a-f]{64}$'),
  content_hash text not null check(content_hash ~ '^0x[0-9a-f]{64}$'),
  kind text not null check(kind in ('memo','invoice','terms','payslip','receipt')),
  format text not null check(format in ('envelope','artifact')),
  media_type text not null check(media_type in ('application/json','application/pdf','image/png','image/jpeg')),
  bytes bytea not null, issued_at double precision, filename text,
  chain_id integer not null check(chain_id>0),
  subject_kind text not null check(subject_kind in ('payment','movement','request','agreement','salary-slip','expense-claim','employee-advance','grant','round','commitment','share-transfer')),
  subject_id text not null, participants jsonb not null check(jsonb_typeof(participants)='array' and jsonb_array_length(participants) between 1 and 8),
  participant_safes text[] not null check(cardinality(participant_safes) between 1 and 8), created_at double precision not null,
  primary key(owner_id,owner_kind,document_id),
  check((format='artifact' and kind='receipt' and issued_at is null and document_hash=content_hash and octet_length(bytes) between 1 and 131072)
    or (format='envelope' and kind<>'receipt' and media_type='application/json' and issued_at is not null and filename is null))
);
create unique index if not exists documents_by_pair on app.documents(document_hash,content_hash);
create unique index if not exists documents_by_document on app.documents(document_id);
create index if not exists documents_by_subject on app.documents(subject_kind,subject_id);
alter table app.documents enable row level security;
alter table app.documents force row level security;
drop policy if exists documents_read on app.documents;
create policy documents_read on app.documents for select to capxul_core using (
  -- The authenticated principal (Access) or a current Seat (Organizations), never owner labels alone.
  (owner_kind='person' and owner_id=nullif(current_setting('app.person_id',true),''))
  or (owner_kind='organization' and app.current_member(owner_id))
  or participant_safes && app.caller_safes()
);
drop policy if exists documents_service_read on app.documents;
create policy documents_service_read on app.documents for select to capxul_worker using (true);
drop policy if exists documents_writer on app.documents;
create policy documents_writer on app.documents to capxul_documents_writer using(true) with check(true);
revoke all on app.documents from public,capxul_core,capxul_worker;
grant select on app.documents to capxul_core,capxul_worker;
grant select,insert on app.documents to capxul_documents_writer;

create or replace function app.documents_store(input jsonb,raw bytea) returns jsonb
language plpgsql security definer set search_path=pg_catalog,app as $$
declare d app.documents; old app.documents;
begin
  d := jsonb_populate_record(null::app.documents,input);
  d.bytes := raw;
  if d.owner_kind is distinct from current_setting('app.owner_kind',true)
    or d.owner_id is distinct from nullif(current_setting('app.owner_id',true),'') then
    raise exception 'FORBIDDEN: document owner';
  end if;
  if d.kind='payslip' or d.subject_kind='salary-slip' then raise exception 'INVALID_INPUT: salary documents belong to Frappe HR'; end if;
  if d.participant_safes is distinct from array(select p->>'safe' from jsonb_array_elements(d.participants) p) then
    raise exception 'INVALID_INPUT: document participants';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(d.document_hash || d.content_hash,0));
  select * into old from app.documents where document_hash=d.document_hash and content_hash=d.content_hash;
  if found then
    if old.owner_id<>d.owner_id or old.owner_kind<>d.owner_kind or old.subject_kind<>d.subject_kind
      or old.subject_id<>d.subject_id or old.participants<>d.participants or old.chain_id<>d.chain_id or old.bytes<>d.bytes then
      raise exception 'INVALID_INPUT: document pair conflict';
    end if;
    return jsonb_build_object('document_id',old.document_id,'document_hash',old.document_hash,'content_hash',old.content_hash,'replayed',true);
  end if;
  insert into app.documents select d.*;
  return jsonb_build_object('document_id',d.document_id,'document_hash',d.document_hash,'content_hash',d.content_hash,'replayed',false);
end $$;
alter function app.documents_store(jsonb,bytea) owner to capxul_documents_writer;
revoke all on function app.documents_store(jsonb,bytea) from public;
grant execute on function app.documents_store(jsonb,bytea) to capxul_core,capxul_worker;
