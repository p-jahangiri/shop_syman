# Canonical local operations

Use the existing Sayman instance only: storefront `127.0.0.1:3000`, API `127.0.0.1:5080`, admin `127.0.0.1:3173` and local SQL Server on port 11433. See the [startup guide](../../../README.md) for a fresh checkout and [STATE](../../../docs/STATE.md) for the current release.

1. Read the current descriptors `tmp/{api,storefront,admin}-runtime-current.json` selectively. Verify the package path, required manifest/hashes, port, process identity and working directory. Treat the recorded PID as a hint until it matches the listener.
2. If the SQL service is down, start only `sqlserver` from this Compose project. Preserve unrelated containers, including Parseh Redis.
3. Start a missing canonical service with its launcher. Wait for readiness before starting dependents. Stop only a verified, owned instance when an authorized restart is necessary.

```sh
docker compose --profile backend up -d --wait --no-recreate sqlserver
python3 'scripts/serve-main-api.py'
python3 'scripts/serve-main-storefront.py'
node 'scripts/serve-main-admin.mjs'
```

Run each launcher in its own terminal. Ordinary restart loads existing artifacts and data; bootstrap and Development seed commands are for a fresh environment only. Never try an initial password against an existing account.

For a frontend change, build offline and promote only the required application(s). Use the minimum API migration count when needed. Review the prepared package, manifest and compatibility before applying it.

```sh
python3 'scripts/local/build-local-frontends.py' --only admin
python3 'scripts/publish-local-frontends.py' prepare
python3 'scripts/publish-local-frontends.py' apply
curl --noproxy '*' -fsS 'http://127.0.0.1:5080/health/ready'
```

For the API, use a publisher appropriate to the slice and compatible with the live schema. Follow [migrations](migrations.md) for any schema change; historical publishers are not generic restart tools. Check readiness, relevant HTTP responses and assets on all affected ports, then record evidence and recovery package paths.

Keep runtime and rollback packages, launcher inputs, configuration, media, keys, backups and evidence under `tmp`. Inspect dependencies before any authorized cleanup; APFS clone sizes do not measure actual recovered space. Keep offline build outputs separate from live listeners.
