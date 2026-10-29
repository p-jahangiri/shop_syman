"""Package/apply the verified D47 backend on canonical 5080/Sayman only."""
from pathlib import Path
from datetime import datetime, timezone
from urllib.request import urlopen
from urllib.error import HTTPError
import argparse
import json
import os
import shutil
import signal
import subprocess
import time
import uuid
import xml.etree.ElementTree as ET
from local_shop_ops import ROOT, sha, sql, payload, snapshot, configuration_hashes, api_environment

PREPARED = ROOT / 'tmp/admin-business85-backend-prepared.json'
CURRENT = ROOT / 'tmp/api-runtime-current.json'
CHECKS = ROOT / 'artifacts/checks'
NEW_TABLES = {'identity.StaffCreationCommands', 'sales.DigitalDeliveries', 'sales.DigitalDeliveryItems', 'sales.DigitalDeliveryCommands'}
NEW_MIGRATIONS = {'20261028222547_AdministratorProvisionedStaff', '20261028222553_PrivateDigitalFulfillment'}


def read(file):
    return json.loads(Path(file).read_text())


def write(file, value):
    file = Path(file)
    temporary = file.with_suffix('.next.json')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    os.replace(temporary, file)


def source_stable():
    for file, expected in read(CHECKS / 'admin-business85-final-source.json').items():
        assert sha(ROOT / file) == expected, 'Backend source changed after verification: ' + file


def modules(directory):
    expected = read(CHECKS / 'admin-business85-final-dll-parity.json')['hashes']['Shop.Api']
    assert len(expected) == 14
    for file, wanted in expected.items():
        assert sha(directory / file) == wanted
    return expected


def unit_accepted():
    document = ET.parse(CHECKS / 'admin-business85-unit-results/admin-business85-repaired-full-unit.trx').getroot()
    counters = document.find('{*}ResultSummary/{*}Counters').attrib
    assert int(counters['total']) == int(counters['executed']) == int(counters['passed']) == 1205
    assert all(int(counters[key]) == 0 for key in ['failed', 'error', 'timeout', 'aborted', 'notRunnable', 'notExecuted', 'disconnected'])


def listener():
    result = subprocess.run(['lsof', '-nP', '-tiTCP:5080', '-sTCP:LISTEN'], capture_output=True, text=True)
    values = set(result.stdout.split())
    assert len(values) <= 1, 'Unexpected canonical API listeners.'
    return int(next(iter(values))) if values else None


def owned_process(state):
    pid = listener()
    assert pid and pid == state['apiPid']
    command = subprocess.check_output(['ps', '-p', str(pid), '-o', 'command='], text=True).strip()
    assert command == 'dotnet ' + str(ROOT / state['runtimeDirectory'] / 'Shop.Api.dll')
    cwd = subprocess.check_output(['lsof', '-a', '-p', str(pid), '-d', 'cwd', '-Fn'], text=True)
    assert 'n' + str(ROOT) in cwd.splitlines()
    for file, expected in state['moduleSha256'].items():
        assert sha(ROOT / state['runtimeDirectory'] / file) == expected
    return pid


def wait_ready():
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        try:
            with urlopen('http://127.0.0.1:5080/health/ready', timeout=2) as response:
                if response.status == 200:
                    return
        except (OSError, HTTPError):
            time.sleep(.25)
    raise RuntimeError('Canonical API did not become ready; inspect the new local runtime log.')


def backup():
    files = payload('SELECT (SELECT name,size*CONVERT(bigint,8192) allocatedBytes FROM sys.database_files ORDER BY file_id FOR JSON PATH) Payload')
    allocated = sum(item['allocatedBytes'] for item in files)
    assert shutil.disk_usage(ROOT).free > allocated * 3 + 512 * 2**20
    directory = ROOT / 'tmp/local-backups' / ('pre-admin-business85-' + uuid.uuid4().hex)
    directory.mkdir(parents=True, mode=0o700)
    shutil.copytree(ROOT / 'tmp/identity-keys', directory / 'identity-keys')
    shutil.copy2(ROOT / '.env', directory / 'environment.private')
    for file in [directory, *directory.rglob('*')]:
        file.chmod(0o700 if file.is_dir() else 0o600)
    remote = '/var/opt/mssql/data/' + directory.name + '.bak'
    sql("BACKUP DATABASE [Sayman] TO DISK=N'" + remote + "' WITH COPY_ONLY,CHECKSUM,COMPRESSION; RESTORE VERIFYONLY FROM DISK=N'" + remote + "' WITH CHECKSUM;")
    subprocess.run(['docker', 'compose', '--profile', 'backend', 'cp', 'sqlserver:' + remote, str(directory / 'Sayman.bak')], cwd=ROOT, check=True, capture_output=True)
    file = directory / 'Sayman.bak'; file.chmod(0o600)
    remote_sha = subprocess.check_output(['docker', 'compose', '--profile', 'backend', 'exec', '-T', 'sqlserver', 'sha256sum', remote], cwd=ROOT, text=True).split()[0]
    assert file.stat().st_size > 0 and sha(file) == remote_sha
    subprocess.run(['docker', 'compose', '--profile', 'backend', 'exec', '-T', 'sqlserver', 'rm', '--', remote], cwd=ROOT, check=True, capture_output=True)
    report = {'passed': True, 'database': 'Sayman', 'privateDirectory': str(directory.relative_to(ROOT)),
              'backupBytes': file.stat().st_size, 'backupSha256': sha(file), 'copyOnly': True,
              'checksumVerifyOnly': True, 'copyByteExact': True, 'configurationAndKeysCopiedPrivately': True,
              'cloneOrRestorePerformed': False}
    write(CHECKS / 'admin-business85-main-backup.json', report)
    return report


def package():
    source_stable(); unit_accepted()
    source = ROOT / 'tmp/admin-business85-build/bin/Shop.Api/debug'
    expected = modules(source)
    assert shutil.disk_usage(ROOT).free > sum(file.stat().st_size for file in source.rglob('*') if file.is_file()) + 512 * 2**20
    runtime = ROOT / 'tmp' / ('api-runtime-admin-business85-' + uuid.uuid4().hex)
    assert not runtime.exists()
    shutil.copytree(source, runtime)
    modules(runtime)
    manifest = {str(file.relative_to(runtime)): sha(file) for file in sorted(runtime.rglob('*')) if file.is_file()}
    manifest_path = CHECKS / (runtime.name + '-artifacts.json')
    write(manifest_path, {'algorithm': 'SHA-256', 'files': manifest})
    previous = read(CURRENT)
    assert previous['sourceMigrationCount'] == previous['databaseMigrationCount'] == 83
    write(PREPARED, {'packaged': True, 'runtimeDirectory': str(runtime.relative_to(ROOT)),
        'moduleSha256': expected, 'artifactManifest': str(manifest_path.relative_to(ROOT)),
        'artifactManifestSha256': sha(manifest_path), 'previousDescriptor': previous,
        'previousDescriptorSha256': sha(CURRENT), 'configuration': configuration_hashes(),
        'mainChanged': False, 'migrationsApplied': False, 'fullProjectComplete': False})
    print(json.dumps({'packaged': True, 'runtimeDirectory': str(runtime.relative_to(ROOT)), 'mainChanged': False}))


def apply():
    source_stable(); unit_accepted()
    evidence = read(CHECKS / 'admin-business85-final-sql-summary.json')
    assert evidence['distinctPassed'] == evidence['expected'] == 892 and evidence['allCasesAccountedFor']
    assert evidence['cleanupExitCode'] == evidence['wireDecoderExitCode'] == 0 and evidence['wireDecoderRan']
    assert evidence['productModulesAndSourceStable'] and all(row['exitCode'] == 0 for row in evidence['stages'])
    prepared = read(PREPARED); runtime = ROOT / prepared['runtimeDirectory']; modules(runtime)
    assert sha(CURRENT) == prepared['previousDescriptorSha256']
    assert configuration_hashes() == prepared['configuration']
    manifest_path = ROOT / prepared['artifactManifest']
    assert sha(manifest_path) == prepared['artifactManifestSha256']
    for file, expected in read(manifest_path)['files'].items():
        assert sha(runtime / file) == expected
    previous = prepared['previousDescriptor']; pid = owned_process(previous)
    untouched = {name: sha(ROOT / ('tmp/' + name + '-runtime-current.json')) for name in ['storefront', 'admin']}
    result = {'passed': False, 'database': 'Sayman', 'newMigrations': 2, 'newTables': 4,
        'unitPassed': 1205, 'sqlDistinctPassed': 892, 'wireResponsesPassed': 16,
        'runtimeDirectory': prepared['runtimeDirectory'], 'fullProjectComplete': False,
        'digitalDeliveryFeatureComplete': False, 'mainSeedPerformed': False}
    write(CHECKS / 'admin-business85-main-release.json', result)
    os.kill(pid, signal.SIGTERM)
    deadline = time.monotonic() + 45
    while listener() and time.monotonic() < deadline:
        time.sleep(.25)
    assert listener() is None, 'Existing API did not stop gracefully.'
    migration_started = False
    try:
        before = snapshot(); assert len(before['tables']) == 218 and len(before['histories']) == 83
        write(CHECKS / 'admin-business85-main-before.json', before)
        verified_backup = backup()
        assert verified_backup['passed']
        migration_started = True
        with (CHECKS / 'admin-business85-main-migration.log').open('wb') as log:
            subprocess.run(['dotnet', str(runtime / 'Shop.Api.dll'), '--migrate'], cwd=ROOT,
                env=api_environment(), stdout=log, stderr=subprocess.STDOUT, timeout=120, check=True)
        after = snapshot(exclude_staff_flags=True)
        write(CHECKS / 'admin-business85-main-after.json', after)
        assert len(after['histories']) == 85 and len(after['tables']) == 222
        added_migrations = {item['MigrationId'] for item in after['histories']} - {item['MigrationId'] for item in before['histories']}
        assert added_migrations == NEW_MIGRATIONS
        old_tables = {item['schema'] + '.' + item['table']: item for item in before['tables']}
        new_tables = {item['schema'] + '.' + item['table']: item for item in after['tables']}
        assert set(new_tables) - set(old_tables) == NEW_TABLES
        assert all(new_tables[name]['count'] == 0 for name in NEW_TABLES)
        changed = [name for name in old_tables if not name.endswith('.__EFMigrationsHistory') and old_tables[name] != new_tables[name]]
        assert not changed, 'Existing business data changed: ' + ','.join(changed)
        assert before['configuration'] == after['configuration'] == prepared['configuration']
        state = {**previous, 'sourceMigrationCount': 85, 'databaseMigrationCount': 85, 'tableCount': 222,
            'mainPromoted': True, 'slice': 'D47 staff provisioning and customer workspace', 'codeOnly': False,
            'newMigrations': 2, 'newTables': 4, 'runtimeDirectory': prepared['runtimeDirectory'],
            'previousRuntimeDirectory': previous['runtimeDirectory'], 'moduleSha256': prepared['moduleSha256'],
            'apiPid': None, 'restartCommand': 'python3 scripts/serve-main-api.py',
            'runtimeSet': str(PREPARED.relative_to(ROOT)), 'artifactManifest': prepared['artifactManifest'],
            'artifactManifestSha256': prepared['artifactManifestSha256'], 'unitPassed': 1205, 'sqlPassed': 892,
            'localReleaseEvidence': 'artifacts/checks/admin-business85-main-release.json',
            'promotedAtUtc': datetime.now(timezone.utc).isoformat(), 'fullProjectComplete': False,
            'digitalDeliveryFeatureComplete': False, 'newBusinessScenarioSeedPerformed': False}
        state.pop('sessionId', None)
        write(CURRENT, state)
        with (CHECKS / 'admin-business85-main-api.log').open('ab') as log:
            process = subprocess.Popen(['python3', 'scripts/serve-main-api.py'], cwd=ROOT, stdout=log, stderr=log, start_new_session=True)
        wait_ready(); assert listener() == process.pid
        http = []
        for route in ['/api/auth/me', '/api/admin/staff', '/api/admin/customers']:
            try:
                urlopen('http://127.0.0.1:5080' + route, timeout=10)
                raise AssertionError('Private route became public.')
            except HTTPError as error:
                assert error.code == 401 and 'no-store' in error.headers.get('Cache-Control', '')
                http.append({'path': route, 'status': 401})
        assert all(sha(ROOT / ('tmp/' + name + '-runtime-current.json')) == wanted for name, wanted in untouched.items())
        result.update(passed=True, apiPid=process.pid, databaseMigrationCount=85, tableCount=222,
            oldBusinessTablesChanged=[], configurationAndKeysPreserved=True, otherServiceDescriptorsUnchanged=True,
            privateHttpChecks=http, backupEvidence='artifacts/checks/admin-business85-main-backup.json',
            publishedAtUtc=datetime.now(timezone.utc).isoformat())
        write(CHECKS / 'admin-business85-main-release.json', result)
        aggregate_file = ROOT / 'tmp/local-runtime-current.json'
        aggregate = read(aggregate_file)
        aggregate['databaseMigrationCount'] = 85
        aggregate['updatedAtUtc'] = result['publishedAtUtc']
        aggregate.setdefault('componentReleaseEvidence', {})['api'] = state['localReleaseEvidence']
        aggregate['schemaReleaseEvidence'] = {'path': state['localReleaseEvidence'], 'sha256': sha(CHECKS / 'admin-business85-main-release.json')}
        write(aggregate_file, aggregate)
        print(json.dumps({'passed': True, 'apiPid': process.pid, 'databaseMigrationCount': 85, 'tables': 222, 'oldBusinessTablesChanged': 0}))
    except Exception as failure:
        result['failureType'] = type(failure).__name__
        write(CHECKS / 'admin-business85-main-release.json', result)
        # If schema stayed at 83, the prior verified service can be restarted.
        # After any schema change keep evidence and fail forward; never auto-drop
        # a newly used staff/digital history or silently restore an older backup.
        if listener() is None:
            histories = snapshot(exclude_staff_flags=True)['histories'] if migration_started else []
            if not migration_started or len(histories) == 83:
                write(CURRENT, previous)
                with (CHECKS / 'admin-business85-main-api-recovery.log').open('ab') as log:
                    subprocess.Popen(['python3', 'scripts/serve-main-api.py'], cwd=ROOT, stdout=log, stderr=log, start_new_session=True)
        raise


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('mode', choices=['package', 'apply'])
args = parser.parse_args()
if args.mode == 'package':
    package()
else:
    apply()
