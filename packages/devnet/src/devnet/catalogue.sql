-- Fresh-world migration only. Core owns the app schema and runtime roles.
BEGIN;
CREATE TABLE app.worlds (
  world_id text PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('local','simulated','staging','production')),
  profile text NOT NULL CHECK (profile IN ('core','full')),
  address text,
  template text,
  chain_id bigint NOT NULL CHECK (chain_id > 0),
  chain_instance text NOT NULL,
  clock_mode text NOT NULL CHECK (clock_mode IN ('frozen','running')),
  rate integer NOT NULL CHECK (rate BETWEEN 1 AND 60),
  world_now bigint NOT NULL,
  epoch integer NOT NULL CHECK (epoch > 0),
  parent_world text,
  parent_snapshot text,
  parent_seq bigint,
  hosted boolean NOT NULL,
  state text NOT NULL CHECK (state IN ('creating','running','stopped','restoring','parked','closed')),
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  CHECK (world_id ~ '^[a-z][a-z0-9]{0,11}$'),
  CHECK (parent_seq IS NULL OR parent_seq >= 0)
);
CREATE UNIQUE INDEX "worlds-by-name" ON app.worlds (name);

CREATE TABLE app.world_snapshots (
  world_id text NOT NULL REFERENCES app.worlds(world_id),
  name text NOT NULL,
  epoch integer NOT NULL CHECK (epoch > 0),
  record_seq bigint NOT NULL CHECK (record_seq >= 0),
  chain_state_ref text NOT NULL,
  site_backups jsonb NOT NULL CHECK (jsonb_typeof(site_backups) = 'array'),
  clock_mode text NOT NULL CHECK (clock_mode IN ('frozen','running')),
  rate integer NOT NULL CHECK (rate BETWEEN 1 AND 60),
  world_now bigint NOT NULL,
  code_version text NOT NULL,
  template boolean NOT NULL,
  created_at bigint NOT NULL,
  PRIMARY KEY (world_id, name)
);
CREATE INDEX "world-snapshots-by-created" ON app.world_snapshots (world_id, created_at);

CREATE TABLE app.command_records (
  world_id text NOT NULL REFERENCES app.worlds(world_id),
  epoch integer NOT NULL CHECK (epoch > 0),
  seq bigint NOT NULL CHECK (seq > 0),
  prev text NOT NULL CHECK (prev ~ '^[0-9a-f]{64}$'),
  v integer NOT NULL CHECK (v = 1),
  id text NOT NULL,
  trace_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('command','tool-call','reply','born','restore','clock','event','join','handover','score')),
  command text,
  args text NOT NULL,
  actor_email text,
  actor_address text,
  actor_hats text[] NOT NULL,
  who_kind text NOT NULL CHECK (who_kind IN ('person','agent','system')),
  org_id text,
  site text,
  world_time text NOT NULL,
  world_time_end text NOT NULL,
  real_time text NOT NULL,
  duration_ms double precision NOT NULL CHECK (duration_ms >= 0),
  outcome text NOT NULL CHECK (outcome IN ('ok','refused','failed')),
  error_code text,
  error_reason text,
  error_detail text,
  result text,
  changes text,
  run_id text,
  model text,
  policy_version text,
  surface text CHECK (surface IN ('cli','sdk','mcp','http','workflow')),
  cause_seq bigint,
  branch_abandoned boolean NOT NULL,
  PRIMARY KEY (world_id, epoch, seq)
);
CREATE INDEX "command-records-by-who" ON app.command_records (world_id, actor_email, world_time);
CREATE INDEX "command-records-by-trace" ON app.command_records (world_id, trace_id);

REVOKE ALL ON app.worlds, app.world_snapshots, app.command_records FROM PUBLIC, capxul_core, capxul_worker;
GRANT SELECT ON app.worlds, app.world_snapshots, app.command_records TO capxul_core, capxul_worker;
GRANT INSERT, UPDATE ON app.worlds, app.world_snapshots TO capxul_worker;
GRANT INSERT ON app.command_records TO capxul_worker;
GRANT UPDATE (branch_abandoned) ON app.command_records TO capxul_worker;
COMMIT;
