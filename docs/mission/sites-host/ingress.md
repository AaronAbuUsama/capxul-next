# Ingress: one catch-all route for company sites

Draft, 10 November 2026. Nothing was run. Facts from `Xelmar-tech/hosting` at `origin/main` carry their path.
Figures marked "estimate" are not from the repository.

## What exists

- Namecheap's `*` A record points to the controller `99.81.80.126` (`deploy/ingress/capxul-namecheap-cutover.md`).
  The default is therefore already "everything goes to the controller". Namecheap has no API and DNS stays there
  (`deploy/ingress/README.md`: "do not change nameservers").
- The controller runs Traefik as `capxul-ingress` (`deploy/openship/controller-ingress.compose.yaml`), image pinned by digest.
  Its only certificate resolver is `letsencrypt` with `tlschallenge=true`, storage `/traefik/acme.json`.
  That resolver cannot issue a wildcard. Wildcards need a DNS challenge.
- Routes are files in `/etc/capxul/ingress/dynamic/`, watched by the file provider. Each script renders its own file
  (`tools_ingress.py` -> `tools-front.yaml`; `mattermost_ingress.py` -> `mattermost.yaml`). They are written directly,
  not through the OpenShip API. A route file for a new machine does not need OpenShip.
- Every route is one exact `Host(...)`, re-encrypts to the worker with `serverName` set and `insecureSkipVerify: false`,
  and delegates `/.well-known/acme-challenge/` to the worker over HTTP (`ingress.py`, `tools_ingress.py`).
- The rule `HostRegexp(`^(pr|marketing-pr)-[0-9]+\.preview\.capxul\.com$`)` in `ingress.py` is Traefik v3 syntax,
  so v3 regular-expression rules are available.

## Naming: company and world in the hostname

A world is one chain, clock and set of companies; several run side by side. The hostname carries both.

| | A. `<company>-<world>.<base>` | B. `<company>.<world>.<base>` |
|---|---|---|
| Example | `acme-w7.worlds.capxul.com` | `acme.w7.worlds.capxul.com` |
| Certificate | one `*.worlds.capxul.com`, for ever | one wildcard per world; a wildcard covers one label |
| New world | a command; no DNS, route or certificate change | DNS record, route change and a DNS-challenge issuance per world |
| Let's Encrypt limits | one certificate | one per world, counted against `capxul.com` with every other name (limit values: estimate, check) |
| Route per world on the machine | match the suffix `-w7.<base>` | match `.w7.<base>` |
| Cost | the world id must be unambiguous in the name | none |

**Recommend A.** B breaks the requirement that creating anything needs no proxy change: each world would edit the
Traefik rule, add a certificate request and wait for DNS. A needs one record, one rule and one certificate once.

Rules that keep A unambiguous (enforced in the Capxul service, tested in `sites_ingress.py --check`):

- A world id is `w` plus digits (`w7`). It never contains a hyphen.
- A company slug is `[a-z0-9-]`, may contain hyphens, and the full label is at most 63 characters.
- The world is the text after the LAST hyphen. The service keeps the registry (`world.json`); it never parses names to find authority.
- Reserved company slugs for service names: `core`, `chain`, `record`, `admin`, `www`.

## Options for the wildcard certificate

| Option | What it needs | Verdict |
|---|---|---|
| 1. Delegate the subdomain to Route 53; Traefik on the controller uses the DNS challenge | Four NS records at Namecheap (Aaron). A Route 53 zone (`template.yaml`). A second resolver on the controller. Route 53 permission on the controller. One restart of `capxul-ingress`. | **Recommended** |
| 1b. Keep the subdomain at Namecheap; add one `_acme-challenge.<sub>` CNAME into a zone already on Route 53 | One CNAME at Namecheap. A Route 53 zone on a domain we control. Traefik follows the CNAME. Same controller changes as 1. | Fallback if Namecheap will not take NS records |
| 2. One certificate per site, issued on demand | A route and a certificate per hostname. Let's Encrypt allows a limited number of new certificates per week for `capxul.com` (limit: estimate, check). | No. Needs a proxy change per site, and worlds create sites in bulk |
| 3. Terminate TLS on the sites machine | Lightsail has no instance role, so a Route 53 key must sit on the machine; or HTTP-01 per site (option 2 limits). The controller must pass TLS through by SNI. | No. Puts a long-lived key on the machine that holds all company data |

Recommended flow under option 1:

```text
browser -> acme-w7.worlds.capxul.com  (A record * -> controller, in the Route 53 zone)
controller Traefik: public wildcard certificate (DNS challenge), HostRegexp router, priority 4000
   -> https://<sites machine>:443, serverName sites-origin.capxul.internal, verified against a pinned private CA
sites machine: Caddy (origin certificate) -> frappe_docker nginx -> the site named by the Host header
```

The origin certificate is private, issued once on the machine by a small CA whose public part is copied to the
controller (`/etc/capxul/ingress/certs/sites-origin-ca.pem`). This keeps the precedent's strict verification without
putting the public wildcard on the machine. Rotation: CA 10 years, origin certificate 825 days (estimate of a sensible
period); put the renewal date on the scoreboard.

## Controller changes (a change to the hosting repository, made by the coordinator, not by this task)

1. **Resolver.** Add to `controller-ingress.compose.yaml` `command:` (resolver name `letsencrypt-dns`, separate storage file):

   ```text
   --certificatesresolvers.letsencrypt-dns.acme.dnschallenge=true
   --certificatesresolvers.letsencrypt-dns.acme.dnschallenge.provider=route53
   --certificatesresolvers.letsencrypt-dns.acme.dnschallenge.resolvers=1.1.1.1:53,8.8.8.8:53
   --certificatesresolvers.letsencrypt-dns.acme.storage=/traefik/acme-dns.json
   ```

   and `environment: [AWS_REGION=eu-west-1, AWS_HOSTED_ZONE_ID=<zone id from the stack output>]`. Neither is secret.
   First test with `...acme.caserver=<Let's Encrypt staging URL>`, then remove it.
2. **Permission, without a stored key.** The controller already has an instance profile (`ControllerBackupRole` in
   `deploy/host/template.yaml`, S3 `daily/*` only). Add `route53:GetChange` and `route53:ChangeResourceRecordSets`
   and `route53:ListResourceRecordSets` on the one zone, and `route53:ListHostedZonesByName`.
3. **Metadata hop limit.** `deploy/host/template.yaml` sets `HttpPutResponseHopLimit: 1` on the controller. A container
   normally needs 2 to read instance credentials. Raise it to 2 on the controller (an in-place change, estimate), or
   run Traefik with host networking (not recommended), or fall back to an IAM user limited to the zone with its key in
   `/etc/capxul/ingress/route53.env` mode `0600` (a secret held by location only).
4. **Route file.** `draft/sites_ingress.py --subdomain <sub> --address <sites IP> --apply` writes `sites.yaml`
   beside the others. The check proves one label is covered and two are not. Middleware names are prefixed `sites-`
   because names are global across the file provider and `ingress.py` already defines `https-redirect`.
5. **Origin CA.** Copy only the public CA file to `/etc/capxul/ingress/certs/`.
6. **Restart.** Recreating `capxul-ingress` restarts the front door for every service. The precedent notes brief
   restarts (`deploy/openship/README.md`). Do it at a quiet hour.

The route file does not remove the existing `*` Namecheap record. Delegating `worlds` (NS records) takes precedence for
that name and everything below it.

## Could not be determined without access

| Question | How to find out |
|---|---|
| Does OpenShip need to register the wildcard route? | Probably not: the precedent scripts bypass OpenShip. Confirm after `sites.yaml` is written: `openship.capxul.com` still lists its projects and the file survives an OpenShip restart. |
| Does Namecheap accept NS records on a subdomain? | Look at Advanced DNS for the `capxul.com` record types. If not, use option 1b. |
| Controller Traefik version and whether `route53` is built in | `docker exec capxul-ingress traefik version`; the digest is pinned in the compose file. v3 is implied by `ingress.py`. |
| Instance metadata reachable from the container? | From the container, request a token from the metadata service; if it times out, apply change 3. |
| Is `99.81.80.126` an Elastic IP? | `aws ec2 describe-addresses`. If not, the A records break when the instance stops. |
| Is Traefik's HTTP-3 listener (`443/udp`) a problem for wildcard hosts? | No expected effect; confirm with a browser test. |
