## What
Create the dedicated machine for worlds on the existing AWS cloud, add the catch-all route for the worlds subdomain, and switch on its backups.
## Why
Worlds should not run on a laptop, and the goal's thin line has to run there.
## Done when
- The machine exists, the subdomain reaches it over HTTPS, and a restore check passes.
## Needs from Aaron
1. Run `aws login` on this Mac.
2. Choose the subdomain. The suggestion is `worlds.capxul.com`, with addresses like `acme-town.worlds.capxul.com`.
3. Add four DNS records at Namecheap, which the coordinator will supply.
## Cost
About $84 a month, the same as the tools machine.
## Links
- `docs/mission/sites-host/`
