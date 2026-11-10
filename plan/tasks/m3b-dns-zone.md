## What
Create the Route 53 hosted zone for worlds.capxul.com as a CloudFormation stack (docs/mission/sites-host/dns-zone.yaml).
## Why
The worlds machine is reached at addresses under worlds.capxul.com; the zone has to exist in AWS before Aaron points Namecheap at it.
## Done when
- The stack capxul-worlds-dns exists in eu-west-1 and its four name servers are known.
