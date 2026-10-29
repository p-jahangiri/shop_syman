#!/usr/bin/env bash
# Run from an extracted, checksum-verified release bundle on the Linux host.
set -Eeuo pipefail
umask 077
bundle=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
root=${1:?Usage: deploy-production.sh /opt/sayman [--validate-only]}
[[ "$root" =~ ^/[A-Za-z0-9_/-]+$ && "$root" != / ]] || { echo 'Use an absolute deployment root without spaces or shell syntax.' >&2; exit 2; }
[[ $# -le 2 && ${2:-} =~ ^(--validate-only)?$ ]] || exit 2
for dependency in python3 docker flock curl timeout sha256sum; do command -v "$dependency" >/dev/null; done
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || { echo 'Production host must be Linux x86_64.' >&2; exit 2; }
mkdir -p "$root/deployments"
exec 9>"$root/.deploy.lock"
flock -n 9 || { echo 'Another production operation holds the deploy lock.' >&2; exit 1; }
cd "$bundle"
sha256sum --check --status SHA256SUMS
python3 "$bundle/scripts/production_release.py" prepare "$bundle" "$root"
compose() { docker compose --project-name sayman-production --env-file "$root/shared/production.env" --env-file "$bundle/release.env" --file "$bundle/compose.production.yaml" "$@"; }
# --quiet avoids printing any resolved SQL credentials or keys.
compose config --quiet
if [[ ${2:-} == --validate-only ]]; then echo 'Release, host files and Compose configuration are valid; no service changed.'; exit 0; fi
release_id=$(basename "$bundle")
[[ "$release_id" =~ ^[A-Za-z0-9_.-]+$ ]] || exit 2
state="$root/deployments/$release_id.state"
phase=preflight
maintenance=false
mark() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$1" >> "$state"; }
fail() {
  local status=$?
  trap - ERR INT TERM
  if [[ $maintenance == true ]]; then compose stop --timeout 30 nginx storefront admin api >/dev/null 2>&1 || true; fi
  mark "FAILED phase=$phase status=$status"
  echo "Deployment failed during $phase. Previous metadata is retained; public apps remain stopped after maintenance begins. Inspect $state and restore with the operator runbook; no database downgrade was attempted." >&2
  exit "$status"
}
trap fail ERR
trap 'false' INT TERM
mark 'STARTED'
if [[ -L "$root/current" ]]; then readlink "$root/current" > "$root/deployments/$release_id.previous"; fi
phase=pull
compose pull
# Validate mounted TLS/nginx syntax before taking the existing release offline.
phase=nginx-preflight
compose run --rm --no-deps -T nginx nginx -t
phase=stop
maintenance=true
compose stop --timeout 60 nginx storefront admin api
phase=backup
# The operator hook must finish only after verified SQL + keys/object backups.
# Receives bundle path; use the shared production.env for credentials on host.
timeout --signal=TERM --kill-after=30s 1800 "$root/shared/pre-migrate-backup" "$bundle"
mark 'BACKUP_VERIFIED'
phase=migrate
# The migration principal is passed by environment, not a command-line secret.
ConnectionStrings__Shop=$(python3 "$bundle/scripts/production_release.py" value "$root/shared/production.env" MIGRATION_CONNECTION_STRING) compose run --rm --no-deps -T api --migrate
mark 'MIGRATION_COMPLETED'
phase=start
compose up --detach --wait --wait-timeout 240 --remove-orphans
phase=https-check
shop_domain=$(python3 "$bundle/scripts/production_release.py" value "$root/shared/production.env" SHOP_DOMAIN)
admin_domain=$(python3 "$bundle/scripts/production_release.py" value "$root/shared/production.env" ADMIN_DOMAIN)
# --resolve verifies the public hostname/certificate against this host's Nginx.
# Fail on redirects so an unexpected login/host redirect cannot look healthy.
for endpoint in "https://$shop_domain/fa" "https://$admin_domain/"; do
  domain=${endpoint#https://}; domain=${domain%%/*}
  status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --connect-timeout 5 --max-time 30 --retry 3 --retry-delay 2 --resolve "$domain:443:127.0.0.1" "$endpoint")
  [[ "$status" == 200 ]] || { echo "Unexpected HTTP $status for $endpoint" >&2; false; }
done
phase=record
ln -sfn "$bundle" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"
mark 'HEALTHY'
maintenance=false
trap - ERR INT TERM
printf 'Published %s. Immutable image references are in release.json; current metadata: %s/current\n' "$release_id" "$root"
