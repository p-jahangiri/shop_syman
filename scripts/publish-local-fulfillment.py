"""Publish D57 private digital fulfillment and CMS business safeguards to canonical API5080.

Reuse the established ownership, key/config, schema and artifact guards.
This slice requires fresh full unit and complete real SQL coverage on frozen source.
SQL runs in bounded complete-class processes; it is not reported as one full run.
The reviewed D58 address details and D59 owner account paths are included.
No migration, seeded policy, provider activation or external publication occurs.
"""
from pathlib import Path
from datetime import datetime, timezone
from collections import Counter
import argparse
import fcntl
import importlib.util
import json
import shutil
import uuid

spec = importlib.util.spec_from_file_location(
    'local_media_operations', Path(__file__).with_name('publish-local-media-backend.py'))
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)
ROOT = ops.ROOT
CHECKS = ops.CHECKS
CURRENT = ops.CURRENT
AGGREGATE = ops.AGGREGATE
PREPARED = ROOT / 'tmp/d57-api-prepared.json'
EVIDENCE = CHECKS / 'd57-backend-acceptance.json'
UNIT = ROOT / 'backend/tests/Shop.Tests/TestResults/d58-integrated-unit.trx'
BASELINE = ROOT / 'tmp/d56-api-prepared.json'
BASELINE_RUNTIME = 'tmp/api-runtime-purchasing-34afdc902d36456d98a6ac2a9d91bbd0'
# Pin the reviewed backend paths before accepting the frozen source. No schema
# migration or unrelated backend change may enter this code-only publication.
ALLOWED = {
    'backend/src/Shop.Api/Endpoints/CustomerAccountEndpoints.cs',
    'backend/src/Shop.Api/Endpoints/DigitalDeliveryEndpoints.cs',
    'backend/src/Shop.Api/Endpoints/OrderParcelEndpoints.cs',
    'backend/src/Shop.Api/Program.cs',
    'backend/src/Shop.Modules.Catalog/Infrastructure/CatalogService.cs',
    'backend/src/Shop.Modules.Catalog/Media/Services/CatalogPublicImageReferences.cs',
    'backend/src/Shop.Modules.Cms/Services/CmsBlogPostService.cs',
    'backend/src/Shop.Modules.Cms/Services/CmsImageReferences.cs',
    'backend/src/Shop.Modules.Cms/Services/CmsPageService.cs',
    'backend/src/Shop.Modules.Cms/Persistence/Content.cs',
    'backend/src/Shop.Modules.Cms/Domain/CustomerAuthSettingsRules.cs',
    'backend/src/Shop.Modules.Identity/Services/CustomerAccount.cs',
    'backend/src/Shop.Modules.Sales/Persistence/AddressBook.cs',
    'backend/src/Shop.Modules.Sales/Services/AddressGeography.cs',
    'backend/src/Shop.Modules.Sales/Services/CheckoutQuoteService.cs',
    'backend/src/Shop.Modules.Sales/Services/CheckoutQuoteV4Service.cs',
    'backend/src/Shop.Modules.Sales/Services/CheckoutQuoteV5Service.cs',
    'backend/src/Shop.Modules.Sales/Services/CreditOrderService.cs',
    'backend/src/Shop.Modules.Sales/Data/iran-geography.v1.json',
    'backend/src/Shop.Modules.Sales/Contracts/DigitalDeliveryContracts.cs',
    'backend/src/Shop.Modules.Sales/Services/OrderDigitalDeliveryService.cs',
    'backend/src/Shop.Modules.Sales/Services/OrderService.cs',
    'backend/src/Shop.Modules.Sales/Services/OrderV2Service.cs',
    'backend/src/Shop.Modules.Sales/Shop.Modules.Sales.csproj',
    'backend/src/Shop.SharedKernel/Contracts/Catalog/IPublicImageReferences.cs',
    'backend/tests/Shop.SqlTests/AddressBookSqlTests.cs',
    'backend/tests/Shop.SqlTests/AddressGeographySqlTests.cs',
    'backend/tests/Shop.SqlTests/CmsBlogPostSqlTests.cs',
    'backend/tests/Shop.SqlTests/CmsPageSqlTests.cs',
    'backend/tests/Shop.SqlTests/CmsReadyReferenceSqlTests.cs',
    'backend/tests/Shop.SqlTests/CreditClearanceDigitalSqlTests.cs',
    'backend/tests/Shop.SqlTests/CreditClearanceSqlTests.cs',
    'backend/tests/Shop.SqlTests/CustomerAccountSqlTests.cs',
    'backend/tests/Shop.SqlTests/DigitalDeliverySqlTests.cs',
    'backend/tests/Shop.SqlTests/OrderV2DigitalSqlTests.cs',
    'backend/tests/Shop.Tests/AddressBookTests.cs',
    'backend/tests/Shop.Tests/AddressGeographyTests.cs',
    'backend/tests/Shop.Tests/CmsReferenceAndAuthTests.cs',
    'backend/tests/Shop.Tests/CustomerAccountTests.cs',
    'backend/tests/Shop.Tests/DigitalDeliveryBoundaryTests.cs',
    'backend/tests/Shop.Tests/DigitalDeliveryProtectionTests.cs',
    'backend/tests/Shop.Tests/DigitalDeliveryRuleTests.cs',
}
UNIT_EXPECTED = 1410
SQL_EXPECTED = 946



def sources():
    result = ops.source_inventory()
    for name in ['scripts/publish-local-appearance.py', 'scripts/publish-local-fulfillment.py',
                 'scripts/test_publish_local_fulfillment.py', 'scripts/test-sql-batches.py',
                 'scripts/test_sql_batches.py', 'scripts/test_fulfillment_evidence.py',
                 'scripts/verification/verify-digital-delivery-wire.mts', 'scripts/verify-local-business-release.py']:
        result[name] = ops.sha(ROOT / name)
    return result


def require_d56_baseline(previous):
    baseline = ops.read(BASELINE)
    ops.require(baseline['runtimeDirectory'] == previous['runtimeDirectory'] == BASELINE_RUNTIME
                and len(baseline['modules']) == 14
                and previous['moduleSha256'] == baseline['modules'],
                'Expected the accepted canonical D56 runtime and its fourteen module hashes.')


def verified_command(record, path_key='log', sha_key='logSha256'):
    log = ops.relative_path(record[path_key], CHECKS)
    command_path = ops.relative_path(record['command'], CHECKS)
    ops.require(ops.sha(log) == record[sha_key]
                and ops.sha(command_path) == record['commandSha256'], 'SQL command or log changed.')
    command = ops.read(command_path)
    ops.require(command['status'] == 'completed' and command['returnCode'] == 0
                and command['logSha256'] == ops.sha(log)
                and command['cwd'] == str(ROOT)
                and command['newSession'] is True and command['processGroupId'] == command['pid']
                and command['termination']['processGroupId'] == command['pid']
                and command['termination']['processGroupEmpty'] is True
                and command['termination']['signals'] == [],
                'SQL command or its owned process group did not finish successfully.')
    return command, [log, command_path]


def acceptance():
    evidence = ops.read(EVIDENCE)
    previous = {k: v for k, v in ops.read(BASELINE)['source'].items() if k.startswith('backend/')}
    ops.require(set(evidence['ownedSourceSha256']) == ALLOWED,
                'Only the explicitly reviewed D57 source and test paths are accepted.')
    expected = {**previous, **{k: evidence['ownedSourceSha256'][k] for k in ALLOWED}}
    backend = {k: v for k, v in sources().items() if k.startswith('backend/')}
    ops.require(backend == expected, 'Backend changed outside the reviewed D57 business slice.')
    unit = evidence['tests']['fullUnit']
    ops.require(UNIT_EXPECTED > 1333 and unit['path'] == str(UNIT.relative_to(ROOT))
                and unit['passed'] == UNIT_EXPECTED and unit['failed'] == unit['skipped'] == 0
                and ops.sha(UNIT) == unit['sha256'], 'The accepted complete unit run changed.')
    ops.accepted_trx(UNIT, UNIT_EXPECTED)
    sql_report = evidence['tests']['fullSql']
    sql = ops.relative_path(sql_report['path'], CHECKS)
    ops.require(SQL_EXPECTED > 912 and ops.sha(sql) == sql_report['sha256']
                and sql_report['passed'] == SQL_EXPECTED
                and sql_report['failed'] == sql_report['skipped'] == 0, 'The accepted complete SQL coverage changed.')
    coverage = ops.read(sql)
    ops.require(coverage['schemaVersion'] == 1
                and coverage['acceptanceMode'] == 'complete-class-batches'
                and coverage['status'] == 'passed' and coverage['fullSuite'] is True
                and coverage['fullCoverage'] is True
                and coverage['exactDiscoveryExecutionMatch'] is True
                and coverage['allSelectedClassCasesIncluded'] is True
                and coverage['total'] == coverage['expectedCount'] == coverage['executedCount']
                    == coverage['passed'] == SQL_EXPECTED
                and coverage['failed'] == coverage['skipped'] == coverage['disposableDatabasesRemaining'] == 0
                and coverage['sourceUnchanged'] is True and coverage['module14Unchanged'] is True,
                'The complete bounded SQL coverage proof is invalid.')
    discovery = coverage['discovery']
    discovery_path = ops.relative_path(discovery['path'], CHECKS)
    ops.require(discovery['fullSuite'] is True and discovery['filterApplied'] is False
                and len(discovery['names']) == SQL_EXPECTED
                and ops.sha(discovery_path) == discovery['sha256'], 'Fresh complete SQL discovery changed.')
    runner_spec = importlib.util.spec_from_file_location('accepted_sql_batches', ROOT / 'scripts/test-sql-batches.py')
    runner = importlib.util.module_from_spec(runner_spec)
    runner_spec.loader.exec_module(runner)
    ops.require(Counter(runner.parse_discovery(discovery_path.read_text())) == Counter(discovery['names']),
                'Raw SQL discovery differs from the accepted case list.')
    plan_path = ops.relative_path(coverage['plan'], CHECKS)
    ops.require(ops.sha(plan_path) == coverage['planSha256'], 'The original complete SQL plan changed.')
    plan = ops.read(plan_path)
    ops.require(plan['schemaVersion'] == 1 and plan['runId'] == coverage['runId']
                and plan['frozen']['sourceSha256'] == coverage['sourceSha256']
                and plan['frozen']['module14parity'] == coverage['module14parity']
                and plan['frozen']['testAssemblySha256'] == coverage['testAssemblySha256']
                and plan['discovery'] == discovery
                and plan['batches'] == runner.plan_batches(discovery['names'], plan['targetCases'])
                and len(plan['batches']) == len(coverage['batches']), 'SQL plan omitted or changed complete classes.')
    discovery_command, discovery_files = verified_command(discovery, 'path', 'sha256')
    ops.require(discovery_command['argv'][1:] == [str(ROOT / 'scripts/test-sql-local.py'), '--no-build',
                '--configuration', plan['configuration'], '--list-tests', '--', 'xUnit.MaxParallelThreads=1'],
                'Discovery used a filtered or different SQL command.')
    names = []
    sql_files = [sql, plan_path, *discovery_files]
    for batch, planned in zip(coverage['batches'], plan['batches']):
        trx = ops.relative_path(batch['trx'], CHECKS)
        ops.require(batch['failed'] == batch['skipped'] == 0
                    and batch['passed'] == batch['expectedCount']
                    and batch['processStatus'] == 'completed' and batch['returnCode'] == 0
                    and all(batch[key] == planned[key] for key in ['index', 'classes', 'filter', 'expectedCount'])
                    and ops.sha(trx) == batch['trxSha256']
                    and batch['sourceUnchanged'] is True and batch['module14Unchanged'] is True,
                    'An accepted SQL batch changed or did not fully execute.')
        parsed = runner.parse_trx(trx)
        runner.validate_trx(parsed, planned['names'])
        batch_names = ops.accepted_trx(trx, batch['expectedCount'])
        ops.require(Counter(batch_names) == Counter(batch['names']), 'SQL batch case coverage changed.')
        command, command_files = verified_command(batch)
        ops.require(command['argv'][1:] == [str(ROOT / 'scripts/test-sql-local.py'), '--no-build',
                    '--configuration', plan['configuration'], '--filter', planned['filter'],
                    '--logger', 'trx;LogFileName=batch.trx', '--results-directory', str(trx.parent),
                    '--', 'xUnit.MaxParallelThreads=1'], 'SQL batch command differs from its complete-class plan.')
        cleanup_path = ops.relative_path(batch['cleanup']['path'], CHECKS)
        ops.require(batch['cleanup']['disposableDatabasesRemaining'] == 0
                    and ops.sha(cleanup_path) == batch['cleanup']['sha256']
                    and 'zero SaymanTest_' in cleanup_path.read_text(), 'A SQL batch left disposable databases.')
        cleanup_command, cleanup_files = verified_command(batch['cleanup'], 'path', 'sha256')
        ops.require(cleanup_command['argv'][1:] == [str(ROOT / 'scripts/verify-sql-test-cleanup.py')],
                    'SQL batch cleanup did not use the read-only fixture check.')
        names.extend(batch_names)
        sql_files.extend([trx, *command_files, *cleanup_files])
    ops.require(len(names) == SQL_EXPECTED
                and Counter(names) == Counter(discovery['names']) == Counter(sql_report['names'])
                and dict(Counter(names)) == coverage['caseCounter']
                and any('Digital' in name for name in names)
                and any('Cms' in name for name in names)
                and any('Parcel' in name for name in names)
                and any('Credit' in name for name in names),
                'All frozen SQL cases, including digital, mixed, CMS, parcel and credit flows, must execute.')
    cleanup_report = evidence['fixtureCleanup']
    cleanup = ops.relative_path(cleanup_report['path'], CHECKS)
    ops.require(cleanup_report['remainingDatabases'] == 0 and ops.sha(cleanup) == cleanup_report['sha256']
                and 'zero SaymanTest_' in cleanup.read_text(), 'Disposable SQL cleanup was not accepted.')
    modules = evidence['candidateApiUnitSqlModuleSha256']
    ops.require(evidence['candidate14DllParity'] is True and len(modules) == 14
                and {p.name for p in ops.API_BIN.glob('Shop.*.dll')} == set(modules), 'Expected14 Shop assemblies.')
    for name, value in modules.items():
        ops.require(Path(name).name == name and name.startswith('Shop.') and name.endswith('.dll')
                    and all(ops.sha(folder / name) == value for folder in
                    [ops.API_BIN, ops.UNIT_BIN, ops.SQL_BIN]), 'API/unit/SQL assembly differs.')
    covered_backend = {k: v for k, v in coverage['sourceSha256'].items() if k.startswith('backend/')}
    product_backend = {k: v for k, v in backend.items() if not k.startswith('backend/.qa-runners/')}
    ops.require(all(covered_backend.get(k) == value for k, value in product_backend.items()),
                'SQL batches ran on different backend source.')
    for name, value in {**coverage['sourceSha256'], **coverage['testAssemblySha256']}.items():
        path = ops.relative_path(name, ROOT)
        ops.require(ops.sha(path) == value, 'Frozen SQL inputs changed after acceptance.')
    for name, value in modules.items():
        ops.require(coverage['module14parity'][name] == {'api': value, 'unit': value, 'sql': value},
                    'SQL batch assemblies differ from the release candidate.')
    return modules, {str(p.relative_to(ROOT)): ops.sha(p) for p in
                     [BASELINE, EVIDENCE, UNIT, cleanup, *sql_files]}


def prepare():
    modules, tests = acceptance()
    source = sources()
    previous = ops.read(CURRENT)
    previous_sha = ops.sha(CURRENT)
    require_d56_baseline(previous)
    process = ops.process_fingerprint(previous)
    config = ops.private_configuration()
    shape = ops.database_shape()
    other = ops.frontend_descriptors()
    aggregate = ops.aggregate_state()
    aggregate_sha = ops.sha(AGGREGATE)
    files = ops.file_manifest(ops.API_BIN)
    size = sum((ops.API_BIN / p).stat().st_size for p in files)
    ops.require(shutil.disk_usage(ROOT).free > size + 256 * 2**20, 'Insufficient API copy space.')
    run = uuid.uuid4().hex
    runtime = ROOT / 'tmp' / ('api-runtime-fulfillment-' + run)
    shutil.copytree(ops.API_BIN, runtime)
    ops.require(ops.file_manifest(runtime) == files, 'API package copy is incomplete.')
    manifest = CHECKS / (runtime.name + '-artifacts.json')
    ops.write(manifest, {'algorithm': 'SHA-256', 'files': files})
    ops.require(source == sources() and process == ops.process_fingerprint(previous)
                and ops.sha(CURRENT) == previous_sha and ops.sha(AGGREGATE) == aggregate_sha
                and config == ops.private_configuration() and other == ops.frontend_descriptors(),
                'Inputs changed while preparing the API package.')
    package = {'runId': run, 'source': source, 'tests': tests, 'modules': modules,
               'previous': previous, 'previousSha': previous_sha,
               'aggregate': aggregate, 'aggregateSha': aggregate_sha,
               'process': process, 'configuration': config, 'databaseShape': shape,
               'frontends': other, 'runtimeDirectory': str(runtime.relative_to(ROOT)),
               'artifactManifest': str(manifest.relative_to(ROOT)),
               'artifactManifestSha256': ops.sha(manifest)}
    ops.write(PREPARED, package, private=True)
    print(json.dumps({'prepared': True, 'runtimeDirectory': package['runtimeDirectory'],
                      'unitPassed': UNIT_EXPECTED, 'fullSqlPassed': SQL_EXPECTED, 'newMigrations': 0}))


def restore_aggregate(package, attempted):
    current = ops.read(AGGREGATE)
    if current == package['aggregate']:
        return
    ops.require(attempted is not None and current == attempted,
                'Aggregate changed outside this publication; it was preserved during rollback.')
    ops.write(AGGREGATE, package['aggregate'])


def emit_committed_report(report):
    # The API and evidence are committed already. A closed output pipe must not
    # undo a healthy publication or replace its successful release evidence.
    try:
        print(json.dumps(report), flush=True)
    except (OSError, ValueError):
        pass


def apply():
    modules, tests = acceptance()
    package = ops.read(PREPARED)
    ops.require(package['modules'] == modules and package['tests'] == tests
                and package['source'] == sources(), 'Accepted source or tests changed.')
    previous = package['previous']
    require_d56_baseline(previous)
    ops.require(ops.sha(CURRENT) == package['previousSha']
                and ops.sha(AGGREGATE) == package['aggregateSha']
                and ops.process_fingerprint(previous) == package['process']
                and ops.private_configuration() == package['configuration']
                and ops.frontend_descriptors() == package['frontends']
                and ops.database_shape() == package['databaseShape'], 'Canonical inputs changed.')
    release = CHECKS / ('d57-api-' + package['runId'] + '-main-release.json')
    state = {**previous, 'apiPid': None, 'slice': 'D57 fulfillment and CMS safeguards, D58 addresses and D59 owner account',
             'runtimeDirectory': package['runtimeDirectory'], 'moduleSha256': modules,
             'artifactManifest': package['artifactManifest'],
             'artifactManifestSha256': package['artifactManifestSha256'],
             'previousRuntimeDirectory': previous['runtimeDirectory'],
             'runtimeSet': str(PREPARED.relative_to(ROOT)),
             'localReleaseEvidence': str(release.relative_to(ROOT)),
             'healthEvidence': str(release.relative_to(ROOT)), 'unitPassed': UNIT_EXPECTED,
             'sqlPassed': SQL_EXPECTED, 'fullSqlPassed': SQL_EXPECTED, 'fullSqlRunThisRelease': True,
             'fullSqlSingleRunPassed': False, 'sqlAcceptanceMode': 'complete-class-batches',
             'historicalFullSqlPassed': 902, 'newMigrations': 0, 'newTables': 0,
             'mainSeedPerformed': False, 'digitalDeliveryApiAccepted': True, 'digitalDeliveryFeatureComplete': False, 'fullProjectComplete': False}
    for key in ['sqlDistinctPassed', 'initialFullSqlPassed', 'initialFullSqlFailed',
                'staffSqlRetestPassed', 'sqlTestExecutions', 'targetedSqlPassed']:
        state.pop(key, None)
    ops.check_runtime(state)
    process = None
    stopped = False
    aggregate = None
    report = {'passed': False, 'unitPassed': UNIT_EXPECTED, 'fullSqlPassed': SQL_EXPECTED,
              'fullSqlRunThisRelease': True, 'newMigrations': 0, 'newTables': 0,
              'databaseWritesPerformedByPublisher': False, 'tests': tests}
    try:
        ops.stop_process(previous)
        stopped = True
        ops.write(CURRENT, state)
        process = ops.start_api(CHECKS / ('d57-api-' + package['runId'] + '.log'))
        checks = [ops.wait_ready(process)]
        for path, status in [('/health/live', 200), ('/api/storefront/fa?metadataOnly=true', 200),
                             ('/api/storefront/en?metadataOnly=true', 200), ('/api/content/support/fa', 200),
                             ('/api/auth/me', 401), ('/api/admin/staff', 401),
                             ('/api/account/profile', 401),
                             ('/api/orders/11111111111111111111111111111111/fulfillment/digital', 401),
                             ('/api/orders/v2/11111111111111111111111111111111/fulfillment/digital', 401),
                             ('/api/admin/orders/11111111111111111111111111111111/11111111111111111111111111111111/fulfillment/digital', 401)]:
            item, _ = ops.request(path, status, require_no_store='storefront' not in path)
            checks.append(item)
        active = ops.read(CURRENT)
        ops.check_runtime(active)
        ops.require(ops.process_fingerprint(active)['pid'] == process.pid
                    and ops.database_shape() == package['databaseShape']
                    and ops.private_configuration() == package['configuration']
                    and ops.frontend_descriptors() == package['frontends']
                    and sources() == package['source'], 'Post-restart invariant changed.')
        active.update(healthCheckPassed=True, promotedAtUtc=datetime.now(timezone.utc).isoformat())
        ops.write(CURRENT, active)
        report.update(passed=True, apiPid=process.pid, runtimeDirectory=state['runtimeDirectory'],
                      httpChecks=checks, module14Parity=True, schema85Tables222=True,
                      configAndKeysPreserved=True, frontendDescriptorsUnchanged=True)
        ops.write(release, report)
        aggregate = {**package['aggregate'], 'updatedAtUtc': active['promotedAtUtc']}
        aggregate['componentReleaseEvidence'] = {**aggregate.get('componentReleaseEvidence', {}),
                                               'api': str(release.relative_to(ROOT))}
        aggregate['lastComponentReleaseEvidence'] = {'path': str(release.relative_to(ROOT)),
                                                    'sha256': ops.sha(release)}
        ops.require(ops.sha(AGGREGATE) == package['aggregateSha'],
                    'Canonical aggregate changed before publication; its new state was preserved.')
        ops.write(AGGREGATE, aggregate)
    except Exception:
        report['passed'] = False
        for key in ['apiPid', 'runtimeDirectory', 'httpChecks', 'module14Parity',
                    'schema85Tables222', 'configAndKeysPreserved', 'frontendDescriptorsUnchanged']:
            report.pop(key, None)
        try:
            if stopped:
                if ops.listener() is not None:
                    ops.require(process is not None and ops.listener() == process.pid,
                                'Unexpected listener prevents rollback.')
                    ops.stop_process(ops.read(CURRENT))
                if process is not None and process.poll() is None:
                    process.terminate()
                    process.wait(timeout=15)
                ops.write(CURRENT, previous)
                recovery = ops.start_api(CHECKS / ('d57-api-' + package['runId'] + '-rollback.log'))
                ops.wait_ready(recovery)
                report.update(apiRolledBack=True, rollbackPid=recovery.pid)
                restore_aggregate(package, aggregate)
                report.update(rolledBack=True, aggregateRestored=True)
        except Exception:
            report['rollbackIncomplete'] = True
            raise
        finally:
            ops.write(release, report)
        raise
    emit_committed_report(report)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['prepare', 'apply'])
    args = parser.parse_args()
    with (ROOT / 'tmp/public-media-backend-publish.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        prepare() if args.mode == 'prepare' else apply()
