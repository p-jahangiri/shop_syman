#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# -ne 1 ]]; then
  printf 'Usage: %s /opt/sayman/shared\n' "$0" >&2
  exit 2
fi

destination=$1
certificate="$destination/identity-encryption.pfx"
mkdir -p "$destination"
if [[ -e "$certificate" ]]; then
  printf 'Certificate already exists; refusing to overwrite %s\n' "$certificate" >&2
  exit 1
fi

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
openssl req -new -x509 -newkey rsa:3072 -sha256 -nodes -days 3650 \
  -subj '/CN=Sayman ASP.NET Data Protection' \
  -keyout "$scratch/key.pem" -out "$scratch/certificate.pem"
# OpenSSL prompts for the export password without placing it in argv or history.
openssl pkcs12 -export -name 'Sayman Data Protection' \
  -inkey "$scratch/key.pem" -in "$scratch/certificate.pem" -out "$scratch/result.pfx"
install -m 0600 "$scratch/result.pfx" "$certificate"
printf 'Created %s\nSet DataProtection__CertificatePassword to the export password.\n' "$certificate"
printf 'The container runs as UID 1654; grant that UID read access and back up this certificate with its password and the persistent key ring.\n'
