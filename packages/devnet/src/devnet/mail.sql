-- Fresh local/simulated world only; captured with the world's entire database.
BEGIN;
CREATE SCHEMA IF NOT EXISTS devnet;
CREATE TABLE devnet.mail_messages (
  mail_id text PRIMARY KEY,
  direction text NOT NULL CHECK (direction IN ('out','in')),
  "to" text NOT NULL,
  "from" text NOT NULL,
  reply_to text,
  message_id text NOT NULL,
  in_reply_to text,
  "references" text[] NOT NULL,
  subject text NOT NULL,
  template text NOT NULL,
  text text NOT NULL,
  links text[] NOT NULL,
  idempotency_key text NOT NULL,
  sent_at timestamptz NOT NULL
);
CREATE INDEX by_to_sent_at ON devnet.mail_messages ("to", sent_at);
CREATE INDEX by_sent_at ON devnet.mail_messages (sent_at);
CREATE UNIQUE INDEX by_idempotency_key ON devnet.mail_messages (idempotency_key);
CREATE TABLE devnet.mail_faults (
  address text PRIMARY KEY,
  remaining integer NOT NULL CHECK (remaining BETWEEN 1 AND 100),
  armed_at timestamptz NOT NULL
);
REVOKE ALL ON SCHEMA devnet FROM PUBLIC;
GRANT USAGE ON SCHEMA devnet TO capxul_core, capxul_worker;
REVOKE ALL ON devnet.mail_messages, devnet.mail_faults FROM PUBLIC, capxul_core, capxul_worker;
GRANT SELECT ON devnet.mail_messages, devnet.mail_faults TO capxul_core, capxul_worker;
GRANT INSERT ON devnet.mail_messages TO capxul_worker;
GRANT INSERT, UPDATE, DELETE ON devnet.mail_faults TO capxul_worker;
COMMIT;
