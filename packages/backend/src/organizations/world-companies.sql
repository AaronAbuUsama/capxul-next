-- Core-only worlds have real companies without Frappe sites. Preserve the unique site constraint,
-- all existing values, grants and RLS; explicit provisioning owns this adapter migration.
alter table app.organizations alter column site drop not null;
