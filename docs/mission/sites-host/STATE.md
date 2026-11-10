# State of the worlds machine

Written 10 November 2026. Everything below was created that day under the owner's approval, from the owner's AWS root session.

## What exists

| Item | Value |
|---|---|
| CloudFormation stack (machine) | `capxul-worlds-host`, eu-west-1, tag `Project=capxul-worlds`, from `template.yaml` with `CreateHostedZone=false`, `AutoSnapshot=false` |
| CloudFormation stack (zone) | `capxul-worlds-dns`, from `dns-zone.yaml` (made earlier; not changed) |
| Instance | Lightsail `worlds-host-ireland`, eu-west-1a, Ubuntu 24.04 LTS (`ubuntu_24_04`), bundle `xlarge_3_0` (4 vCPU, 16 GiB, 320 GB; $84/month, confirmed with `aws lightsail get-bundles`) |
| Static address | `34.249.131.57` (`worlds-host-ireland-ip`) |
| Lightsail key pair name | `paynest-lightsail-ireland` (existing, as the tools stack; the stack requires one) |
| Zone | `worlds.capxul.com`, id `Z033083453DGJI3WUU2O`; name servers `ns-1035.awsdns-01.org`, `ns-1870.awsdns-41.co.uk`, `ns-221.awsdns-27.com`, `ns-659.awsdns-18.net` |
| Records (added by hand, TTL 300) | `A worlds.capxul.com` and `A *.worlds.capxul.com` -> `34.249.131.57` |
| Cloud firewall (Lightsail) | inbound tcp 22, 80, 443, each ONLY from `143.105.209.28/32` (the operator's Mac on 10 Nov 2026). Nothing else inbound |
| ufw on the machine | default deny incoming; allow tcp 22, 80, 443 from `143.105.209.28` only |

If the Mac's public address changes, SSH and the web are cut off: update `OperatorCidr` (stack update) and ufw.

## Software on the machine (read on the machine)

Ubuntu 24.04.5 LTS, kernel 7.0.0-1012-aws (rebooted once after updates); Docker Engine 29.9.3 and Docker Compose plugin v5.7.0 from Docker's official apt repository (`/etc/apt/sources.list.d/docker.list`); json-file logs capped 20m x 5 (`/etc/docker/daemon.json`);
unattended-upgrades 2.9.1 (daily, security); ufw 0.36.2; swap file `/sites-swap` 4 GiB (kept: 25% of RAM, enough for migration spikes).
Tree: `/srv/capxul/{volumes/{capxul-mariadb-data,capxul-sites,capxul-redis-queue-data,capxul-worlds},sites-host,tls}` (tls mode 700, root), `/etc/capxul/env/sites` (700, root), as `compose.md` describes. No product code, no secret and no containers on it. SSH: key only, no passwords, root key-only.

## How to reach it

```bash
ssh -i ~/.ssh/capxul-worlds-host ubuntu@34.249.131.57      # sudo works without a password
```

Key pair: ed25519, no passphrase, comment `capxul-worlds-host`, private key `~/.ssh/capxul-worlds-host` (public `.pub` beside it). Not in any repository. Only this Mac holds it.

## Cost

Machine $84 a month (static address free while attached); Route 53 zone $0.50 a month plus pennies for queries; no snapshots; outbound transfer inside the bundle allowance. About $85 a month. No other billable resource was created.

## Not exposed to the internet

The test bench uses a stand-in sign-in that lets anyone become any test person. Therefore only the operator's address can reach the machine. **Opening it wider needs real access control first** (a real sign-in, or restricting at the proxy), then a stack update of the firewall and ufw.

## Certificate: NOT issued

The delegation had not resolved fifteen minutes after the machine was ready (11:34 to 11:50 UTC on 10 Nov): `dig NS worlds.capxul.com` returned nothing from 1.1.1.1, 8.8.8.8 and the registrar's own server `pdns1.registrar-servers.com`, so Namecheap did not yet hold the four NS records. The zone itself answers correctly. Nothing was issued, nothing is in `~/.capxul/worlds-host/tls/`. Run these when `dig +short NS worlds.capxul.com @1.1.1.1` prints the four AWS names and `aws sts get-caller-identity` works.
A certbot with the Route 53 plugin was installed in a throwaway virtual environment (`certbot 5.9.0`, in the session's scratch directory, safe to delete). No contact address is used: nothing in the owner's repositories uses `hostmaster@capxul.com` for Let's Encrypt.

```bash
python3 -m venv /tmp/le && /tmp/le/bin/pip install certbot certbot-dns-route53
D=~/.capxul/worlds-host/le; mkdir -p $D ~/.capxul/worlds-host/tls; chmod 700 ~/.capxul ~/.capxul/worlds-host ~/.capxul/worlds-host/tls
COMMON="--dns-route53 --dns-route53-propagation-seconds 30 -d worlds.capxul.com -d *.worlds.capxul.com --config-dir $D/config --work-dir $D/work --logs-dir $D/logs --register-unsafely-without-email --agree-tos --non-interactive"
AWS_DEFAULT_REGION=eu-west-1 /tmp/le/bin/certbot certonly $COMMON --staging      # must succeed first
AWS_DEFAULT_REGION=eu-west-1 /tmp/le/bin/certbot certonly $COMMON --force-renewal # production
install -m 600 $D/config/live/worlds.capxul.com/privkey.pem ~/.capxul/worlds-host/tls/privkey.pem
install -m 644 $D/config/live/worlds.capxul.com/fullchain.pem ~/.capxul/worlds-host/tls/fullchain.pem
scp -i ~/.ssh/capxul-worlds-host ~/.capxul/worlds-host/tls/* ubuntu@34.249.131.57:/tmp/
ssh -i ~/.ssh/capxul-worlds-host ubuntu@34.249.131.57 'sudo install -m 600 -o root -g root /tmp/privkey.pem /srv/capxul/tls/privkey.pem && sudo install -m 644 -o root -g root /tmp/fullchain.pem /srv/capxul/tls/fullchain.pem && shred -u /tmp/privkey.pem; rm -f /tmp/fullchain.pem'
```

The staging run needs the zone to be reachable by the world's resolvers, hence the delegation. The certificate lasts 90 days. **Renewal needs AWS access again** (this Mac with a fresh session) or automation the owner must approve: that would mean an IAM credential limited to `route53:ChangeResourceRecordSets` on this zone plus `ListHostedZones`/`GetChange`, which was not created here. Put the renewal date (about day 60) on the scoreboard once issued.

## Differences from the draft, and why

1. **Front door not touched** (coordinator decision): `*.worlds.capxul.com` and the bare name point at the machine's own address, not the controller, and the machine will terminate HTTPS itself. The draft's controller route, resolver and private origin CA are not used for now. Moving behind the controller later stays possible.
2. **Firewall:** 22, 80, 443 from the operator's /32 only (draft: 22 from operator and controller, 443 from controller, no 80). `ControllerPublicCidr` remains a parameter but is now unused.
3. **Zone:** `CreateHostedZone=false`; the zone is `capxul-worlds-dns`. The two records were added with `aws route53 change-resource-record-sets` (UPSERT), not by the stack, so they are not removed by deleting `capxul-worlds-host`.
4. **Docker:** the draft installed `docker.io` from Ubuntu in user data. Removed from the template; Docker Engine from Docker's official repository was installed over SSH instead.
5. **ubuntu user:** user data also puts the key in `/home/ubuntu/.ssh/authorized_keys` (the draft had root only).
6. Instance and address names were parameters: `worlds-host-ireland`, `worlds-host-ireland-ip` (the draft defaults were `sites-worker-ireland...`). Stack tag `Project=capxul-worlds` added at create; the template's own `Role` tag is on the instance.

## Not done

No bench, no product, no containers; no secrets placed; no certificate; no Namecheap delegation confirmed; no backups (not in the nightly job, no Lightsail snapshots); no monitoring or alarm; no hardening beyond key-only SSH, ufw and unattended upgrades.

## Delete it all, in order

1. Remove the two records in zone `Z033083453DGJI3WUU2O` (`aws route53 change-resource-record-sets` with `DELETE`, same values as above).
2. `aws cloudformation delete-stack --stack-name capxul-worlds-host --region eu-west-1`. The instance and static IP have `DeletionPolicy: Retain`, so the stack goes but they stay: then
   `aws lightsail detach-static-ip --static-ip-name worlds-host-ireland-ip`, `aws lightsail release-static-ip --static-ip-name worlds-host-ireland-ip`, `aws lightsail delete-instance --instance-name worlds-host-ireland` (this destroys the disk and everything on it: take a snapshot first if anything matters).
3. Zone, only if the whole worlds subdomain is going: remove the NS records at Namecheap first, then `aws cloudformation delete-stack --stack-name capxul-worlds-dns` (delete any remaining records in it first).
4. On this Mac: `rm ~/.ssh/capxul-worlds-host ~/.ssh/capxul-worlds-host.pub` and `~/.capxul/worlds-host/`, and the `34.249.131.57` line in `~/.ssh/known_hosts`.
