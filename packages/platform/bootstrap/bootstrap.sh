#!/usr/bin/env bash
# bootstrap.sh: the one-time set-up of CI's cloud access, run by Aaron on a laptop (BOOTSTRAP.md). It looks everything
# up first, shows exactly what it will create or change, and asks before it does anything. Safe to run again: a second
# run changes nothing that is already right. Nothing secret is printed: keys are read without echo and go straight
# from the program that makes them into GitHub's secrets.
#   bootstrap.sh            create, or bring up to date
#   bootstrap.sh rotate     make new Cloudflare and Neon keys for CI, update the secrets, delete the old keys
#   bootstrap.sh revoke     delete CI's keys, role, secrets and variables (destroy the platform first)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; PKG="$(cd "$HERE/.." && pwd)"; ROOT="$(cd "$PKG/../.." && pwd)"
MODE="${1:-apply}"
STAGE=ci STACK_FILE=bootstrap/bootstrap.run.ts
bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
die() { printf '\n\033[31mbootstrap: %s\033[0m\n' "$*" >&2; exit 1; }
ask() { local a; read -r -p "  $1 " a; printf '%s' "$a"; }
secret() { local v; read -r -s -p "  $1 (input hidden) " v; echo >&2; printf '%s' "$v"; }
confirm() { [ "$(ask "$1 Type yes to go on:")" = yes ] || die "stopped; nothing was changed by this step"; }
cf() { curl -sS --fail-with-body --max-time 30 -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "https://api.cloudflare.com/client/v4/$1"; }
neon() { curl -sS --fail-with-body --max-time 30 -H "Authorization: Bearer $NEON_API_KEY" "https://console.neon.tech/api/v2/$1"; }
py() { python3 -c "$1"; }
case "$MODE" in apply | rotate | revoke) ;; *) die "usage: bootstrap.sh [rotate | revoke]" ;; esac

bold "1. The tools on this laptop"
for t in aws gh bun pnpm python3 curl; do command -v "$t" >/dev/null || die "$t is not installed (BOOTSTRAP.md, 'What you need')"; done
info "aws $(aws --version 2>&1 | cut -d' ' -f1 | cut -d/ -f2), gh $(gh --version | head -1 | cut -d' ' -f3), bun $(bun --version)"
gh auth status >/dev/null 2>&1 || die "gh is not signed in: run 'gh auth login'"
AWS_ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)" || die "aws is not signed in: run 'aws sso login' or 'aws configure'"
info "AWS account $AWS_ACCOUNT_ID, as $(aws sts get-caller-identity --query Arn --output text)"
(cd "$ROOT" && pnpm install --frozen-lockfile >/dev/null) || die "pnpm install failed in $ROOT"

bold "2. Settings (Enter keeps the value in brackets)"
REPO_DEFAULT="$(cd "$ROOT" && gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || echo AaronAbuUsama/capxul-next)"
BOOTSTRAP_REPO="${BOOTSTRAP_REPO:-$(ask "GitHub repository [$REPO_DEFAULT]:")}"; BOOTSTRAP_REPO="${BOOTSTRAP_REPO:-$REPO_DEFAULT}"
AWS_REGION="${AWS_REGION:-$(ask "AWS region for the bench host [eu-west-2]:")}"; AWS_REGION="${AWS_REGION:-eu-west-2}"
PLATFORM_ZONE_NAME="${PLATFORM_ZONE_NAME:-abuusama.dev}" PLATFORM_DOMAIN="${PLATFORM_DOMAIN:-worlds.abuusama.dev}"
info "repository $BOOTSTRAP_REPO, region $AWS_REGION, zone $PLATFORM_ZONE_NAME, sites under $PLATFORM_DOMAIN"
[ -n "${CLOUDFLARE_API_TOKEN:-}" ] || CLOUDFLARE_API_TOKEN="$(secret "Cloudflare token that may create account tokens:")"
[ -n "${NEON_API_KEY:-}" ] || NEON_API_KEY="$(secret "Neon API key of an organization admin:")"
export CLOUDFLARE_API_TOKEN NEON_API_KEY

bold "3. Looking things up (nothing is changed)"
CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-$(cf 'accounts?per_page=50' | py 'import json,sys; r=json.load(sys.stdin)["result"]; print(r[0]["id"] if len(r) == 1 else "")')}"
[ -n "$CLOUDFLARE_ACCOUNT_ID" ] || CLOUDFLARE_ACCOUNT_ID="$(ask "The token sees several Cloudflare accounts; which account id:")"
PLATFORM_ZONE_ID="$(cf "zones?name=$PLATFORM_ZONE_NAME" | py 'import json,sys; r=json.load(sys.stdin)["result"]; print(r[0]["id"] if r else "")')"
[ -n "$PLATFORM_ZONE_ID" ] || die "the Cloudflare token cannot see the zone $PLATFORM_ZONE_NAME"
info "Cloudflare account $CLOUDFLARE_ACCOUNT_ID, zone $PLATFORM_ZONE_NAME = $PLATFORM_ZONE_ID"
NEON_ORG_ID="${NEON_ORG_ID:-$(neon users/me/organizations | py 'import json,sys; o=json.load(sys.stdin)["organizations"]; print(o[0]["id"] if len(o) == 1 else "")')}"
[ -n "$NEON_ORG_ID" ] || NEON_ORG_ID="$(ask "The Neon key sees several organizations; which org id:")"
PROJECTS="$(neon "projects?org_id=$NEON_ORG_ID&limit=100" | py 'import json,sys; print("\n".join(p["id"]+" "+p["name"] for p in json.load(sys.stdin)["projects"] if "worlds-db" in p["name"]))')"
if [ -z "${NEON_WORLDS_PROJECT_ID:-}" ]; then
  if [ "$(printf '%s' "$PROJECTS" | grep -c .)" = 1 ]; then NEON_WORLDS_PROJECT_ID="${PROJECTS%% *}"
  else
    info "Neon projects named *worlds-db*: ${PROJECTS:-none}"
    info "The worlds project is made by packages/world ('./run.sh platform up'). Run that first if there is none."
    NEON_WORLDS_PROJECT_ID="$(ask "Neon project id of the worlds project:")"
  fi
fi
[ -n "$NEON_WORLDS_PROJECT_ID" ] || die "no Neon worlds project"
info "Neon organization $NEON_ORG_ID, worlds project $NEON_WORLDS_PROJECT_ID"
var() { gh variable get "$1" --repo "$BOOTSTRAP_REPO" 2>/dev/null || true; }
PLATFORM_AMI_ID="${PLATFORM_AMI_ID:-$(var PLATFORM_AMI_ID)}"
if [ -z "$PLATFORM_AMI_ID" ]; then
  PLATFORM_AMI_ID="$(aws ssm get-parameter --region "$AWS_REGION" --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 --query Parameter.Value --output text)"
  info "Amazon Linux 2023 image, pinned from today: $PLATFORM_AMI_ID (a new one would replace the machine)"
else
  info "machine image kept: $PLATFORM_AMI_ID"
fi
GEN="$(var CAPXUL_KEY_GENERATION)"; GEN="${GEN:-1}"
[ "$MODE" = rotate ] && GEN=$((GEN + 1))
OIDC="$(aws iam list-open-id-connect-providers --query 'OpenIDConnectProviderList[].Arn' --output text | tr '\t' '\n' | grep token.actions.githubusercontent.com || true)"
SUB="$(gh api "repos/$BOOTSTRAP_REPO/actions/oidc/customization/sub" 2>/dev/null || echo '{}')"
SUB_OK="$(printf '%s' "$SUB" | py 'import json,sys; d=json.load(sys.stdin); print("yes" if d.get("use_default") is False and d.get("include_claim_keys") == ["repo","context","base_ref"] else "no")')"

export BOOTSTRAP_REPO AWS_REGION AWS_ACCOUNT_ID CLOUDFLARE_ACCOUNT_ID PLATFORM_ZONE_ID PLATFORM_ZONE_NAME PLATFORM_DOMAIN \
  NEON_ORG_ID NEON_WORLDS_PROJECT_ID PLATFORM_AMI_ID CAPXUL_KEY_GENERATION="$GEN" CI=true
eval "$(aws configure export-credentials --format env)"   # this session's AWS keys, for Alchemy; never printed
GITHUB_TOKEN="$(gh auth token)"; export GITHUB_TOKEN
alchemy() { (cd "$PKG" && bun node_modules/alchemy/bin/cli.js "$@"); }

if [ "$MODE" = revoke ]; then
  bold "Revoke: this deletes"
  info "- the Cloudflare token capxul-ci-worlds-g$GEN and the Neon key capxul-ci-worlds-g$GEN (CI's keys stop working)"
  info "- the AWS role capxul-ci-platform (CI can no longer reach the bench host)"
  info "- the repository secrets CLOUDFLARE_API_TOKEN, NEON_API_KEY and the variables, CAPXUL_CLOUD_READY included"
  info "It keeps GitHub's OIDC provider in AWS (one per account) and the repository's OIDC subject template."
  info "Destroy the platform first (BOOTSTRAP.md, 'Taking it down'): without the role, nothing can reach the machine."
  confirm "Revoke?"
  alchemy destroy -c "$STACK_FILE" --stage "$STAGE" --yes
  bold "Revoked."; exit 0
fi

bold "4. What this will create or change"
info "AWS account $AWS_ACCOUNT_ID ($AWS_REGION):"
info "  - IAM OIDC provider token.actions.githubusercontent.com, audience sts.amazonaws.com $([ -n "$OIDC" ] && echo "(exists: adopted, kept on revoke)" || echo "(new; kept on revoke)")"
info "  - IAM role capxul-ci-platform: taken on only by $BOOTSTRAP_REPO on master and pull requests into master;"
info "    may run the bench host (EC2, its disk, network and security group in $AWS_REGION; IAM names capxul-bench-*;"
info "    SSM sessions and commands on machines named capxul-bench-*). Policy: packages/platform/bootstrap/src/aws-policy.ts"
info "GitHub $BOOTSTRAP_REPO:"
[ "$SUB_OK" = yes ] && info "  - OIDC subject template already repo, context, base_ref" \
  || info "  - OIDC subject template set to repo, context, base_ref (now: $SUB), so a token says which branch a PR goes into"
info "  - secrets CLOUDFLARE_API_TOKEN, NEON_API_KEY"
info "  - variables AWS_ROLE_ARN AWS_REGION CLOUDFLARE_ACCOUNT_ID NEON_ORG_ID PLATFORM_ZONE_ID PLATFORM_ZONE_NAME"
info "    PLATFORM_DOMAIN PLATFORM_AMI_ID CAPXUL_KEY_GENERATION, and CAPXUL_CLOUD_READY=true last"
info "Cloudflare account $CLOUDFLARE_ACCOUNT_ID: account token capxul-ci-worlds-g$GEN (Workers, Containers, R2, KV,"
info "  Hyperdrive, Tunnel, Secrets Store read, Account Settings read; DNS and Zone read on $PLATFORM_ZONE_NAME only)"
info "Neon organization $NEON_ORG_ID: API key capxul-ci-worlds-g$GEN, limited to project $NEON_WORLDS_PROJECT_ID"
[ "$MODE" = rotate ] && info "Rotation: generation $((GEN - 1)) keys are deleted once the secrets hold generation $GEN."
info "None of this costs money. The bench host costs from the first platform deploy (BOOTSTRAP.md, 'Cost')."
confirm "Create or update all of the above?"

bold "5. GitHub's OIDC subject template"
if [ "$SUB_OK" = yes ]; then info "already set"; else
  printf '{"use_default":false,"include_claim_keys":["repo","context","base_ref"]}' \
    | gh api -X PUT "repos/$BOOTSTRAP_REPO/actions/oidc/customization/sub" --input - >/dev/null
  info "set"
fi

bold "6. The bootstrap stack (Alchemy: $STACK_FILE, stage $STAGE)"
alchemy plan -c "$STACK_FILE" --stage "$STAGE"
alchemy deploy -c "$STACK_FILE" --stage "$STAGE" --yes

bold "7. Checking what CI will see"
gh secret list --repo "$BOOTSTRAP_REPO" | grep -E '^(CLOUDFLARE_API_TOKEN|NEON_API_KEY)\b' | cut -f1 | sed 's/^/  secret /'
[ "$(var CAPXUL_CLOUD_READY)" = true ] || die "CAPXUL_CLOUD_READY is not true; the deploy above did not finish"
info "role $(aws iam get-role --role-name capxul-ci-platform --query Role.Arn --output text)"
info "CAPXUL_CLOUD_READY=true: the world job now runs on pull requests into master"

bold "Done. Next (BOOTSTRAP.md, 'After the bootstrap'):"
info "gh workflow run platform.yml --repo $BOOTSTRAP_REPO --ref master    # the bench host and the platform, about 20 min"
info "Revoke the Cloudflare token and Neon key you typed in here if they were made for this."
