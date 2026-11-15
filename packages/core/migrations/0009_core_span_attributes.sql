-- The declared attributes of a kept span (src/telemetry/attributes.ts): on a call's own span, the Cloudflare data
-- centre that ran Core's Worker (`cf.colo`) and its Postgres round trips (`db.query_ms`, `db.query_count`). Null on
-- every other span, and on spans kept before it. Applied when a world is created.
alter table app.spans add column if not exists attributes jsonb;
