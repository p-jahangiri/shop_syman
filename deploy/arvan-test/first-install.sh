#!/usr/bin/env bash
# Run only for a new, isolated Sayman test database. Existing data is preserved.
set -Eeuo pipefail
umask 077
[[ $EUID == 0 && $(uname -m) == x86_64 ]]
[[ $(nproc) -ge 2 && $(awk '/MemTotal/{print $2}' /proc/meminfo) -ge 3700000 ]]
shared=/opt/sayman/shared
config="$shared/deploy"
install -d -m 0700 "$shared" "$shared/backup"
exec 9>"$shared/.initialize.lock"
flock -n 9
if [[ -e "$shared/test-data-initialized" ]]; then
  printf '%s\n' 'This test database is already installed. Use the release workflow.'
  exit 0
fi
[[ -s "$shared/development.json" && -s "$config/deploy.env" && -s "$config/compose.yaml" ]]
install -d -m 0700 "$shared/identity-keys" "$shared/acme-webroot"
chown 1654:1654 "$shared/identity-keys"

if [[ ! -e "$shared/sql.env" ]]; then
  printf "MSSQL_SA_PASSWORD='Aa1!%s'\n" "$(openssl rand -hex 24)" > "$shared/sql.env"
fi
if [[ ! -e "$shared/runtime.env" ]]; then
  if [[ ! -e "$shared/runtime-sql.secret" ]]; then
    printf "RuntimeSqlPassword='Aa1!%s'\n" "$(openssl rand -hex 24)" > "$shared/runtime-sql.secret"
  fi
  . "$shared/runtime-sql.secret"
  dp_password="$(openssl rand -hex 32)"
  signing="$(openssl rand -hex 48)"
  temp=$(mktemp -d "$shared/identity.XXXXXX")
  trap 'rm -f -- "$temp/key.pem" "$temp/cert.pem"; rmdir -- "$temp"' EXIT
  openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 1825 -subj '/CN=Sayman Test Data Protection' -keyout "$temp/key.pem" -out "$temp/cert.pem" >/dev/null 2>&1
  SAYMAN_PFX_PASSWORD="$dp_password" openssl pkcs12 -export -inkey "$temp/key.pem" -in "$temp/cert.pem" -out "$shared/identity.pfx" -passout env:SAYMAN_PFX_PASSWORD
  chown 1654:1654 "$shared/identity.pfx"
  chmod 0400 "$shared/identity.pfx"
  printf "ConnectionStrings__Shop='Server=sql,1433;Database=Sayman;User ID=sayman_runtime;Password=%s;Encrypt=True;TrustServerCertificate=True;Connect Timeout=10'\nAuth__SigningKey='%s'\nDataProtection__CertificatePassword='%s'\n" "$RuntimeSqlPassword" "$signing" "$dp_password" > "$shared/runtime.env"
fi
if [[ ! -e "$shared/admin-initial.secret" ]]; then
  printf "Bootstrap__AdminPassword='Aa1!%s'\n" "$(openssl rand -hex 20)" > "$shared/admin-initial.secret"
fi

dc() { docker compose --env-file "$config/deploy.env" --file "$config/compose.yaml" "$@"; }
sql() { dc exec -T sql bash -c 'export SQLCMDPASSWORD="$MSSQL_SA_PASSWORD"; exec /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -b -r1 "$@"' sqlcmd "$@"; }
backup() {
  local name="sayman-$1-$(date -u +%Y%m%dT%H%M%SZ).bak"
  sql -Q "BACKUP DATABASE [Sayman] TO DISK=N'/var/opt/mssql/data/$name' WITH COPY_ONLY, CHECKSUM; RESTORE VERIFYONLY FROM DISK=N'/var/opt/mssql/data/$name' WITH CHECKSUM;" </dev/null
  dc cp "sql:/var/opt/mssql/data/$name" "$shared/backup/$name" </dev/null
  chmod 0600 "$shared/backup/$name"
  sha256sum "$shared/backup/$name" > "$shared/backup/$name.sha256"
}
dc config --quiet
dc up -d --wait --wait-timeout 240 sql
. "$shared/runtime-sql.secret"
sql <<SQL
IF DB_ID(N'Sayman') IS NULL CREATE DATABASE [Sayman];
GO
USE [Sayman];
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE is_ms_shipped=0)
  THROW 51000, N'Existing database detected. Use the release workflow and preserve its data.', 1;
GO
ALTER DATABASE [Sayman] SET RECOVERY SIMPLE;
GO
IF SUSER_ID(N'sayman_runtime') IS NULL
  CREATE LOGIN [sayman_runtime] WITH PASSWORD=N'$RuntimeSqlPassword', CHECK_POLICY=ON, DEFAULT_DATABASE=[Sayman];
GO
IF USER_ID(N'sayman_runtime') IS NULL
BEGIN
  CREATE USER [sayman_runtime] FOR LOGIN [sayman_runtime];
  ALTER ROLE [db_datareader] ADD MEMBER [sayman_runtime];
  ALTER ROLE [db_datawriter] ADD MEMBER [sayman_runtime];
END;
GO
SQL
backup empty
. "$shared/sql.env"
. "$shared/admin-initial.secret"
ConnectionStrings__Shop="Server=sql,1433;Database=Sayman;User ID=sa;Password=$MSSQL_SA_PASSWORD;Encrypt=True;TrustServerCertificate=True;Connect Timeout=10"
export ConnectionStrings__Shop Bootstrap__AdminPassword
dc run --rm --no-deps -T -e ConnectionStrings__Shop -e Bootstrap__AdminPassword api --seed-dev </dev/null
unset ConnectionStrings__Shop Bootstrap__AdminPassword MSSQL_SA_PASSWORD
backup seeded
date -u +%FT%TZ > "$shared/test-data-initialized"
dc up -d --wait --wait-timeout 240 api storefront admin
