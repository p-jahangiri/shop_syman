# Test selection and evidence

- Cover the changed user flow, rejected inputs and regressions at the lowest useful layer. Prefer existing check scripts and meaningful assertions over tests that mirror implementation.
- Use real SQL Server for constraints, migrations, money persistence, concurrency, idempotency, module transactions and data authorization. A fake provider or SQL substitute cannot establish real integration.
- Pin source, DLLs and test assemblies for SQL acceptance. Keep backend builds separate from active SQL runs. Use disposable `SaymanTest_*` fixtures; wait for the owning process to exit, then verify cleanup. Never delete an unknown or active database.
- Preserve raw failures and reruns. Report exact pass/fail/skip counts and filters. Describe class or batch coverage precisely; do not present selected classes, reused binaries, or separately successful batches as a fresh single full run.
- For an affected frontend run its contract tests, proxy tests where applicable, typecheck, lint, formatting and build. Verify the exact artifact that will go live. Use [browser QA](browser-qa.md) for actual UI interactions.

```sh
npm test
npm run test:admin-contract
npm run test:admin-server
npm run typecheck
npm run typecheck:admin
npm run lint
npm run format:check
dotnet test 'backend/tests/Shop.Tests' --disable-build-servers -m:1
python3 'scripts/test-sql-local.py' --filter 'FullyQualifiedName~<TestClass>'
python3 'scripts/test-sql-batches.py' --output 'artifacts/checks/<unique-run>'
python3 'scripts/verify-sql-test-cleanup.py'
```

Run the SQL commands against the repository's configured Development SQL service. Use the batch runner when full SQL coverage is warranted. Use the [local build workflow](local-ops.md) for offline artifacts. Link reports and state limitations using the [evidence ladder](acceptance.md).
