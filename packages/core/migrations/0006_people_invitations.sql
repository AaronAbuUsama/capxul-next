-- What Core keeps of the domain "people" (src/people): the invitations a company's Directors send, and the members who
-- joined by accepting one. A member's Seat is off the chain and off the site: no hat, no Safe owner, no site user
-- (blueprint people/order.md). A company's founding Directors and members stay in app.organizations (0004), and its
-- people are those, then these, in the order they joined. Applied when a world is created.

create table if not exists app.invitations (
  id text primary key,
  position bigint generated always as identity,
  org text not null references app.organizations (org),
  -- The address it was sent to, in lower case. Whoever of the cast signs in with it is its invitee. Never in an event.
  email text not null,
  role text not null,
  invited_by text not null,
  -- pending from the moment it is made, then accepted, declined or cancelled. Only a pending one changes.
  state text not null,
  invited_ms double precision not null,
  answered_ms double precision
);
-- One pending invitation per company and email: another waits until it is answered or cancelled.
create unique index if not exists invitations_pending on app.invitations (org, email) where state = 'pending';
create index if not exists invitations_to on app.invitations (email, invited_ms, position);

create table if not exists app.members (
  org text not null references app.organizations (org),
  person text not null,
  position bigint generated always as identity,
  role text not null,
  -- The invitation the person accepted to join.
  invitation text not null references app.invitations (id),
  joined_ms double precision not null,
  primary key (org, person)
);
