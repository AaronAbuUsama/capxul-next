# Bootstrap: CI's cloud access, once, from your laptop

CI deploys the platform and makes worlds by itself, but it cannot make its own keys, and no agent may. This is the
one step only you run. It takes about 10 minutes, costs nothing by itself, and can be run again at any time: a
second run changes only what is not already right. It shows everything it will create and asks before it does
anything; it never prints a key.

## What you need

- **Installed:** `aws` (v2), `gh`, `bun` (1.4 or later), `pnpm` (12), `python3`, `curl`, and a checkout of
  `capxul-next` on `master` (or on this branch before it merges).
- **AWS:** signed in to the account the bench host will live in, as someone who may create IAM roles and an OIDC
  provider (an administrator). `aws sso login` or `aws configure` first; `aws sts get-caller-identity` must work.
- **GitHub:** `gh auth login` as an admin of `AaronAbuUsama/capxul-next` (it writes secrets, variables and the OIDC
  subject template).
- **Cloudflare:** a token that may create account tokens. In the dashboard: My Profile, API Tokens, Create Token,
  Custom: Account: *Account API Tokens: Edit*, *Account Settings: Read*, *Workers Scripts: Edit*, *Secrets Store:
  Read*; Zone: *Zone: Read* for `abuusama.dev`. Give it a one-day expiry; you can delete it when this is done.
- **Neon:** an API key of an admin of the organization that holds the worlds project (Account settings, API keys).
  The worlds project must exist: `packages/world/run.sh platform up` makes it.

## Run it

```bash
cd capxul-next
packages/platform/bootstrap/bootstrap.sh
```

It asks for the repository (default from `gh`), the region (default `eu-west-2`, London, next to Neon's
`aws-eu-west-2`), the Cloudflare token and the Neon key (typed hidden, or taken from `CLOUDFLARE_API_TOKEN` and
`NEON_API_KEY` if set). Then it looks up your AWS account, the Cloudflare account and zone, the Neon organization
and worlds project, and today's Amazon Linux 2023 image, and prints the list below with the real names before it asks
`Type yes`.

## What it creates

| Where | What | Why |
|---|---|---|
| AWS IAM | OIDC provider `token.actions.githubusercontent.com` (adopted if it exists; kept on revoke) | GitHub Actions sign in to AWS with a short-lived token, so no AWS key exists anywhere |
| AWS IAM | Role `capxul-ci-platform` | Taken on only by this repository's workflows on `master` and pull requests into `master`. It may run the bench host: EC2 (machine, disk, network, security group) in one region, IAM objects named `capxul-bench-*` with only the SSM policy attached, SSM sessions and commands on machines named `capxul-bench-*`. No inline policies, so it cannot widen itself. `src/aws-policy.ts` |
| GitHub | OIDC subject template `repo, context, base_ref` | GitHub's default token for a pull request does not say which branch it goes into; with this it does, and the role trusts only `base_ref:master` |
| Cloudflare | Account token `capxul-ci-worlds-g1` | Workers, Containers, R2, KV, Hyperdrive, Tunnel, Secrets Store read, Account Settings read; DNS and Zone read on `abuusama.dev` only. It cannot make tokens. `src/cloudflare-policy.ts` |
| Neon | API key `capxul-ci-worlds-g1`, limited to the worlds project | Worlds are branches of that project |
| GitHub | Secrets `CLOUDFLARE_API_TOKEN`, `NEON_API_KEY` | The two keys, written straight from the program that made them |
| GitHub | Variables `AWS_ROLE_ARN`, `AWS_REGION`, `CLOUDFLARE_ACCOUNT_ID`, `NEON_ORG_ID`, `PLATFORM_ZONE_ID`, `PLATFORM_ZONE_NAME`, `PLATFORM_DOMAIN`, `PLATFORM_AMI_ID`, `CAPXUL_KEY_GENERATION` | What the workflows read; none is secret |
| GitHub | Variable `CAPXUL_CLOUD_READY=true`, last | The world job starts running on pull requests once this is true |

The AWS role, the keys, the secrets and the variables are one Alchemy stack (`bootstrap.run.ts`, stack
`CapxulBootstrap`, stage `ci`) kept in the account's shared Cloudflare state store, so the next run, from any
laptop, sees them and changes only what differs.

## Cost

The bootstrap itself costs nothing (IAM, tokens, keys, secrets). The first platform deploy starts the bench host:
about **$79 a month** in London on demand (a `t3.large` machine, $0.0944 an hour, about $69; a 60 GiB gp3 data disk
and the 8 GiB root disk, about $6; a public IPv4 address for its outbound traffic, $3.65; SSM and the tunnel are
free). These are list prices as known on 13 November 2026, not read from AWS here; check them in the AWS pricing
calculator. A `t3` machine that runs hot for long periods can add CPU credit charges.

## After the bootstrap

```bash
gh workflow run platform.yml --repo AaronAbuUsama/capxul-next --ref master   # the machine, then the platform: ~20 min
gh run watch --repo AaronAbuUsama/capxul-next
```

The run creates the machine, waits for it to register with SSM, opens the port forward, builds the bench on the
machine, makes the tunnel and the wildcard `*.worlds.abuusama.dev`, deploys the bench and the door, and ends with a
drift check, whose record is the run's artifact. Pushes to `master` that touch `packages/platform` deploy again.

### The schedule

GitHub starts scheduled workflows only from the repository's default branch, which is `main` while `master` is the
rebuild line. So `drift.yml`'s six-hourly schedule does not fire until one of these, your call:

1. make `master` the default branch (the roadmap's convergence), or
2. add this small workflow to `main`, which starts the drift check on `master` every 6 hours:

```yaml
name: drift-schedule
on:
  schedule:
    - cron: "17 */6 * * *"
permissions:
  actions: write
jobs:
  start:
    runs-on: ubuntu-latest
    steps:
      - run: gh workflow run drift.yml --repo "$GITHUB_REPOSITORY" --ref master
        env:
          GH_TOKEN: ${{ github.token }}
```

Until then, start it by hand: `gh workflow run drift.yml --ref master`. GitHub documents that a workflow started by
hand must also exist on the default branch; if `gh workflow run` says it cannot find `drift.yml`, option 2 is needed.

## Rotate or revoke

```bash
packages/platform/bootstrap/bootstrap.sh rotate   # new Cloudflare and Neon keys for CI; the old ones are deleted
packages/platform/bootstrap/bootstrap.sh revoke   # delete CI's keys, role, secrets and variables
```

Rotation makes generation N+1 of both keys, updates the two secrets, then deletes generation N. Revoking removes
everything in the table except the OIDC provider and the subject template; the gated jobs stop running on pull
requests because `CAPXUL_CLOUD_READY` is gone.

### Taking it down

Destroy the platform before you revoke, while CI can still reach the machine: from a machine with AWS
credentials, `PLATFORM_HOST=aws packages/platform/bin/forward.sh open staging`, then
`PLATFORM_HOST=aws packages/platform/bin/run.sh destroy --stage staging --yes` and
`PLATFORM_HOST=aws packages/platform/bin/run.sh destroy -c host.run.ts --stage staging --yes`, then
`bin/forward.sh close`. The machine's data disk goes with the host stack. Never `alchemy nuke`.
