-- What Core keeps of the domain "board" (src/board): each change to a company's Board, proposed to its founder with
-- one approval (org.director.add, org.threshold.set) and landed by its signature (approval.sign). The Board itself is
-- app.organizations' directors and threshold (0004), which a change that lands updates. Applied when a world is
-- created.

create table if not exists app.board_changes (
  change text primary key,
  org text not null references app.organizations (org),
  -- add: seat `person` as a Director; threshold: set how many Directors must sign.
  action text not null,
  person text,
  -- The Board as the company Safe held it when the change was proposed, and as it is once it lands.
  before_directors integer not null,
  before_threshold integer not null,
  after_directors integer not null,
  after_threshold integer not null,
  -- When its approval expires, in world time: a proposed change waits until then, and blocks another until it does.
  expires_ms double precision not null,
  -- proposed until its UserOperation lands, then landed.
  state text not null
);
create index if not exists board_changes_waiting on app.board_changes (org, expires_ms) where state = 'proposed';
