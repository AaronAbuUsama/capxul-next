do $$ begin
  if not exists (select 1 from pg_roles where rolname='capxul_media_writer') then
    create role capxul_media_writer nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
end $$;
grant usage on schema app to capxul_media_writer;

create table if not exists app.files (
  person_id text not null, file_id text not null,
  purpose text not null check (purpose in ('image','id-image','document')),
  state text not null check (state in ('kept','held','expired')),
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  size double precision not null check (size >= 1 and size = trunc(size)), bytes bytea,
  created_at double precision not null, expires_at double precision,
  primary key (person_id,file_id),
  check ((purpose='image' and state='kept' and expires_at is null and bytes is not null and size<=5242880)
    or (purpose in ('id-image','document') and state in ('held','expired') and expires_at=created_at+1800000
      and ((state='held' and bytes is not null) or (state='expired' and bytes is null)))),
  check (bytes is null or octet_length(bytes)=size),
  check ((purpose='id-image' and size<=15000000) or (purpose='document' and size<=24000000) or purpose='image')
);
create unique index if not exists files_by_id on app.files(file_id);
alter table app.files enable row level security;
alter table app.files force row level security;
drop policy if exists media_read on app.files;
create policy media_read on app.files for select to capxul_core using (
  (current_setting('app.owner_kind',true)='person' and person_id=current_setting('app.owner_id',true))
  or (purpose='image' and state='kept')
);
drop policy if exists media_writer on app.files;
create policy media_writer on app.files to capxul_media_writer using (true) with check (true);
revoke all on app.files from public,capxul_core,capxul_worker;
grant select on app.files to capxul_core;
grant select,insert,update on app.files to capxul_media_writer;

create or replace function app.media_upload(id text,purpose text,content_type text,bytes bytea,now_ms double precision)
returns setof app.files language plpgsql security definer set search_path=pg_catalog,app as $$
declare person text := nullif(current_setting('app.owner_id',true),'');
  row app.files; width bigint; height bigint; pos integer; marker integer; len integer;
begin
  if current_setting('app.owner_kind',true) is distinct from 'person' or person is null
    or person is distinct from nullif(current_setting('app.person_id',true),'') then
    raise exception 'NOT_AUTHENTICATED: uploader required';
  end if;
  if purpose not in ('image','id-image','document') or content_type not in ('image/jpeg','image/png','image/webp','application/pdf')
    or (purpose='image' and content_type='application/pdf') or (purpose='id-image' and content_type not in ('image/jpeg','image/png'))
    or (purpose='document' and content_type='image/webp') then raise exception 'INVALID_INPUT: file type'; end if;
  if not (case content_type
    when 'image/png' then substring(bytes from 1 for 8)=decode('89504e470d0a1a0a','hex')
    when 'image/jpeg' then substring(bytes from 1 for 2)=decode('ffd8','hex')
    when 'image/webp' then substring(bytes from 1 for 4)=convert_to('RIFF','UTF8') and substring(bytes from 9 for 4)=convert_to('WEBP','UTF8')
    when 'application/pdf' then substring(bytes from 1 for 7) in (convert_to('%PDF-1.','UTF8'),convert_to('%PDF-2.','UTF8')) else false end)
    then raise exception 'INVALID_INPUT: file bytes'; end if;
  if content_type='image/png' and octet_length(bytes)>=24 and substring(bytes from 13 for 4)=convert_to('IHDR','UTF8') then
    width:=get_byte(bytes,16)::bigint*16777216+get_byte(bytes,17)*65536+get_byte(bytes,18)*256+get_byte(bytes,19);
    height:=get_byte(bytes,20)::bigint*16777216+get_byte(bytes,21)*65536+get_byte(bytes,22)*256+get_byte(bytes,23);
  elsif content_type='image/jpeg' then
    pos:=2;
    while pos+3<octet_length(bytes) loop
      if get_byte(bytes,pos)<>255 then exit; end if;
      pos:=pos+1;
      while pos<octet_length(bytes) and get_byte(bytes,pos)=255 loop pos:=pos+1; end loop;
      if pos>=octet_length(bytes) then exit; end if;
      marker:=get_byte(bytes,pos); pos:=pos+1;
      if marker in (217,218) then exit; end if;
      if marker=1 or marker between 208 and 215 then continue; end if;
      if pos+2>octet_length(bytes) then exit; end if;
      len:=get_byte(bytes,pos)*256+get_byte(bytes,pos+1);
      if len<2 or pos+len>octet_length(bytes) then exit; end if;
      if marker in (192,193,194,195,197,198,199,201,202,203,205,206,207) and len>=8 then
        height:=get_byte(bytes,pos+3)*256+get_byte(bytes,pos+4);
        width:=get_byte(bytes,pos+5)*256+get_byte(bytes,pos+6); exit;
      end if;
      pos:=pos+len;
    end loop;
  end if;
  if content_type in ('image/png','image/jpeg') and (width is null or height is null or width<1 or height<1) then
    raise exception 'INVALID_INPUT: image dimensions'; end if;
  if purpose='id-image' and (width<200 or height<200) then raise exception 'INVALID_INPUT: file pixels'; end if;
  insert into app.files values (person,id,purpose,case when purpose='image' then 'kept' else 'held' end,
    content_type,octet_length(bytes),bytes,now_ms,case when purpose='image' then null else now_ms+1800000 end) returning * into row;
  return next row;
end $$;
alter function app.media_upload(text,text,text,bytea,double precision) owner to capxul_media_writer;
revoke all on function app.media_upload(text,text,text,bytea,double precision) from public,capxul_worker;
grant execute on function app.media_upload(text,text,text,bytea,double precision) to capxul_core;

-- Profile mutations run on worker Sql. Expose only the verified uploader's kept-image metadata,
-- never generic worker SELECT, private files or file bytes.
create or replace function app.media_require_image(id text)
returns table(file_id text,content_type text,size double precision)
language sql security definer set search_path=pg_catalog,app as $$
  select f.file_id,f.content_type,f.size from app.files f where f.file_id=id
    and f.person_id=nullif(current_setting('app.person_id',true),'') and f.purpose='image' and f.state='kept'
$$;
alter function app.media_require_image(text) owner to capxul_media_writer;
revoke all on function app.media_require_image(text) from public;
grant execute on function app.media_require_image(text) to capxul_core,capxul_worker;

create or replace function app.media_expire(now_ms double precision) returns setof jsonb
language plpgsql security definer set search_path=pg_catalog,app as $$
declare row app.files; event jsonb;
begin
  for row in update app.files set state='expired',bytes=null
    where state='held' and expires_at<=now_ms returning * loop
    event := jsonb_build_object('from','held','to','expired','transition','expire','file_id',row.file_id,'person_id',row.person_id,'purpose',row.purpose);
    return next event;
  end loop;
end $$;
alter function app.media_expire(double precision) owner to capxul_media_writer;
revoke all on function app.media_expire(double precision) from public,capxul_core;
grant execute on function app.media_expire(double precision) to capxul_worker;
