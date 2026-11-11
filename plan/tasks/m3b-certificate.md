## What
Once the four NS records for the host worlds exist at Namecheap, issue one certificate for worlds.capxul.com and every name under it, using the commands in docs/mission/sites-host/STATE.md, and put it on the machine. Renewal in under 90 days needs AWS access again, or an automation Aaron approves.
## Why
A world's sites need HTTPS. The certificate can only be issued once the worlds subdomain is handed to AWS's DNS, and issuing it needs the AWS sign-in.
## Done when
- The certificate is on the machine and its expiry date is recorded
