-- How often a company's site was made again because the site door restarted while making it (src/organizations/
-- site.ts, `afterFailure`): once at most, so a door that keeps restarting ends the site stopped. Applied when a world is
-- created; applying it twice changes nothing.

alter table app.organizations add column if not exists site_restarts integer not null default 0;
