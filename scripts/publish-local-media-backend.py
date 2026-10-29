"""Prepare/apply D51 code only on canonical API5080/Sayman85.

Never migrates, seeds, backs up, changes Docker, or writes business data. Only
the owned API process may stop. A failed startup restores the prior descriptor
and executable; frontend descriptors, configuration and identity keys are kept.
"""
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, ProxyHandler, build_opener
import argparse
import fcntl
import json
import os
import shutil
import signal
import subprocess
import time
import uuid
import xml.etree.ElementTree as ET

from local_shop_ops import ROOT, SCHEMAS, configuration_hashes, payload, sha


CHECKS = ROOT / 'artifacts/checks'
CURRENT = ROOT / 'tmp/api-runtime-current.json'
AGGREGATE = ROOT / 'tmp/local-runtime-current.json'
PREPARED = ROOT / 'tmp/public-media-backend-prepared.json'
MEDIA = ROOT / 'tmp/public-media-local.json'
AUDIT = CHECKS / 'admin-d51-backend-media-audit.json'
SQL_REPORT = CHECKS / 'admin-d51-media-sql-report.json'
SQL_DISCOVERY = CHECKS / 'admin-d51-media-sql-before.json'
API_BIN = ROOT / 'backend/src/Shop.Api/bin/Debug/net10.0'
UNIT_BIN = ROOT / 'backend/tests/Shop.Tests/bin/Debug/net10.0'
SQL_BIN = ROOT / 'backend/tests/Shop.SqlTests/bin/Debug/net10.0'
API_URL = 'http://127.0.0.1:5080'


class PublishError(RuntimeError):
    """Messages are fixed operational facts, never private configuration."""


def require(condition, message):
    if not condition:
        raise PublishError(message)


def read(file):
    file = Path(file)
    require(file.is_file() and not file.is_symlink(), 'Required regular evidence/configuration file is missing.')
    return json.loads(file.read_text())


def write(file, value, private=False):
    file = Path(file)
    temporary = file.with_name(file.name + '.' + uuid.uuid4().hex + '.next')
    try:
        with temporary.open('x') as stream:
            if private:
                os.fchmod(stream.fileno(), 0o600)
            stream.write(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, file)
    finally:
        temporary.unlink(missing_ok=True)


def relative_path(value, parent):
    require(isinstance(value, str) and not Path(value).is_absolute(), 'Expected a workspace-relative path.')
    path = ROOT / value
    resolved = path.resolve()
    require(resolved.is_relative_to(parent.resolve()) and resolved != parent.resolve(), 'Path escaped its owned workspace directory.')
    require(not path.is_symlink(), 'Owned artifact path must not be a symbolic link.')
    return resolved


def file_manifest(directory):
    require(directory.is_dir() and not directory.is_symlink(), 'Expected an owned artifact directory.')
    entries = sorted(directory.rglob('*'))
    require(not any(file.is_symlink() for file in entries), 'Artifact directory contains a symbolic link.')
    return {str(file.relative_to(directory)): sha(file) for file in entries if file.is_file()}


def check_runtime(state):
    require(state.get('api') == API_URL, 'Only canonical API5080 is supported.')
    require(state.get('sourceMigrationCount') == state.get('databaseMigrationCount') == 85
            and state.get('tableCount') == 222, 'Canonical schema descriptor must remain85/222.')
    runtime = relative_path(state['runtimeDirectory'], ROOT / 'tmp')
    require(runtime.name.startswith('api-runtime-'), 'Expected a managed API runtime.')
    modules = state.get('moduleSha256', {})
    require(len(modules) == 14 and 'Shop.Api.dll' in modules, 'Expected exactly14 accepted Shop modules.')
    for name, expected in modules.items():
        require(Path(name).name == name and name.startswith('Shop.') and name.endswith('.dll'), 'Invalid module manifest entry.')
        require(sha(runtime / name) == expected, 'Selected API module differs from its accepted artifact.')
    manifest_path = relative_path(state['artifactManifest'], CHECKS)
    require(sha(manifest_path) == state['artifactManifestSha256'], 'API artifact manifest changed.')
    manifest = read(manifest_path)
    require(manifest.get('algorithm') == 'SHA-256' and bool(manifest.get('files')), 'A complete API artifact manifest is required.')
    require(file_manifest(runtime) == manifest['files'], 'API runtime file set or artifact bytes changed.')
    return runtime


def source_inventory():
    result = {}
    for directory, children, files in os.walk(ROOT / 'backend'):
        children[:] = sorted(name for name in children if name not in {'bin', 'obj', 'TestResults'})
        for name in sorted(files):
            file = Path(directory) / name
            if file.suffix in {'.cs', '.csproj', '.props', '.targets', '.sln', '.json'}:
                require(not file.is_symlink(), 'Backend source must not be a symbolic link.')
                result[str(file.relative_to(ROOT))] = sha(file)
    for name in ['scripts/serve-main-api.py', 'scripts/local_shop_ops.py', 'scripts/publish-local-media-backend.py']:
        result[name] = sha(ROOT / name)
    return result


def accepted_trx(file, expected):
    document = ET.parse(file).getroot()
    counters = document.find('{*}ResultSummary/{*}Counters').attrib
    require(all(int(counters[key]) == expected for key in ['total', 'executed', 'passed']), 'Test count differs from the accepted complete run.')
    require(all(int(counters.get(key, '0')) == 0 for key in
                ['failed', 'error', 'timeout', 'aborted', 'notRunnable', 'notExecuted', 'disconnected', 'inconclusive']),
            'Tests failed, skipped or did not execute.')
    results = document.findall('{*}Results/{*}UnitTestResult')
    names = [row.attrib['testName'] for row in results]
    # xUnit truncates some long theory display names; distinct test/execution
    # IDs establish cases without treating equal truncated labels as skips.
    require(len(results) == len({row.attrib['testId'] for row in results})
            == len({row.attrib['executionId'] for row in results}) == expected
            and all(row.attrib['outcome'] == 'Passed' for row in results),
            'Actual distinct test results do not match the accepted count.')
    return names


def acceptance():
    audit = read(AUDIT)
    sql = read(SQL_REPORT)
    discovery = read(SQL_DISCOVERY)
    require(audit.get('apiUnitAssemblyParity') is True and sql.get('sourceUnchanged') is True,
            'D51 backend source/module acceptance is missing.')
    for name, expected in audit['sourceSha256'].items():
        file = relative_path(name, ROOT / 'backend')
        require(sha(file) == expected, 'Accepted D51 backend source changed: ' + name)
    unit_trx = relative_path(audit['tests']['admin-d51-backend-unit-full']['trx'], ROOT / 'backend/tests/Shop.Tests/TestResults')
    sql_trx = relative_path(sql['trx'], ROOT / 'backend/tests/Shop.SqlTests/TestResults')
    accepted_trx(unit_trx, 1264)
    names = accepted_trx(sql_trx, 41)
    require(sql.get('expectedCount') == sql.get('executedCount') == sql.get('passed') == 41
            and sql.get('failed') == sql.get('notExecuted') == sql.get('disposableDatabasesRemaining') == 0
            and sql.get('exactDiscoveryExecutionMatch') is True and sql.get('allSelectedClassCasesIncluded') is True,
            'D51 SQL acceptance/cleanup is incomplete.')
    require(len(discovery['names']) == len(set(discovery['names'])) == 41 and set(names) == set(discovery['names']),
            'SQL discovery and executed theory cases differ.')
    expected = {}
    require(len(audit['assemblies']) == len(sql['module14parity']) == 14, 'Expected14 matching backend assemblies.')
    for name, hashes in audit['assemblies'].items():
        require(Path(name).name == name and hashes['api'] == hashes['unit'], 'Invalid accepted module entry.')
        wanted = hashes['api']
        require(sql['module14parity'].get(name) == {'api': wanted, 'unit': wanted, 'sql': wanted}, 'SQL module acceptance differs from unit/API.')
        require(all(sha(folder / name) == wanted for folder in [API_BIN, UNIT_BIN, SQL_BIN]), 'Backend module changed after its accepted tests.')
        expected[name] = wanted
    require({file.name for file in API_BIN.glob('Shop.*.dll')} == set(expected), 'Unexpected API module file set.')
    evidence = [AUDIT, SQL_REPORT, SQL_DISCOVERY, unit_trx, sql_trx]
    return expected, {str(file.relative_to(ROOT)): sha(file) for file in evidence}


def private_configuration():
    # Values and key material are never logged or copied into the runtime.
    config = configuration_hashes()
    if MEDIA.exists():
        require(read(MEDIA) == {'storage': 'Filesystem', 'scannerHost': '127.0.0.1', 'scannerPort': 13310},
                'Only the explicit local filesystem/scanner configuration is allowed.')
        config['publicMediaConfigurationSha256'] = sha(MEDIA)
    else:
        config['publicMediaConfigurationSha256'] = None
    return config


def database_shape():
    counts = ' UNION ALL '.join('SELECT COUNT_BIG(*) n FROM [' + schema + '].__EFMigrationsHistory' for schema in SCHEMAS)
    result = payload('SELECT (SELECT (SELECT SUM(n) FROM (' + counts + ') h) migrationCount,'
                     '(SELECT COUNT(*) FROM sys.tables WHERE is_ms_shipped=0) tableCount FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) Payload')
    require(result == {'migrationCount': 85, 'tableCount': 222}, 'Read-only Sayman schema check differs from85/222; no migration will run.')
    return result


def frontend_descriptors():
    return {name: sha(ROOT / ('tmp/' + name + '-runtime-current.json')) for name in ['admin', 'storefront']}


def aggregate_state():
    state = read(AGGREGATE)
    require(state.get('database') == 'Sayman' and state.get('databaseMigrationCount') == 85
            and state.get('apiDescriptor') == 'tmp/api-runtime-current.json'
            and state.get('canonicalUrls') == {'storefront': 'http://127.0.0.1:3000', 'api': API_URL, 'admin': 'http://127.0.0.1:3173'},
            'The aggregate must describe the one canonical local shop.')
    return state


def listener():
    result = subprocess.run(['lsof', '-nP', '-tiTCP:5080', '-sTCP:LISTEN'], capture_output=True, text=True, timeout=10)
    require(result.returncode in {0, 1}, 'Cannot inspect the canonical API listener.')
    values = set(result.stdout.split())
    require(len(values) <= 1 and all(value.isdecimal() for value in values), 'Unexpected API5080 listeners.')
    return int(next(iter(values))) if values else None


def process_fingerprint(state):
    pid = listener()
    require(isinstance(state.get('apiPid'), int) and pid == state['apiPid'], 'Canonical API listener/PID changed.')
    require(pid is not None and pid > 1, 'Canonical API is not running.')
    command = subprocess.check_output(['ps', '-p', str(pid), '-o', 'command='], text=True, timeout=10).strip()
    runtime = check_runtime(state)
    require(command == 'dotnet ' + str(runtime / 'Shop.Api.dll'), 'API listener is not the selected owned runtime.')
    cwd = subprocess.check_output(['lsof', '-a', '-p', str(pid), '-d', 'cwd', '-Fn'], text=True, timeout=10)
    require('n' + str(ROOT) in cwd.splitlines(), 'API listener working directory changed.')
    started = subprocess.check_output(['ps', '-p', str(pid), '-o', 'lstart='], text=True, timeout=10).strip()
    require(bool(started), 'Cannot establish the API process start time.')
    return {'pid': pid, 'command': command, 'cwd': str(ROOT), 'started': started}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, url):
        return None


HTTP = build_opener(ProxyHandler({}), NoRedirect())


def request(path, expected, require_no_store=True):
    try:
        response = HTTP.open(API_URL + path, timeout=10)
    except HTTPError as error:
        response = error
    with response:
        require(response.status == expected, 'Unexpected local API HTTP status: ' + path)
        no_store = 'no-store' in response.headers.get('Cache-Control', '')
        require(not require_no_store or no_store, 'API health/private/error response lost no-store.')
        body = response.read(256 * 1024 + 1)
        require(len(body) <= 256 * 1024, 'Local health/metadata response exceeded its inspection bound.')
        return {'path': path, 'status': response.status, 'noStore': no_store}, body


def wait_ready(process):
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        require(process.poll() is None, 'Selected API exited during startup.')
        try:
            result, body = request('/health/ready', 200)
            require(json.loads(body).get('status') == 'ready', 'Invalid API readiness response.')
            require(listener() == process.pid, 'Another process claimed API5080.')
            return result
        except (OSError, HTTPError, PublishError):
            time.sleep(.25)
    raise PublishError('Selected API did not become ready before the startup deadline.')


def stop_process(state):
    fingerprint = process_fingerprint(state)
    os.kill(fingerprint['pid'], signal.SIGTERM)
    deadline = time.monotonic() + 45
    while listener() is not None and time.monotonic() < deadline:
        time.sleep(.25)
    require(listener() is None, 'Owned API did not stop gracefully; no forced termination was attempted.')


def start_api(log):
    require(listener() is None, 'API5080 is occupied; no additional API will be started.')
    with log.open('ab') as stream:
        os.fchmod(stream.fileno(), 0o600)
        return subprocess.Popen(['python3', 'scripts/serve-main-api.py'], cwd=ROOT,
                                stdout=stream, stderr=stream, start_new_session=True)


def prepare():
    expected, evidence = acceptance()
    source = source_inventory()
    previous = read(CURRENT)
    process = process_fingerprint(previous)
    configuration = private_configuration()
    shape = database_shape()
    other = frontend_descriptors()
    aggregate_state()
    previous_sha = sha(CURRENT)
    source_files = file_manifest(API_BIN)
    require('Shop.Api.runtimeconfig.json' in source_files and 'Shop.Api.deps.json' in source_files,
            'The complete runnable API output is required.')
    size = sum((API_BIN / name).stat().st_size for name in source_files)
    require(shutil.disk_usage(ROOT).free > size + 256 * 2**20, 'Insufficient free space for the recoverable API package.')
    run = uuid.uuid4().hex
    runtime = ROOT / 'tmp' / ('api-runtime-media-' + run)
    shutil.copytree(API_BIN, runtime)
    require(file_manifest(runtime) == source_files, 'Copied API artifact is incomplete.')
    manifest = CHECKS / (runtime.name + '-artifacts.json')
    write(manifest, {'algorithm': 'SHA-256', 'files': source_files})
    require(source_inventory() == source and sha(CURRENT) == previous_sha
            and private_configuration() == configuration and frontend_descriptors() == other,
            'Inputs changed while preparing the code-only package.')
    require(process_fingerprint(previous) == process, 'Canonical API changed while packaging.')
    state = {'prepared': True, 'runId': run, 'preparedAtUtc': datetime.now(timezone.utc).isoformat(),
             'runtimeDirectory': str(runtime.relative_to(ROOT)), 'moduleSha256': expected,
             'artifactManifest': str(manifest.relative_to(ROOT)), 'artifactManifestSha256': sha(manifest),
             'previousDescriptor': previous, 'previousDescriptorSha256': previous_sha,
             'previousProcess': process, 'previousAggregateSha256': sha(AGGREGATE),
             'otherDescriptors': other, 'configuration': configuration, 'sourceSha256': source,
             'acceptanceEvidenceSha256': evidence, 'databaseShape': shape,
             'publicMediaConfigurationPresent': configuration['publicMediaConfigurationSha256'] is not None,
             'mainChanged': False, 'newMigrations': 0, 'newTables': 0, 'mainSeedPerformed': False,
             'scanProviderAccepted': False, 'fullProjectComplete': False}
    write(PREPARED, state, private=True)
    write(CHECKS / ('admin-d51-backend-' + run + '-prepared.json'), {
        'prepared': True, 'runId': run, 'runtimeDirectory': state['runtimeDirectory'],
        'artifactManifest': state['artifactManifest'], 'artifactFiles': len(source_files),
        'unitPassed': 1264, 'sqlDistinctPassed': 41, 'module14Parity': True,
        'publicMediaConfigurationPresent': state['publicMediaConfigurationPresent'],
        'scanProviderAccepted': False, 'mainChanged': False, 'newMigrations': 0, 'newTables': 0})
    print(json.dumps({'prepared': True, 'runId': run, 'runtimeDirectory': state['runtimeDirectory'],
                      'artifactFiles': len(source_files), 'mainChanged': False,
                      'publicMediaConfigurationPresent': state['publicMediaConfigurationPresent']}))


def apply():
    expected, evidence = acceptance()
    prepared = read(PREPARED)
    require(prepared.get('prepared') is True and prepared.get('newMigrations') == prepared.get('newTables') == 0,
            'Expected an accepted D51 code-only prepared package.')
    require(prepared['moduleSha256'] == expected and prepared['acceptanceEvidenceSha256'] == evidence,
            'Accepted backend evidence changed after prepare.')
    require(source_inventory() == prepared['sourceSha256'], 'Backend source or launcher changed after prepare.')
    require(sha(CURRENT) == prepared['previousDescriptorSha256'] and sha(AGGREGATE) == prepared['previousAggregateSha256'],
            'A canonical runtime descriptor changed after prepare; prepare again.')
    require(private_configuration() == prepared['configuration'], 'Private local configuration/keys or media opt-in changed after prepare.')
    require(frontend_descriptors() == prepared['otherDescriptors'], 'A frontend descriptor changed after prepare.')
    previous = read(CURRENT)
    require(previous == prepared['previousDescriptor'] and process_fingerprint(previous) == prepared['previousProcess'],
            'Canonical API ownership changed after prepare.')
    state = {**previous, 'runtimeDirectory': prepared['runtimeDirectory'], 'apiPid': None,
             'moduleSha256': expected, 'artifactManifest': prepared['artifactManifest'],
             'artifactManifestSha256': prepared['artifactManifestSha256'],
             'slice': 'D51 public images and CMS upload authorization', 'codeOnly': True,
             'newMigrations': 0, 'newTables': 0, 'previousRuntimeDirectory': previous['runtimeDirectory'],
             'restartCommand': 'python3 scripts/serve-main-api.py', 'runtimeSet': str(PREPARED.relative_to(ROOT)),
             'unitPassed': 1264, 'targetedSqlPassed': 41, 'fullSqlRunThisRelease': False,
             'historicalFullSqlPassed': previous.get('sqlPassed', previous.get('historicalFullSqlPassed')),
             'mainSeedPerformed': False, 'publicMediaConfigurationPresent': prepared['publicMediaConfigurationPresent'],
             'scanProviderAccepted': False, 'fullProjectComplete': False}
    state.pop('sessionId', None)
    state.pop('sqlPassed', None)
    check_runtime(state)
    require(database_shape() == prepared['databaseShape'], 'Canonical schema changed; code-only apply stopped.')
    previous_aggregate = aggregate_state()
    run = prepared['runId']
    require(isinstance(run, str) and len(run) == 32 and all(c in '0123456789abcdef' for c in run), 'Invalid prepared run identifier.')
    release = CHECKS / ('admin-d51-backend-' + run + '-main-release.json')
    state['localReleaseEvidence'] = str(release.relative_to(ROOT))
    state['healthEvidence'] = str(release.relative_to(ROOT))
    state['healthCheckPassed'] = False
    state['promotedAtUtc'] = datetime.now(timezone.utc).isoformat()
    report = {'passed': False, 'runId': run, 'database': 'Sayman', 'codeOnly': True,
              'runtimeDirectory': prepared['runtimeDirectory'], 'newMigrations': 0, 'newTables': 0,
              'unitPassed': 1264, 'sqlDistinctPassed': 41, 'fullSqlRunThisRelease': False,
              'mainSeedPerformed': False, 'databaseWritesPerformedByPublisher': False,
              'publicMediaConfigurationPresent': prepared['publicMediaConfigurationPresent'],
              'scanProviderAccepted': False, 'fullProjectComplete': False}
    write(release, report)
    process = None
    descriptor_replaced = False
    aggregate_after_sha = None
    try:
        # Recheck ownership directly before the only termination in this command.
        require(process_fingerprint(previous) == prepared['previousProcess'], 'API ownership changed before stop.')
        stop_process(previous)
        write(CURRENT, state)
        descriptor_replaced = True
        process = start_api(CHECKS / ('admin-d51-backend-' + run + '-api.log'))
        checks = [wait_ready(process)]
        active = read(CURRENT)
        require(active['apiPid'] == process.pid and process_fingerprint(active)['pid'] == process.pid,
                'New API PID/runtime ownership verification failed.')
        for path, status in [('/health/live', 200), ('/api/storefront/fa?metadataOnly=true', 200),
                             ('/api/auth/me', 401), ('/api/admin/staff', 401), ('/api/admin/customers', 401),
                             ('/api/admin/media/capabilities', 401),
                             ('/api/media/catalog/' + uuid.uuid4().hex + '/card.webp', 404)]:
            check, _ = request(path, status, require_no_store=path != '/api/storefront/fa?metadataOnly=true')
            checks.append(check)
        check_runtime(active)
        require(database_shape() == prepared['databaseShape'], 'Read-only schema85/222 verification changed after restart.')
        require(private_configuration() == prepared['configuration'], 'Private configuration or keyring changed during startup.')
        require(frontend_descriptors() == prepared['otherDescriptors'], 'An unrelated frontend descriptor changed during API restart.')
        require(source_inventory() == prepared['sourceSha256'], 'Backend/launcher source changed during restart.')
        require(sha(AGGREGATE) == prepared['previousAggregateSha256'], 'Aggregate descriptor changed during API restart.')
        active['healthCheckPassed'] = True
        write(CURRENT, active)
        report.update(passed=True, apiPid=process.pid, databaseMigrationCount=85, tableCount=222,
                      httpChecks=checks, artifactFilesVerified=len(file_manifest(ROOT / active['runtimeDirectory'])),
                      artifactManifest=prepared['artifactManifest'], artifactManifestSha256=prepared['artifactManifestSha256'],
                      module14Parity=True, configurationAndKeysPreserved=True, otherServiceDescriptorsUnchanged=True,
                      publishedAtUtc=datetime.now(timezone.utc).isoformat())
        write(release, report)
        aggregate = {**previous_aggregate, 'updatedAtUtc': report['publishedAtUtc'], 'apiDescriptor': 'tmp/api-runtime-current.json'}
        aggregate['componentReleaseEvidence'] = {**aggregate.get('componentReleaseEvidence', {}), 'api': str(release.relative_to(ROOT))}
        aggregate['lastComponentReleaseEvidence'] = {'path': str(release.relative_to(ROOT)), 'sha256': sha(release)}
        write(AGGREGATE, aggregate)
        aggregate_after_sha = sha(AGGREGATE)
        write(CHECKS / 'admin-d51-backend-main-release.json', report)
        print(json.dumps({'passed': True, 'apiPid': process.pid, 'databaseMigrationCount': 85,
                          'tables': 222, 'newMigrations': 0, 'newTables': 0, 'evidence': str(release.relative_to(ROOT)),
                          'publicMediaConfigurationPresent': report['publicMediaConfigurationPresent'], 'scanProviderAccepted': False}))
    except Exception as failure:
        report.update(passed=False, failureType=type(failure).__name__, rollbackAttempted=True)
        try:
            occupant = listener()
            if descriptor_replaced and occupant is not None:
                require(process is not None and occupant == process.pid, 'Unexpected API listener prevents automatic rollback.')
                stop_process(read(CURRENT))
            if descriptor_replaced and process is not None and process.poll() is None:
                # Popen owns this unreaped child even if its launcher failed
                # before writing apiPid. It cannot have been reused by another
                # process while poll() still reports that child as alive.
                require(read(CURRENT).get('runtimeDirectory') == prepared['runtimeDirectory'], 'Selected startup descriptor changed externally.')
                process.terminate()
                process.wait(timeout=15)
            report['otherServiceDescriptorsUnchanged'] = frontend_descriptors() == prepared['otherDescriptors']
            if aggregate_after_sha is not None:
                require(sha(AGGREGATE) == aggregate_after_sha, 'Aggregate changed externally after release; preserve it for review.')
                write(AGGREGATE, previous_aggregate)
            if descriptor_replaced or listener() is None:
                require(listener() is None, 'API5080 must be free before restoring the prior runtime.')
                write(CURRENT, previous)
                recovery = start_api(CHECKS / ('admin-d51-backend-' + run + '-rollback-api.log'))
                wait_ready(recovery)
                restored = read(CURRENT)
                require(restored['runtimeDirectory'] == previous['runtimeDirectory'] and process_fingerprint(restored)['pid'] == recovery.pid,
                        'Prior API failed rollback ownership verification.')
                report.update(rolledBack=True, rollbackApiPid=recovery.pid, rollbackRuntimeDirectory=previous['runtimeDirectory'])
            else:
                require(process_fingerprint(previous) == prepared['previousProcess'], 'Previous API ownership could not be re-established.')
                report.update(rolledBack=False, previousApiStillRunning=True)
        except Exception as rollback_failure:
            report.update(rolledBack=False, rollbackFailureType=type(rollback_failure).__name__)
        write(release, report)
        write(CHECKS / 'admin-d51-backend-main-release.json', report)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['prepare', 'apply'])
    arguments = parser.parse_args()
    with (ROOT / 'tmp/public-media-backend-publish.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise PublishError('Another D51 API publication command is already active.') from None
        prepare() if arguments.mode == 'prepare' else apply()


if __name__ == '__main__':
    try:
        main()
    except Exception as failure:
        print(json.dumps({'passed': False, 'failureType': type(failure).__name__,
                          'message': str(failure) if isinstance(failure, PublishError) else 'Operation failed; private configuration and secrets are omitted.'}))
        raise SystemExit(1) from None
