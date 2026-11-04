"""Publish the D55 code-only CMS appearance change to canonical API5080.

Reuse the established local ownership, key/config, schema and artifact guards.
This slice has 1319 full unit cases and three targeted real SQL cases; the old
902-case SQL acceptance remains historical and is never reported as rerun.
"""
from pathlib import Path
from datetime import datetime, timezone
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
PREPARED = ROOT / 'tmp/d55-api-prepared.json'
EVIDENCE = CHECKS / 'd55-cms-appearance-backend-tests.json'
UNIT = ROOT / 'backend/tests/Shop.Tests/TestResults/d55-unit-full.trx'
ALLOWED = {
    'backend/src/Shop.Modules.Cms/Persistence/Content.cs',
    'backend/src/Shop.Modules.Cms/Domain/SiteAppearanceRules.cs',
    'backend/tests/Shop.Tests/CmsAppearanceTests.cs',
    'backend/tests/Shop.SqlTests/CmsAppearanceSqlTests.cs',
}


def sources():
    return {**ops.source_inventory(), 'scripts/publish-local-appearance.py': ops.sha(Path(__file__))}


def acceptance():
    evidence = ops.read(EVIDENCE)
    previous = ops.read(ops.AUDIT)['sourceSha256']
    expected = {**previous, **{k: evidence['ownedSourceSha256'][k] for k in ALLOWED}}
    backend = {k: v for k, v in sources().items() if k.startswith('backend/')}
    ops.require(backend == expected, 'Backend changed outside the reviewed CMS-only slice.')
    ops.accepted_trx(UNIT, 1319)
    sql = ROOT / evidence['reports']['sql']['path']
    ops.require(ops.sha(sql) == evidence['reports']['sql']['sha256'], 'SQL evidence changed.')
    ops.accepted_trx(sql, 3)
    cleanup = CHECKS / 'd55-cms-appearance-cleanup.log'
    ops.require('zero SaymanTest_' in cleanup.read_text(), 'Disposable SQL cleanup was not accepted.')
    modules = evidence['apiUnitSqlDllParity']
    ops.require(len(modules) == 14, 'Expected14 Shop assemblies.')
    for name, value in modules.items():
        ops.require(Path(name).name == name and all(ops.sha(folder / name) == value for folder in
                    [ops.API_BIN, ops.UNIT_BIN, ops.SQL_BIN]), 'API/unit/SQL assembly differs.')
    return modules, {str(p.relative_to(ROOT)): ops.sha(p) for p in [EVIDENCE, UNIT, sql, cleanup]}


def prepare():
    modules, tests = acceptance()
    source = sources()
    previous = ops.read(CURRENT)
    process = ops.process_fingerprint(previous)
    config = ops.private_configuration()
    shape = ops.database_shape()
    other = ops.frontend_descriptors()
    aggregate = ops.aggregate_state()
    files = ops.file_manifest(ops.API_BIN)
    size = sum((ops.API_BIN / p).stat().st_size for p in files)
    ops.require(shutil.disk_usage(ROOT).free > size + 256 * 2**20, 'Insufficient API copy space.')
    run = uuid.uuid4().hex
    runtime = ROOT / 'tmp' / ('api-runtime-appearance-' + run)
    shutil.copytree(ops.API_BIN, runtime)
    ops.require(ops.file_manifest(runtime) == files, 'API package copy is incomplete.')
    manifest = CHECKS / (runtime.name + '-artifacts.json')
    ops.write(manifest, {'algorithm': 'SHA-256', 'files': files})
    ops.require(source == sources() and process == ops.process_fingerprint(previous)
                and config == ops.private_configuration() and other == ops.frontend_descriptors(),
                'Inputs changed while preparing the API package.')
    package = {'runId': run, 'source': source, 'tests': tests, 'modules': modules,
               'previous': previous, 'previousSha': ops.sha(CURRENT),
               'aggregate': aggregate, 'aggregateSha': ops.sha(AGGREGATE),
               'process': process, 'configuration': config, 'databaseShape': shape,
               'frontends': other, 'runtimeDirectory': str(runtime.relative_to(ROOT)),
               'artifactManifest': str(manifest.relative_to(ROOT)),
               'artifactManifestSha256': ops.sha(manifest)}
    ops.write(PREPARED, package, private=True)
    print(json.dumps({'prepared': True, 'runtimeDirectory': package['runtimeDirectory'],
                      'unitPassed': 1319, 'targetedSqlPassed': 3, 'newMigrations': 0}))


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
    ops.require(ops.sha(CURRENT) == package['previousSha']
                and ops.sha(AGGREGATE) == package['aggregateSha']
                and ops.process_fingerprint(previous) == package['process']
                and ops.private_configuration() == package['configuration']
                and ops.frontend_descriptors() == package['frontends']
                and ops.database_shape() == package['databaseShape'], 'Canonical inputs changed.')
    release = CHECKS / ('d55-api-' + package['runId'] + '-main-release.json')
    state = {**previous, 'apiPid': None, 'slice': 'D55 finite CMS appearance controls',
             'runtimeDirectory': package['runtimeDirectory'], 'moduleSha256': modules,
             'artifactManifest': package['artifactManifest'],
             'artifactManifestSha256': package['artifactManifestSha256'],
             'previousRuntimeDirectory': previous['runtimeDirectory'],
             'runtimeSet': str(PREPARED.relative_to(ROOT)),
             'localReleaseEvidence': str(release.relative_to(ROOT)),
             'healthEvidence': str(release.relative_to(ROOT)), 'unitPassed': 1319,
             'sqlPassed': 3, 'targetedSqlPassed': 3, 'fullSqlRunThisRelease': False,
             'fullSqlSingleRunPassed': False, 'sqlAcceptanceMode': 'targeted-cms-appearance',
             'historicalFullSqlPassed': 902, 'newMigrations': 0, 'newTables': 0,
             'mainSeedPerformed': False, 'fullProjectComplete': False}
    for key in ['sqlDistinctPassed', 'initialFullSqlPassed', 'initialFullSqlFailed',
                'staffSqlRetestPassed', 'sqlTestExecutions']:
        state.pop(key, None)
    ops.check_runtime(state)
    process = None
    stopped = False
    aggregate = None
    report = {'passed': False, 'unitPassed': 1319, 'targetedSqlPassed': 3,
              'fullSqlRunThisRelease': False, 'newMigrations': 0, 'newTables': 0,
              'databaseWritesPerformedByPublisher': False, 'tests': tests}
    try:
        ops.stop_process(previous)
        stopped = True
        ops.write(CURRENT, state)
        process = ops.start_api(CHECKS / ('d55-api-' + package['runId'] + '.log'))
        checks = [ops.wait_ready(process)]
        for path, status in [('/health/live', 200), ('/api/storefront/fa?metadataOnly=true', 200),
                             ('/api/auth/me', 401), ('/api/admin/staff', 401)]:
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
                recovery = ops.start_api(CHECKS / ('d55-api-' + package['runId'] + '-rollback.log'))
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
