#!/usr/bin/env bash
# template-build.sh: make the company template: a freshly created, empty company site (every app installed, wizard done, Safe bank account, sign-in key,
# features, names, privacy: everything new-site.sh does) saved with bench's own backup, so the next company is a restore instead of a build.
# The template holds a placeholder company (Capxul Company) and a placeholder Safe; capxul.setup.configure_site puts the real ones in.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; out="${TEMPLATE_DIR:-$here/../../core/state/templates/site}"
site=capxul-template.localhost
t0=$(date +%s)
"$here/site-drop.sh" "$site" >/dev/null 2>&1 || true
SITE_NAME=$site CAPXUL_WORLD=main "$here/new-site.sh" capxul-template "Capxul Company" 0x0000000000000000000000000000000000000001 template@example.invalid >&2
built=$(( $(date +%s) - t0 ))
rm -rf "$out"; "$here/site-backup.sh" "$site" "$out" >/dev/null
"$here/site-drop.sh" "$site" >/dev/null 2>&1 || true
printf '{"built_at":"%s","build_seconds":%s,"company":"Capxul Company"}\n' "$(date -u +%FT%TZ)" "$built" > "$out/template.json"
echo "template in $out (built in ${built}s, total $(( $(date +%s) - t0 ))s)"
