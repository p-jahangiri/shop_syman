"""Publish the tested D109 CMS module on the one canonical local API."""

import argparse
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.dont_write_bytecode = True


def load_script(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ops = load_script('publish-local-media-backend')
verify = load_script('verify-local-business-release')
from local_shop_ops import FINGERPRINT_SQL, SCHEMAS, payload

require = ops.require
sha = verify.sha
CHECKS = ops.CHECKS / 'd109-motion'
TMP = ROOT / 'tmp'
FILES = {'Shop.Modules.Cms.dll', 'Shop.Modules.Cms.pdb'}


def relative(path):
    return str(path.relative_to(ROOT))


def database_state(state):
    histories = ' UNION ALL '.join(
        f"SELECT N'{schema}' [schema],MigrationId,ProductVersion FROM [{schema}].__EFMigrationsHistory"
        for schema in SCHEMAS
    )
    rows = payload(
        'SELECT (SELECT * FROM (' + histories + ') h ORDER BY [schema],MigrationId FOR JSON PATH) Payload'
    )
    shape = payload(
        'SELECT (SELECT COUNT(*) tableCount FROM sys.tables WHERE is_ms_shipped=0 '
        'FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) Payload'
    )
    require(len(rows) == state['databaseMigrationCount'] == state['sourceMigrationCount']
            and shape['tableCount'] == state['tableCount'], 'Sayman schema differs from the selected API.')
    selection = """
        WHERE is_ms_shipped=0 AND (SCHEMA_NAME(schema_id) = N'cms'
        OR (SCHEMA_NAME(schema_id) = N'payments' AND name IN (N'Methods',N'MethodCategories'))
        OR (SCHEMA_NAME(schema_id) = N'credit' AND name IN (N'Plans',N'PlanCategories'))
        OR (SCHEMA_NAME(schema_id) = N'sales' AND name IN (N'CheckoutChargePolicies',N'CheckoutOrderSettings')))
        ORDER BY
    """
    needle = 'WHERE is_ms_shipped=0 ORDER BY'
    require(FINGERPRINT_SQL.count(needle) == 1, 'SQL fingerprint query changed.')
    fingerprints = payload(FINGERPRINT_SQL.replace(needle, selection))
    require(any(row['schema'] == 'cms' and row['table'] == 'Documents' for row in fingerprints),
            'Expected the existing CMS documents table.')
    return {'histories': rows, 'shape': shape, 'fingerprints': fingerprints}


def public_appearance():
    checks = [ops.request('/health/live', 200)[0], ops.request('/health/ready', 200)[0]]
    appearances = {}
    for language in ('fa', 'en'):
        check, body = ops.request('/api/storefront/' + language + '?metadataOnly=true', 200, False)
        site = json.loads(body)['site']
        appearances[language] = {'present': 'appearance' in site, 'value': site.get('appearance')}
        checks.append(check)
    return checks, appearances


def protected_files():
    return {
        'configuration': ops.private_configuration(),
        'media': {name: ops.file_manifest(TMP / name)
                  for name in ('public-media-objects', 'private-file-objects')},
        'frontends': ops.frontend_descriptors(),
        'aggregate': sha(ops.AGGREGATE),
    }


def process_identity(state):
    require(state.get('api') == ops.API_URL, 'Expected the canonical API on port 5080.')
    pid = ops.listener()
    require(pid is not None and pid > 1 and pid == state.get('apiPid'), 'Canonical API listener changed.')
    runtime = verify.workspace_path(state['runtimeDirectory'], TMP)
    command = subprocess.check_output(['ps', '-p', str(pid), '-o', 'command='], text=True, timeout=10).strip()
    cwd = subprocess.check_output(['lsof', '-a', '-p', str(pid), '-d', 'cwd', '-Fn'], text=True, timeout=10)
    started = subprocess.check_output(['ps', '-p', str(pid), '-o', 'lstart='], text=True, timeout=10).strip()
    require(command == 'dotnet ' + str(runtime / 'Shop.Api.dll')
            and 'n' + str(ROOT) in cwd.splitlines() and started, 'Canonical API process ownership changed.')
    return {'pid': pid, 'command': command, 'started': started}


def evidence(unit_path, sql_path, cleanup_path, modules):
    require(len(modules) == 14 and {'Shop.Api.dll', 'Shop.Modules.Cms.dll'} <= set(modules)
            and all(Path(name).name == name and name.startswith('Shop.') and name.endswith('.dll') for name in modules),
            'Expected the 14 product modules.')
    proof = {}
    for label, path, directory, assembly in (
        ('unit', unit_path, ops.UNIT_BIN, 'Shop.Tests'),
        ('sql', sql_path, ops.SQL_BIN, 'Shop.SqlTests'),
    ):
        file = verify.workspace_path(path, CHECKS)
        digest = sha(file)
        count = int(ET.parse(file).getroot().find('{*}ResultSummary/{*}Counters').attrib['total'])
        prefix = assembly + ('.CmsAppearanceSqlTests.' if label == 'sql' else '.CmsAppearanceTests.')
        require(count > 0 and all(name.startswith(prefix) for name in ops.accepted_trx(file, count)),
                'Expected passing CMS appearance tests.')
        require(all(sha(directory / name) == digest for name, digest in modules.items()),
                'Product modules in test outputs differ from the release candidate.')
        proof[label] = {'path': path, 'sha256': digest, 'passed': count,
                        'assemblySha256': sha(directory / (assembly + '.dll'))}
    cleanup = verify.workspace_path(cleanup_path, CHECKS)
    cleanup_hash = sha(cleanup)
    require('SQL cleanup verified: zero SaymanTest_* databases remain.' in cleanup.read_text().splitlines()[0],
            'Expected a successful SQL fixture cleanup check.')
    proof['cleanup'] = {'path': cleanup_path, 'sha256': cleanup_hash}
    return proof


def prepare(args):
    previous_hash = sha(ops.CURRENT)
    previous = ops.read(ops.CURRENT)
    process = process_identity(previous)
    old_runtime, old_entries, _ = verify.manifest(previous, 'api')
    source = ops.source_inventory()
    next_entries = {**old_entries, **{name: sha(ops.API_BIN / name) for name in FILES}}
    require(FILES <= old_entries.keys()
            and next_entries['Shop.Modules.Cms.dll'] != old_entries['Shop.Modules.Cms.dll'],
            'Expected a changed CMS assembly in the API build output.')
    modules = {name: next_entries[name] for name in previous['moduleSha256']}
    require(all(sha(ops.API_BIN / name) == digest for name, digest in modules.items()),
            'An unrelated product module changed in the API build output.')
    proof = evidence(args.unit_trx, args.sql_trx, args.cleanup_log, modules)
    protection = protected_files()
    database = database_state(previous)
    _, appearance = public_appearance()

    run = uuid.uuid4().hex
    runtime = TMP / ('api-runtime-motion-' + run)
    manifest = CHECKS / ('api-' + run + '-manifest.json')
    release = CHECKS / ('api-' + run + '-release.json')
    plan_path = TMP / ('d109-cms-motion-' + run + '-prepared.json')
    shutil.copytree(old_runtime, runtime)
    for name in FILES:
        shutil.copy2(ops.API_BIN / name, runtime / name)
    ops.write(manifest, {'algorithm': 'SHA-256', 'files': next_entries})
    state = {**previous, 'runtimeDirectory': relative(runtime), 'apiPid': None,
             'moduleSha256': modules, 'artifactManifest': relative(manifest),
             'artifactManifestSha256': sha(manifest), 'previousRuntimeDirectory': previous['runtimeDirectory'],
             'slice': 'D109 storefront motion', 'codeOnly': True, 'newMigrations': 0, 'newTables': 0,
             'localReleaseEvidence': relative(release), 'healthEvidence': relative(release),
             'healthCheckPassed': False, 'targetedSqlPassed': proof['sql']['passed'],
             'unitPassed': proof['unit']['passed'], 'runtimeSet': relative(plan_path)}
    state.pop('sessionId', None)
    verify.manifest(state, 'api')
    require(sha(ops.CURRENT) == previous_hash and process_identity(previous) == process,
            'Canonical API changed during preparation.')
    require(ops.source_inventory() == source, 'Backend source changed during preparation.')
    ops.write(plan_path, {'previous': previous, 'previousHash': previous_hash, 'process': process,
                          'state': state, 'source': source, 'evidence': proof, 'protection': protection,
                          'database': database, 'appearance': appearance}, private=True)
    print(relative(plan_path))


def apply(args):
    plan_path = verify.workspace_path(args.plan, TMP)
    plan = ops.read(plan_path)
    state, previous = plan['state'], plan['previous']
    proof = plan['evidence']
    require(evidence(proof['unit']['path'], proof['sql']['path'], proof['cleanup']['path'],
                     state['moduleSha256']) == proof, 'Accepted backend tests changed after prepare.')
    require(sha(ops.CURRENT) == plan['previousHash'] and ops.read(ops.CURRENT) == previous,
            'Canonical API descriptor changed after prepare.')
    require(ops.source_inventory() == plan['source'], 'Backend source changed after prepare.')
    require(protected_files() == plan['protection'], 'Configuration, media or local descriptors changed after prepare.')
    require(database_state(previous) == plan['database'], 'Sayman changed after prepare.')
    require(public_appearance()[1] == plan['appearance'], 'Public appearance changed after prepare.')
    _, old_entries, _ = verify.manifest(previous, 'api')
    _, new_entries, _ = verify.manifest(state, 'api')
    changed = {name for name in old_entries.keys() | new_entries.keys()
               if old_entries.get(name) != new_entries.get(name)}
    require('Shop.Modules.Cms.dll' in changed and changed <= FILES, 'Candidate differs outside the CMS DLL/PDB.')
    release = verify.workspace_path(state['localReleaseEvidence'], CHECKS)
    require(not release.exists(), 'Release evidence already exists.')
    aggregate = ops.read(ops.AGGREGATE)
    require(aggregate.get('database') == 'Sayman' and aggregate.get('apiDescriptor') == relative(ops.CURRENT),
            'Expected the canonical local runtime aggregate.')
    report = {'passed': False, 'codeOnly': True, 'runtimeDirectory': state['runtimeDirectory'],
              'newMigrations': 0, 'newTables': 0, 'changedFiles': sorted(changed), 'testEvidence': proof}
    child = None
    stop_sent = False
    descriptor_changed = False
    try:
        process = process_identity(previous)
        require(process == plan['process'], 'Canonical API process changed after prepare.')
        os.kill(process['pid'], signal.SIGTERM)
        stop_sent = True
        deadline = time.monotonic() + 45
        while ops.listener() == process['pid'] and time.monotonic() < deadline:
            time.sleep(.25)
        require(ops.listener() is None, 'Port 5080 did not become free after the graceful stop.')
        require(sha(ops.CURRENT) == plan['previousHash'], 'Canonical API descriptor changed during stop.')
        state['promotedAtUtc'] = datetime.now(timezone.utc).isoformat()
        ops.write(ops.CURRENT, state)
        descriptor_changed = True
        child = ops.start_api(release.with_suffix('.log'))
        ops.wait_ready(child)
        checks, appearance = public_appearance()
        active = ops.read(ops.CURRENT)
        require(active == {**state, 'apiPid': child.pid} and process_identity(active)['pid'] == child.pid,
                'Candidate API process ownership verification failed.')
        verify.manifest(active, 'api')
        require(appearance == plan['appearance'], 'Public appearance changed during the restart.')
        require(database_state(active) == plan['database'], 'Sayman changed during the restart.')
        require(protected_files() == plan['protection'], 'Configuration, media or local descriptors changed during restart.')
        require(ops.source_inventory() == plan['source'], 'Backend source changed during restart.')
        ops.write(ops.CURRENT, {**active, 'healthCheckPassed': True})
        report.update(passed=True, apiPid=child.pid, database='Sayman', httpChecks=checks,
                      databaseMigrationCount=active['databaseMigrationCount'], tableCount=active['tableCount'],
                      artifactManifest=active['artifactManifest'], artifactManifestSha256=active['artifactManifestSha256'],
                      module14Parity=True, cmsDocumentsUnchanged=True, financialPoliciesUnchanged=True,
                      publicAppearanceUnchanged=True, configurationKeysMediaUnchanged=True,
                      frontendDescriptorsUnchanged=True, publishedAtUtc=state['promotedAtUtc'])
        ops.write(release, report)
        aggregate['updatedAtUtc'] = report['publishedAtUtc']
        aggregate.setdefault('componentReleaseEvidence', {})['api'] = relative(release)
        aggregate['lastComponentReleaseEvidence'] = {'path': relative(release), 'sha256': sha(release)}
        ops.write(ops.AGGREGATE, aggregate)
    except Exception as failure:
        report.update(passed=False, failureType=type(failure).__name__)
        try:
            if descriptor_changed:
                require(ops.read(ops.CURRENT).get('runtimeDirectory') == state['runtimeDirectory'],
                        'Another release owns the API descriptor.')
            if child is not None and child.poll() is None:
                child.terminate()
                child.wait(timeout=20)
            if stop_sent and ops.listener() is None:
                if not descriptor_changed:
                    require(sha(ops.CURRENT) == plan['previousHash'], 'Another release owns the API descriptor.')
                ops.write(ops.CURRENT, previous)
                recovery = ops.start_api(release.with_name(release.stem + '-rollback.log'))
                ops.wait_ready(recovery)
                report.update(rolledBack=True, rollbackApiPid=recovery.pid)
        except Exception as recovery_failure:
            report.update(rolledBack=False, recoveryFailureType=type(recovery_failure).__name__)
        ops.write(release, report)
        raise
    print(json.dumps({'passed': True, 'apiPid': report['apiPid'], 'evidence': relative(release)}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    preparation = commands.add_parser('prepare')
    for argument in ('unit-trx', 'sql-trx', 'cleanup-log'):
        preparation.add_argument('--' + argument, required=True)
    commands.add_parser('apply').add_argument('plan')
    args = parser.parse_args()
    with (TMP / 'public-media-backend-publish.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        (prepare if args.command == 'prepare' else apply)(args)


if __name__ == '__main__':
    try:
        main()
    except (ops.PublishError, verify.VerificationError) as error:
        sys.exit(str(error))
