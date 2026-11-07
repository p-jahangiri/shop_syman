# Local migration and recovery protocol

1. Inspect current descriptors, API readiness and actual EF history per module on Sayman. Compare exact IDs, not only the total. Determine the forward-only delta. If history and target match, skip migration. Never replay an applied migration, edit applied history, run Down on Sayman or try an older incompatible API.
2. Prepare an accepted, immutable API package and the migration plan. Test upgrade and guards with a short-lived real SQL fixture, verify cleanup, and check API/frontend compatibility. Establish a forward recovery package and what must be preserved: SQL, key ring, media and private runtime configuration.
3. Before schema mutation, verify a private, fresh COPY_ONLY/CHECKSUM backup with RESTORE VERIFYONLY and verify the copied file hash. Review the report and capture the necessary pre-change table/schema baselines. VERIFYONLY is backup readability evidence, not a restore rehearsal.
4. In the controlled local cutover, stop only owned services as needed, apply exactly the pending migrations with the approved publisher, check history and protected data, then start the compatible package on the same ports. Verify readiness and changed HTTP paths. A restart alone must not seed, bootstrap, or migrate.
5. If verification fails, preserve evidence and keep the database protected. Diagnose the current state before another action. Use compatible forward recovery; restore or destructive recovery requires separate authorization.

```sh
python3 'scripts/backup-local.py' --label '<unique-label>' --report 'artifacts/checks/<unique-backup-report>.json'
curl --noproxy '*' -fsS 'http://127.0.0.1:5080/health/ready'
```

See [readiness](../../../docs/READINESS.md), [backup and restore](../../../docs/BACKUP-RESTORE.md), and the [production procedure](../../../docs/DEPLOYMENT.md). Record verified restoration separately from backup and from offsite or disaster recovery acceptance.
