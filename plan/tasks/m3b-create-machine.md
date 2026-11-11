## What
Create the dedicated machine for worlds on the existing AWS cloud, add the catch-all route for the worlds subdomain, and switch on its backups. The machine itself is created after the hosted bench image has been built and tested locally (`m3b-bench-image`).
## Why
Worlds should not run on a laptop, and the goal's thin line has to run there.
## Done when
- The machine exists, the subdomain reaches it over HTTPS, and a restore check passes.
## Done so far
- The AWS sign-in is done and confirmed active.
- The subdomain is chosen: `worlds.capxul.com`, with addresses like `acme-town.worlds.capxul.com`.
- The DNS zone exists in AWS: CloudFormation stack `capxul-worlds-dns`, eu-west-1 (template `docs/mission/sites-host/dns-zone.yaml`; task `m3b-dns-zone`).
## Needs from Aaron
Add four NS records at Namecheap so that the zone answers for `worlds.capxul.com`:
1. Namecheap, Domain List, `capxul.com`, Advanced DNS, Add New Record.
2. Type NS Record, host `worlds`, one record per name server, four in all:
   - `ns-1035.awsdns-01.org`
   - `ns-1870.awsdns-41.co.uk`
   - `ns-221.awsdns-27.com`
   - `ns-659.awsdns-18.net`
## Cost
About $84 a month, the same as the tools machine.
## Links
- `docs/mission/sites-host/`
