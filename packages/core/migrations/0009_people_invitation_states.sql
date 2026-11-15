-- The invitation's states, as its machine declares them (blueprint src/people/machines.ts, `Invitation.check("state")`;
-- docs/roadmap.md, step 3.4): the database refuses a state the machine does not have. 0006 was applied without a
-- constraint and is never edited; a change of the machine's states is a new migration. Every row written before this
-- is pending, accepted or declined, so the constraint holds on a database that already has rows. Dropped first, so
-- applying it twice changes nothing. Applied when a world is created.

alter table app.invitations drop constraint if exists invitations_state;
alter table app.invitations add constraint invitations_state check (state in ('pending', 'accepted', 'declined'));
