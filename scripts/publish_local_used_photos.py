"""Guarded local used-inspection-photo API upgrade,85/222 to86/223.

Default prepare is read-only except an optional new private plan file. Explicit
apply packages the verified API, stops only its owned5080 writer, retains a
verified private backup and applies the one pending approved migration. It
never downgrades/restores SQL or publishes frontends. After migration, recovery
retains compatible86 code. Root separately promotes min86 frontends immediately.
"""
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import argparse
import fcntl
import importlib.util
import json
import os
import re
import shutil
import signal
import subprocess
import time
import uuid


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# Both modules have main guards; importing this helper performs no operation.
ops = load('photo_publication_operations', 'publish-local-media-backend.py')
runner = load('photo_publication_sql_evidence', 'test-sql-batches.py')
from local_shop_ops import api_environment, snapshot, payload, sql

ROOT, CHECKS, CURRENT, AGGREGATE = ops.ROOT, ops.CHECKS, ops.CURRENT, ops.AGGREGATE
BACKEND = CHECKS / 'used-photos-backend/acceptance.json'
FULL_SQL = CHECKS / 'used-photos-sql/proof.json'
FRONTEND = CHECKS / 'used-inspection-photos-frontend/acceptance.json'
FRONT_BUILD = ROOT / 'tmp/frontend-quality-build.json'
MIGRATION = '20261030160000_UsedInspectionPhotos'
NEW_TABLE = 'catalog.UsedItemInspectionPhotos'
MIN_UNIT_COUNT, MIN_TARGET_COUNT, MIN_SQL_COUNT = 1416, 25, 959
MEDIA = ROOT / 'tmp/public-media-objects'
SAFE_RECOVERY = 'Retain compatible86 API and recover forward; no SQL Down, restore or old UI fallback.'


class OwnedStartupIncomplete(ops.PublishError):
    """The exact child we started is still alive; never start a second one."""


def require(condition, message):
    ops.require(condition, message)


def stamp():
    return datetime.now(timezone.utc).isoformat()


def relative(path):
    return str(path.relative_to(ROOT))


def evidence_path(value):
    return ops.relative_path(value, CHECKS)


def bind(record, captured):
    path = evidence_path(record['path'])
    require(ops.sha(path) == record['sha256'], 'Accepted evidence bytes changed.')
    captured[relative(path)] = record['sha256']
    return path


def command(path, captured):
    value = ops.read(path)
    require(value['status'] == 'completed' and value['returnCode'] == 0
            and value['cwd'] == str(ROOT) and value['termination']['processGroupEmpty'] is True,
            'An accepted command did not finish with its owned process group empty.')
    log = path.with_name('output.log')
    require(ops.sha(log) == value['logSha256'], 'An accepted command log changed.')
    captured.update({relative(path): ops.sha(path), relative(log): ops.sha(log)})
    return value


def command_record(value, captured, path_key='log', hash_key='logSha256'):
    path = evidence_path(value['command'])
    require(ops.sha(path) == value['commandSha256'], 'Accepted command record changed.')
    accepted = command(path, captured)
    log = evidence_path(value[path_key])
    require(log == path.with_name('output.log') and ops.sha(log) == value[hash_key], 'Command and result log differ.')
    return accepted


def evidence_selection(backend_acceptance=None, sql_proof=None, frontend_acceptance=None):
    return {'backendAcceptance': relative(evidence_path(backend_acceptance)) if backend_acceptance else relative(BACKEND),
            'sqlProof': relative(evidence_path(sql_proof)) if sql_proof else relative(FULL_SQL),
            'frontendAcceptance': relative(evidence_path(frontend_acceptance)) if frontend_acceptance else relative(FRONTEND)}


def verify_frontend_sources(frontend, build):
    # Validate both maps: merging them could hide a stale quality-check hash
    # behind a newer build hash for the exact same changed source file.
    for recorded in (frontend['sourceSha256'], build['source']):
        require(bool(recorded), 'Frontend source inventories must not be empty.')
        for name, value in recorded.items():
            require(ops.sha(ops.relative_path(name, ROOT)) == value, 'Frontend source changed after its accepted checks/build.')


def accepted_evidence(backend_acceptance=None, sql_proof=None, frontend_acceptance=None):
    selection = evidence_selection(backend_acceptance, sql_proof, frontend_acceptance)
    backend_path, sql_path, frontend_path = (evidence_path(selection[key]) for key in ('backendAcceptance', 'sqlProof', 'frontendAcceptance'))
    captured = {}
    backend = ops.read(backend_path)
    captured[relative(backend_path)] = ops.sha(backend_path)
    require(backend['status'] == 'backend-frozen-targeted-accepted', 'Targeted backend acceptance is unavailable.')
    frozen = ops.read(bind(backend['frozen'], captured))
    require(runner.freeze('Debug') == frozen, 'Compiled modules, test assemblies or backend source changed after acceptance.')
    require(backend['module14parity'] == frozen['module14parity']
            and backend['testAssemblySha256'] == frozen['testAssemblySha256'], 'Backend acceptance differs from its frozen module/test inputs.')
    unit = backend['unit']
    unit_count = unit['total']
    require(type(unit_count) is int and unit_count >= MIN_UNIT_COUNT and unit['failed'] == unit['skipped'] == 0,
            'At least1416complete unit cases are required; counts do not replace exact TRX/frozen evidence.')
    ops.accepted_trx(bind(unit['trx'], captured), unit_count)
    command(bind(unit['command'], captured), captured)
    targeted = backend['sql']
    target_count = targeted['targetedCaseCount']
    require(type(target_count) is int and target_count >= MIN_TARGET_COUNT and targeted['failed'] == targeted['skipped'] == 0,
            'At least25targeted SQL cases are required; counts do not replace exact TRX/frozen evidence.')
    target_names = ops.accepted_trx(bind(targeted['trx'], captured), target_count)
    results = ops.read(bind(targeted['results'], captured))
    command_record(results['command'], captured, 'path', 'sha256')
    target_plan = ops.read(bind(targeted['plan'], captured))
    require(target_plan['frozen'] == frozen and targeted['exactDiscoveryTrxCounter'] is True
            and Counter(target_names) == Counter(target_plan['selectedNames'])
            and Counter(target_names) == Counter(results['trx']['names']), 'Targeted SQL TRX differs from its frozen exact-case plan.')
    command_record(targeted['cleanupAfter'], captured, 'path', 'sha256')
    require(targeted['cleanupAfter']['disposableDatabasesRemaining'] == 0, 'Targeted SQL cleanup is not zero.')

    coverage = ops.read(sql_path)
    captured[relative(sql_path)] = ops.sha(sql_path)
    sql_count = coverage['total']
    require(coverage['status'] == 'passed' and coverage['acceptanceMode'] == 'complete-class-batches'
            and coverage['fullSuite'] is True and coverage['fullCoverage'] is True
            and coverage['exactDiscoveryExecutionMatch'] is True and coverage['allSelectedClassCasesIncluded'] is True
            and type(sql_count) is int and sql_count >= MIN_SQL_COUNT
            and sql_count == coverage['expectedCount'] == coverage['executedCount'] == coverage['passed']
            and coverage['failed'] == coverage['skipped'] == coverage['disposableDatabasesRemaining'] == 0
            and coverage['sourceUnchanged'] is True and coverage['module14Unchanged'] is True,
            'Fresh complete SQL coverage of at least959cases is required before publication.')
    require(targeted['fullDiscoveryCount'] == sql_count, 'Targeted and full SQL acceptances have different full discovery counts.')
    require(all(coverage[key] == frozen[key] for key in frozen), 'Full SQL ran on different frozen inputs.')
    plan_path = evidence_path(coverage['plan'])
    require(ops.sha(plan_path) == coverage['planSha256'], 'The complete SQL plan changed.')
    captured[relative(plan_path)] = ops.sha(plan_path)
    plan = ops.read(plan_path)
    require(plan['runId'] == coverage['runId'] and plan['frozen'] == frozen
            and plan['batches'] == runner.plan_batches(plan['discovery']['names'], plan['targetCases']),
            'The original SQL plan omitted or split complete classes.')
    discovery = coverage['discovery']
    require(discovery == plan['discovery'] and discovery['fullSuite'] is True and discovery['filterApplied'] is False,
            'SQL discovery was filtered or differs from its plan.')
    raw = evidence_path(discovery['path'])
    require(len(discovery['names']) == sql_count and ops.sha(raw) == discovery['sha256']
            and Counter(runner.parse_discovery(raw.read_text())) == Counter(discovery['names']), 'Raw SQL discovery differs.')
    discovered = command_record(discovery, captured, 'path', 'sha256')
    require(discovered['argv'][1:] == [str(ROOT / 'scripts/test-sql-local.py'), '--no-build', '--configuration',
            'Debug', '--list-tests', '--', 'xUnit.MaxParallelThreads=1'], 'Unexpected full SQL discovery command.')
    accepted = runner.verified_prefix(plan, coverage, plan_path)
    require(len(accepted) == len(plan['batches']), 'Full SQL has an incomplete accepted prefix.')
    executed = []
    for batch, planned in zip(accepted, plan['batches']):
        run = command_record(batch, captured)
        trx = evidence_path(batch['trx'])
        require(run['argv'][1:] == [str(ROOT / 'scripts/test-sql-local.py'), '--no-build', '--configuration', 'Debug',
                '--filter', planned['filter'], '--logger', 'trx;LogFileName=batch.trx', '--results-directory',
                str(trx.parent), '--', 'xUnit.MaxParallelThreads=1'], 'SQL batch command differs from the complete-class plan.')
        captured[relative(trx)] = ops.sha(trx)
        clean = command_record(batch['cleanup'], captured, 'path', 'sha256')
        require(clean['argv'][1:] == [str(ROOT / 'scripts/verify-sql-test-cleanup.py')], 'Cleanup command is not the read-only checker.')
        executed.extend(batch['names'])
    require(len(executed) == sql_count and Counter(executed) == Counter(discovery['names'])
            and dict(Counter(executed)) == coverage['caseCounter'], 'Full SQL did not execute each discovered case exactly once.')
    cleanup = coverage['finalCleanup']
    final_command = command_record(cleanup, captured, 'path', 'sha256')
    require(cleanup['disposableDatabasesRemaining'] == 0
            and final_command['argv'][1:] == [str(ROOT / 'scripts/verify-sql-test-cleanup.py')],
            'Final full SQL cleanup is not the zero-database read-only check.')

    frontend, build = ops.read(frontend_path), ops.read(FRONT_BUILD)
    captured.update({relative(frontend_path): ops.sha(frontend_path), relative(FRONT_BUILD): ops.sha(FRONT_BUILD)})
    require(frontend['sourceFrozen'] is True and build['passed'] is True and build['sourceStableDuringBuild'] is True
            and build['apiMinimumMigrationCount'] == 86 and set(build.get('targets', ['storefront', 'admin'])) == {'storefront', 'admin'},
            'Both accepted frontend builds must explicitly requireAPI86.')
    verify_frontend_sources(frontend, build)
    require(set(frontend['checks']) == {'fullStorefront', 'fullAdmin', 'storefrontTypeScript', 'adminTypeScript', 'globalEslint', 'globalPrettier'}
            and len(frontend['logSha256']) >= 6, 'Expected complete frontend tests, type checks, lint and format evidence.')
    for check in frontend['checks'].values():
        require(check['exitCode'] == 0, 'A frontend acceptance check failed.')
    for name, value in frontend['logSha256'].items():
        path = frontend_path.parent / name
        require(Path(name).name == name and ops.sha(path) == value, 'Frontend acceptance log changed.')
        captured[relative(path)] = value
    modules = {name: values['api'] for name, values in frozen['module14parity'].items()}
    require(len(modules) == 14 and all(values == {'api': modules[name], 'unit': modules[name], 'sql': modules[name]}
                                      for name, values in frozen['module14parity'].items()), 'Expected14byte-exact product modules.')
    accepted = {'selection': selection, 'files': captured, 'modules': modules, 'frozen': frozen, 'frozenRecord': backend['frozen'], 'unitPassed': unit_count,
                'targetedSqlPassed': target_count, 'fullSqlPassed': sql_count, 'frontendBuildRun': build['run']}
    if backend.get('physicalFulfillmentCapacityAccepted') is True:
        accepted['physicalFulfillmentCapacityAccepted'] = True
    if backend.get('customerLoginContinuityAccepted') is True:
        accepted['customerLoginContinuityAccepted'] = True
    return accepted


def helper_hashes():
    return {relative(path): ops.sha(path) for path in (Path(__file__).resolve(), ROOT / 'scripts/test_publish_local_used_photos.py',
            ROOT / 'scripts/publish-local-frontends.py', ROOT / 'scripts/serve-main-api.py', ROOT / 'scripts/local_shop_ops.py',
            ROOT / 'scripts/publish-local-media-backend.py', ROOT / 'scripts/test-sql-batches.py')}


def tree(path):
    require(path.is_dir() and not path.is_symlink(), 'Expected an existing unlinked owned directory.')
    return ops.file_manifest(path)


def preserved_files():
    require(ops.read(ROOT / 'tmp/public-media-local.json') == {'storage': 'Filesystem', 'scannerHost': '127.0.0.1', 'scannerPort': 13310},
            'Only the existing local filesystem public-media configuration is supported.')
    return {'configuration': ops.private_configuration(), 'mediaConfigurationSha256': ops.sha(ROOT / 'tmp/public-media-local.json'),
            'publicMediaObjects': tree(MEDIA)}


def preserve_existing_files(before, after):
    # The running compatible API may accept new uploads. Never treat their
    # existence as permission to remove them, and never require a stale tree.
    require(before['configuration'] == after['configuration']
            and before['mediaConfigurationSha256'] == after['mediaConfigurationSha256']
            and all(after['publicMediaObjects'].get(name) == value for name, value in before['publicMediaObjects'].items()),
            'Existing configuration, keys or public image object bytes changed.')


def runtime(state):
    require(state.get('api') == 'http://127.0.0.1:5080' and state.get('databaseMigrationCount') == state.get('sourceMigrationCount')
            and (state['databaseMigrationCount'], state.get('tableCount')) in ((85, 222), (86, 223)), 'Unexpected canonical API descriptor.')
    directory = ops.relative_path(state['runtimeDirectory'], ROOT / 'tmp')
    manifest_path = evidence_path(state['artifactManifest'])
    require(directory.name.startswith('api-runtime-') and ops.sha(manifest_path) == state['artifactManifestSha256'], 'API runtime manifest changed.')
    manifest = ops.read(manifest_path)
    require(manifest['algorithm'] == 'SHA-256' and tree(directory) == manifest['files'], 'Current API runtime bytes changed.')
    require(len(state['moduleSha256']) == 14 and all(Path(name).name == name and ops.sha(directory / name) == value
            for name, value in state['moduleSha256'].items()), 'API modules differ from their accepted artifact.')
    return directory


def owned_process(state):
    directory = runtime(state)
    pid = ops.listener()
    require(isinstance(pid, int) and pid > 1 and pid == state['apiPid'], 'Canonical API listener is not the selected owned process.')
    result = subprocess.check_output(['ps', '-p', str(pid), '-o', 'command='], text=True, timeout=10).strip()
    cwd = subprocess.check_output(['lsof', '-a', '-p', str(pid), '-d', 'cwd', '-Fn'], text=True, timeout=10)
    started = subprocess.check_output(['ps', '-p', str(pid), '-o', 'lstart='], text=True, timeout=10).strip()
    require(result == 'dotnet ' + str(directory / 'Shop.Api.dll') and 'n' + str(ROOT) in cwd.splitlines() and started,
            'API process ownership or start identity changed.')
    return {'pid': pid, 'command': result, 'started': started}


def shape():
    value = payload('SELECT (SELECT SUM(n) FROM (' + ' UNION ALL '.join('SELECT COUNT_BIG(*) n FROM [' + schema + '].__EFMigrationsHistory' for schema in ops.SCHEMAS)
                    + ') h) migrationCount,(SELECT COUNT(*) FROM sys.tables WHERE is_ms_shipped=0) tableCount FOR JSON PATH,WITHOUT_ARRAY_WRAPPER')
    require(value in ({'migrationCount': 85, 'tableCount': 222}, {'migrationCount': 86, 'tableCount': 223}), 'Unexpected canonical database shape; no downgrade or restore will be attempted.')
    return value


def source_migrations():
    values = set()
    for path in (ROOT / 'backend/src/Shop.Api/Migrations').rglob('*.cs'):
        for name in re.findall(r'\[Migration\("([0-9A-Za-z_]+)"\)\]', path.read_text()):
            require((path.parent.name.lower(), name) not in values, 'Duplicate source migration identity.')
            values.add((path.parent.name.lower(), name))
    require(len(values) == 86 and ('catalog', MIGRATION) in values, 'The frozen source must contain exactly86migration identities.')
    return values


def pending_migration(histories):
    applied = {(row['schema'], row['MigrationId']) for row in histories}
    require(len(applied) == 85 and source_migrations() - applied == {('catalog', MIGRATION)}
            and applied <= source_migrations(), 'The only pending source migration must be the approved Catalog photo table.')


def photo_compatibility():
    # Presence, including explicit null/empty arrays, matters to strict old DTOs.
    def json_present(table, column, inspection_paths):
        clauses = []
        for path in inspection_paths:
            clauses.append("EXISTS(SELECT 1 FROM OPENJSON(" + column + ",N'" + path + "') j WHERE j.[key] COLLATE Latin1_General_100_BIN2 IN(N'Photos',N'photos'))")
        return '(SELECT COUNT_BIG(*) FROM ' + table + ' WHERE ' + ' OR '.join(clauses) + ')'
    def snapshots(table, column):
        return '(SELECT COUNT_BIG(*) FROM ' + table + ' q WHERE ' + ' OR '.join(
            "EXISTS(SELECT 1 FROM OPENJSON(q." + column + ",N'$." + lines + "') l CROSS APPLY OPENJSON(l.[value],N'$." + condition + "') j WHERE j.[key] COLLATE Latin1_General_100_BIN2 IN(N'Photos',N'photos'))"
            for lines, condition in (('Lines', 'UsedCondition'), ('lines', 'usedCondition'))) + ')'
    query = "DECLARE @photos bigint=0;IF OBJECT_ID(N'catalog.UsedItemInspectionPhotos',N'U') IS NOT NULL EXEC sys.sp_executesql N'SELECT @n=COUNT_BIG(*) FROM [catalog].[UsedItemInspectionPhotos]',N'@n bigint OUTPUT',@n=@photos OUTPUT;SELECT @photos photoRows,"
    query += json_present('[catalog].[UsedItemCommands]', '[ResultJson]', ('$.detail.inspection', '$.Detail.Inspection')) + ' receiptJson,'
    query += snapshots('[sales].[CheckoutQuotes]', 'ResponseJson') + ' quoteJson,' + snapshots('[sales].[Orders]', 'QuoteSnapshotJson') + ' orderJson FOR JSON PATH,WITHOUT_ARRAY_WRAPPER;'
    counts = payload(query)
    require(set(counts) == {'photoRows', 'receiptJson', 'quoteJson', 'orderJson'} and all(isinstance(v, int) and v >= 0 for v in counts.values()), 'Photo compatibility inspection did not return bounded counts.')
    return {'counts': counts, 'oldCodeCompatible': all(value == 0 for value in counts.values()), 'readOnly': True}


def require_old_compatible(value):
    require(value['oldCodeCompatible'] is True and all(value['counts'][key] == 0 for key in ('photoRows', 'receiptJson', 'quoteJson', 'orderJson')),
            'Photo history exists; old API/UI/schema rollback is forbidden. ' + SAFE_RECOVERY)


METADATA_SQL = """SELECT SCHEMA_NAME(t.schema_id) [schema],t.name [table],
 CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),
  (SELECT c.name,c.column_id,c.system_type_id,c.user_type_id,c.max_length,c.precision,c.scale,c.is_nullable,c.collation_name,c.is_identity,c.is_computed,cc.definition computedDefinition,dc.definition defaultDefinition
   FROM sys.columns c LEFT JOIN sys.computed_columns cc ON cc.object_id=c.object_id AND cc.column_id=c.column_id LEFT JOIN sys.default_constraints dc ON dc.object_id=c.default_object_id WHERE c.object_id=t.object_id ORDER BY c.column_id FOR JSON PATH,INCLUDE_NULL_VALUES)+
  (SELECT i.name,i.index_id,i.type,i.is_unique,i.is_primary_key,i.is_unique_constraint,i.has_filter,i.filter_definition,i.is_disabled,ic.index_column_id,ic.column_id,ic.key_ordinal,ic.is_descending_key,ic.is_included_column
   FROM sys.indexes i LEFT JOIN sys.index_columns ic ON i.object_id=ic.object_id AND i.index_id=ic.index_id WHERE i.object_id=t.object_id ORDER BY i.index_id,ic.index_column_id FOR JSON PATH,INCLUDE_NULL_VALUES)+
  (SELECT f.name,f.referenced_object_id,f.delete_referential_action,f.update_referential_action,f.is_disabled,f.is_not_trusted,fc.constraint_column_id,fc.parent_column_id,fc.referenced_column_id
   FROM sys.foreign_keys f JOIN sys.foreign_key_columns fc ON f.object_id=fc.constraint_object_id WHERE f.parent_object_id=t.object_id ORDER BY f.name,fc.constraint_column_id FOR JSON PATH,INCLUDE_NULL_VALUES)+
  (SELECT c.name,c.definition,c.is_disabled,c.is_not_trusted FROM sys.check_constraints c WHERE c.parent_object_id=t.object_id ORDER BY c.name FOR JSON PATH,INCLUDE_NULL_VALUES))),2) sha256
 FROM sys.tables t WHERE t.is_ms_shipped=0 ORDER BY [schema],[table] FOR JSON PATH;"""


def database_snapshot():
    value = snapshot()
    value['metadata'] = payload(METADATA_SQL)
    return value


def preserved_database(before, after):
    old = {row['schema'] + '.' + row['table']: row for row in before['tables']}
    new = {row['schema'] + '.' + row['table']: row for row in after['tables']}
    require(len(old) == 222 and len(new) == 223 and set(new) - set(old) == {NEW_TABLE}
            and new[NEW_TABLE]['count'] == 0, 'Upgrade must add exactly one empty photo table.')
    require(all(row == new[name] for name, row in old.items() if name != 'catalog.__EFMigrationsHistory'), 'Existing business rows changed during the stopped upgrade.')
    old_meta = {row['schema'] + '.' + row['table']: row for row in before['metadata']}
    new_meta = {row['schema'] + '.' + row['table']: row for row in after['metadata']}
    require(len(old_meta) == 222 and all(row == new_meta.get(name) for name, row in old_meta.items()), 'Existing table metadata changed during the upgrade.')
    old_history = {(row['schema'], row['MigrationId'], row['ProductVersion']) for row in before['histories']}
    new_history = {(row['schema'], row['MigrationId'], row['ProductVersion']) for row in after['histories']}
    added = new_history - old_history
    require(len(old_history) == 85 and len(new_history) == 86 and old_history <= new_history and len(added) == 1
            and next(iter(added))[:2] == ('catalog', MIGRATION), 'Unexpected migration history delta.')
    require(before['configuration'] == after['configuration'], 'Configuration/key fingerprints changed during migration.')


def measured_space():
    allocated = payload('SELECT name,size*CONVERT(bigint,8192) bytes FROM sys.database_files ORDER BY file_id FOR JSON PATH')
    db_bytes = sum(row['bytes'] for row in allocated)
    media_bytes = sum(file.stat().st_size for file in MEDIA.rglob('*') if file.is_file())
    private_bytes = (ROOT / '.env').stat().st_size + sum(file.stat().st_size for file in (ROOT / 'tmp/identity-keys').rglob('*') if file.is_file())
    api_bytes = sum(file.stat().st_size for file in ops.API_BIN.rglob('*') if file.is_file())
    needed = db_bytes * 3 + media_bytes + private_bytes + api_bytes + 512 * 2**20
    free = shutil.disk_usage(ROOT).free
    require(db_bytes > 0 and free > needed, 'Measured backup/package capacity plus safety margin is unavailable.')
    result = subprocess.run(['docker', 'compose', '--profile', 'backend', 'exec', '-T', 'sqlserver', 'df', '-Pk', '/var/opt/mssql/data'], cwd=ROOT, capture_output=True, text=True, timeout=20)
    require(result.returncode == 0 and len(result.stdout.splitlines()) >= 2, 'Cannot measure SQL-container backup space.')
    fields = result.stdout.splitlines()[-1].split()
    require(len(fields) >= 6 and fields[3].isdecimal(), 'Invalid SQL-container capacity response.')
    remote_free = int(fields[3]) * 1024
    require(remote_free > db_bytes * 2 + 64 * 2**20, 'SQL-container backup capacity is insufficient.')
    return {'databaseAllocatedBytes': db_bytes, 'publicMediaBytes': media_bytes, 'privateBytes': private_bytes,
            'apiPackageBytes': api_bytes, 'hostFreeBytes': free, 'requiredHostFreeBytes': needed, 'containerFreeBytes': remote_free}


def prepare(backend_acceptance=None, sql_proof=None, frontend_acceptance=None):
    accepted = accepted_evidence(backend_acceptance, sql_proof, frontend_acceptance)
    previous = ops.read(CURRENT)
    require(previous.get('digitalDeliveryApiAccepted') is True and previous['databaseMigrationCount'] == 85, 'Start from accepted D57 API85 only.')
    process = owned_process(previous)
    require(shape() == {'migrationCount': 85, 'tableCount': 222}, 'Prepare requires unchanged Sayman85/222.')
    histories = snapshot()['histories']
    pending_migration(histories)
    compatibility = photo_compatibility()
    require_old_compatible(compatibility)
    aggregate = ops.aggregate_state()
    return {'schemaVersion': 1, 'kind': 'used-photos-api86-plan', 'runId': uuid.uuid4().hex, 'preparedAtUtc': stamp(),
            'accepted': accepted, 'helpers': helper_hashes(), 'previous': previous, 'previousSha256': ops.sha(CURRENT),
            'process': process, 'aggregate': aggregate, 'aggregateSha256': ops.sha(AGGREGATE),
            'frontends': ops.frontend_descriptors(), 'preservedFiles': preserved_files(), 'space': measured_space(),
            'photoCompatibilityBefore': compatibility, 'onlyMigration': MIGRATION,
            'frontendPromotion': 'Root must run prepared min86 frontend publisher after API86; compatible86 recovery only.',
            'rollbackPolicy': SAFE_RECOVERY, 'readOnlyPrepared': True}


def private_copy(source, target):
    require(not target.exists(), 'Private backup destination already exists.')
    if source.is_dir():
        shutil.copytree(source, target)
        for path in (target, *target.rglob('*')):
            path.chmod(0o700 if path.is_dir() else 0o600)
        require(tree(source) == tree(target), 'Private directory backup is not byte-exact.')
    else:
        shutil.copy2(source, target)
        target.chmod(0o600)
        require(ops.sha(source) == ops.sha(target), 'Private file backup is not byte-exact.')


def verified_backup(run_id, preserved):
    require(re.fullmatch('[a-f0-9]{32}', run_id) is not None, 'Invalid owned backup identity.')
    capacity = measured_space()
    directory = ROOT / 'tmp/local-backups' / ('used-photos-' + run_id)
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    private_copy(ROOT / '.env', directory / 'environment.private')
    private_copy(ROOT / 'tmp/identity-keys', directory / 'identity-keys')
    private_copy(ROOT / 'tmp/public-media-local.json', directory / 'public-media-local.private.json')
    private_copy(MEDIA, directory / 'public-media-objects')
    require(preserved_files() == preserved, 'Live private configuration, keys or public objects changed during backup.')
    remote = '/var/opt/mssql/data/used-photos-' + run_id + '.bak'
    sql("BACKUP DATABASE [Sayman] TO DISK=N'" + remote + "' WITH COPY_ONLY,CHECKSUM; RESTORE VERIFYONLY FROM DISK=N'" + remote + "' WITH CHECKSUM;", timeout=180)
    result = subprocess.run(['docker', 'compose', '--profile', 'backend', 'exec', '-T', 'sqlserver', 'sha256sum', remote], cwd=ROOT, capture_output=True, text=True, timeout=30)
    remote_hash = result.stdout.split()[0] if result.stdout.split() else ''
    require(result.returncode == 0 and re.fullmatch('[a-f0-9]{64}', remote_hash), 'SQL backup checksum could not be read.')
    subprocess.run(['docker', 'compose', '--profile', 'backend', 'cp', 'sqlserver:' + remote, str(directory / 'Sayman.bak')], cwd=ROOT, check=True, capture_output=True, timeout=180)
    backup = directory / 'Sayman.bak'
    backup.chmod(0o600)
    require(backup.stat().st_size > 0 and ops.sha(backup) == remote_hash, 'Transferred database backup is not byte-exact.')
    # Only this invocation's SQL backup scratch file; public media is untouched.
    subprocess.run(['docker', 'compose', '--profile', 'backend', 'exec', '-T', 'sqlserver', 'rm', '--', remote], cwd=ROOT, check=True, capture_output=True, timeout=20)
    value = {'passed': True, 'database': 'Sayman', 'privateDirectory': relative(directory), 'backupBytes': backup.stat().st_size,
             'backupSha256': remote_hash, 'localRemoteSha256Equal': True, 'copyOnly': True, 'checksumVerifyOnly': True,
             'privateEnvironmentKeysAndMediaCopied': True, 'publicMediaOriginalsChanged': False, 'measuredCapacity': capacity,
             'offsiteOrRestoreAccepted': False}
    ops.write(directory / 'backup-proof.json', value, private=True)
    return value


def stop_owned(state, expected):
    require(owned_process(state) == expected, 'API ownership changed immediately before stop.')
    os.kill(expected['pid'], signal.SIGTERM)
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        if ops.listener() is None:
            try:
                os.kill(expected['pid'], 0)
            except ProcessLookupError:
                return
        time.sleep(.25)
    raise ops.PublishError('Owned API did not stop completely; no forced termination or migration was attempted.')


def state86(plan, directory, manifest_path, report_path):
    accepted = plan['accepted']
    state = {**plan['previous'], 'sourceMigrationCount': 86, 'databaseMigrationCount': 86, 'tableCount': 223,
            'apiPid': None, 'mainPromoted': True, 'healthCheckPassed': False, 'codeOnly': False, 'newMigrations': 1, 'newTables': 1,
            'runtimeDirectory': relative(directory), 'previousRuntimeDirectory': plan['previous']['runtimeDirectory'],
            'moduleSha256': plan['accepted']['modules'], 'artifactManifest': relative(manifest_path),
            'artifactManifestSha256': ops.sha(manifest_path), 'slice': 'Immutable used-inspection photo gallery',
            'localReleaseEvidence': relative(report_path), 'healthEvidence': relative(report_path),
            'runtimeSet': relative(report_path), 'unitPassed': accepted['unitPassed'],
            'sqlPassed': accepted['fullSqlPassed'], 'fullSqlPassed': accepted['fullSqlPassed'],
            'sqlAcceptanceMode': 'complete-class-batches', 'fullSqlSingleRunPassed': False,
            'usedInspectionPhotosApiAccepted': False, 'usedInspectionPhotosFrontendPromotionPending': True,
            'usedInspectionPhotosMigrationId': MIGRATION, 'oldCodeRollbackRequiresPhotoCompatibilityGuard': True,
            'mainSeedPerformed': False, 'fullProjectComplete': False}
    # A gallery-only acceptance must never inherit/claim the later capacity fix.
    state.pop('physicalFulfillmentCapacityAccepted', None)
    if accepted.get('physicalFulfillmentCapacityAccepted') is True:
        state['physicalFulfillmentCapacityAccepted'] = True
        state['slice'] = 'Immutable used-inspection photo gallery and physical fulfillment capacity'
    state.pop('customerLoginContinuityAccepted', None)
    if accepted.get('customerLoginContinuityAccepted') is True:
        state['customerLoginContinuityAccepted'] = True
        state['slice'] += ' and customer login continuity'
    return state


def start_selected(state, log):
    require(ops.listener() is None, 'An existing listener prevents a second API startup.')
    runtime(state)
    ops.write(CURRENT, state)
    process = ops.start_api(log)
    try:
        ops.wait_ready(process)
        active = ops.read(CURRENT)
        require(owned_process(active)['pid'] == process.pid, 'Started API ownership differs from the selected candidate.')
        return process, active
    except Exception:
        # Readiness failure may precede a listener. The Popen handle identifies
        # our own child even then; stop it before any attempted owned recovery.
        if process.poll() is None:
            try:
                process.terminate()
                process.wait(timeout=15)
            except ProcessLookupError:
                pass
            except subprocess.TimeoutExpired:
                raise OwnedStartupIncomplete('Owned startup child could not stop; its descriptor is retained and no second API will be started.') from None
            except Exception:
                raise OwnedStartupIncomplete('Owned startup termination could not be proved; its descriptor is retained and no second API will be started.') from None
        raise


def recover_api(plan, candidate, report, report_path):
    current_shape = shape()
    compatibility = photo_compatibility()
    report['failurePhotoCompatibility'] = compatibility
    if current_shape == {'migrationCount': 85, 'tableCount': 222}:
        require_old_compatible(compatibility)
        pending_migration(snapshot()['histories'])
        selected = plan['previous']
        report['recovery'] = 'previous85-before-schema-change-only'
    else:
        selected = {**candidate, 'usedInspectionPhotosApiAccepted': False,
                    'usedInspectionPhotosRecoveryRequired': True}
        report['recovery'] = 'compatible86-forward-only'
    present = ops.listener()
    if present is None:
        _, active = start_selected(selected, CHECKS / ('used-photos-' + plan['runId'] + '-recovery.log'))
        report.update(recoveryHealthy=True, recoveryPid=active['apiPid'])
    else:
        active = ops.read(CURRENT)
        require(active['runtimeDirectory'] == selected['runtimeDirectory'] and owned_process(active)['pid'] == present,
                'Foreign listener or descriptor prevents owned recovery; it was preserved.')
        ops.request('/health/ready', 200)
        report.update(recoveryHealthy=True, recoveryPid=present)
        if current_shape['migrationCount'] == 86:
            active.update(usedInspectionPhotosApiAccepted=False, usedInspectionPhotosRecoveryRequired=True)
            ops.write(CURRENT, active)
    report['sqlDowngradedOrRestored'] = False
    if current_shape['migrationCount'] == 86:
        aggregate = ops.read(AGGREGATE)
        require(aggregate == plan['aggregate'] or aggregate.get('componentReleaseEvidence', {}).get('api') == relative(report_path),
                'Unrelated aggregate change was preserved; manual forward reconciliation is required.')
        # Bind failure evidence, rather than retaining a passed85 schema proof
        # beside the recovered86 database. The caller may add diagnostics later.
        ops.write(report_path, report)
        aggregate.update(databaseMigrationCount=86, tableCount=223, updatedAtUtc=stamp())
        aggregate['usedInspectionPhotosRecoveryRequired'] = True
        aggregate['componentReleaseEvidence'] = {**aggregate.get('componentReleaseEvidence', {}), 'api': relative(report_path)}
        aggregate['schemaReleaseEvidence'] = {'path': relative(report_path), 'sha256': ops.sha(report_path)}
        aggregate['lastComponentReleaseEvidence'] = {'path': relative(report_path), 'sha256': ops.sha(report_path)}
        ops.write(AGGREGATE, aggregate)


def apply(plan):
    require(plan['schemaVersion'] == 1 and plan['kind'] == 'used-photos-api86-plan' and re.fullmatch('[a-f0-9]{32}', plan['runId']), 'Invalid prepared publication plan.')
    accepted = plan['accepted']
    selection = accepted['selection']
    def same_acceptance():
        return accepted == accepted_evidence(selection['backendAcceptance'], selection['sqlProof'], selection['frontendAcceptance'])
    require(same_acceptance() and plan['helpers'] == helper_hashes(), 'Accepted source, artifacts, evidence or helpers changed since prepare.')
    require(ops.sha(CURRENT) == plan['previousSha256'] and ops.sha(AGGREGATE) == plan['aggregateSha256']
            and ops.frontend_descriptors() == plan['frontends'] and owned_process(plan['previous']) == plan['process']
            and preserved_files() == plan['preservedFiles'], 'Canonical inputs changed after read-only prepare.')
    require(shape() == {'migrationCount': 85, 'tableCount': 222}, 'Apply requires the prepared85/222database.')
    require_old_compatible(photo_compatibility())
    measured_space()
    directory = ROOT / 'tmp' / ('api-runtime-used-photos-' + plan['runId'])
    require(not directory.exists(), 'Unique candidate runtime already exists; no existing runtime will be overwritten.')
    files = tree(ops.API_BIN)
    shutil.copytree(ops.API_BIN, directory)
    require(tree(directory) == files, 'Candidate API copy is incomplete.')
    manifest_path = CHECKS / (directory.name + '-artifacts.json')
    require(not manifest_path.exists(), 'Candidate artifact manifest already exists.')
    ops.write(manifest_path, {'algorithm': 'SHA-256', 'files': files})
    report_path = CHECKS / ('used-photos-' + plan['runId'] + '-main-release.json')
    candidate = state86(plan, directory, manifest_path, report_path)
    report = {'passed': False, 'startedAtUtc': stamp(), 'runId': plan['runId'], 'database': 'Sayman',
              'runtimeDirectory': relative(directory), 'migration': MIGRATION, 'newMigrations': 1, 'newTables': 1,
              'frontendPromotionPerformed': False, 'frontendPromotionPending': True, 'rollbackPolicy': SAFE_RECOVERY,
              'mainSeedPerformed': False, 'providerActivated': False, 'fullProjectComplete': False}
    report['backendAcceptance'] = {'path': selection['backendAcceptance'], 'sha256': accepted['files'][selection['backendAcceptance']]}
    report['sqlProof'] = {'path': selection['sqlProof'], 'sha256': accepted['files'][selection['sqlProof']]}
    report['frontendAcceptance'] = {'path': selection['frontendAcceptance'], 'sha256': accepted['files'][selection['frontendAcceptance']]}
    report['frozen'] = accepted['frozenRecord']
    if accepted.get('physicalFulfillmentCapacityAccepted') is True:
        report['physicalFulfillmentCapacityAccepted'] = True
    if accepted.get('customerLoginContinuityAccepted') is True:
        report['customerLoginContinuityAccepted'] = True
    require(not report_path.exists(), 'Release report already exists.')
    stop_requested = False
    try:
        ops.write(report_path, report)
        stop_requested = True
        stop_owned(plan['previous'], plan['process'])
        before = database_snapshot()
        pending_migration(before['histories'])
        before_path = CHECKS / ('used-photos-' + plan['runId'] + '-stopped-before.json')
        ops.write(before_path, before, private=True)
        report['backup'] = verified_backup(plan['runId'], plan['preservedFiles'])
        report['beforeSnapshot'] = {'path': relative(before_path), 'sha256': ops.sha(before_path)}
        ops.write(report_path, report)
        require(same_acceptance() and preserved_files() == plan['preservedFiles'], 'Inputs changed during stopped backup.')
        migration_log = CHECKS / ('used-photos-' + plan['runId'] + '-migration.log')
        environment = api_environment()
        environment['DOTNET_TieredPGO'] = '0'
        # The frozen source/histories prove exactly one pending Catalog entry;
        # --migrate is the existing no-seed API migration entry point.
        with migration_log.open('xb') as stream:
            os.fchmod(stream.fileno(), 0o600)
            subprocess.run(['dotnet', str(directory / 'Shop.Api.dll'), '--migrate'], cwd=ROOT, env=environment,
                           stdout=stream, stderr=subprocess.STDOUT, timeout=180, check=True)
        after = database_snapshot()
        after_path = CHECKS / ('used-photos-' + plan['runId'] + '-stopped-after.json')
        ops.write(after_path, after, private=True)
        preserved_database(before, after)
        require(shape() == {'migrationCount': 86, 'tableCount': 223} and preserved_files() == plan['preservedFiles'], 'Post-migration shape/private files differ.')
        report.update(old222DataAndMetadataPreservedAtStoppedCutover=True,
                      afterSnapshot={'path': relative(after_path), 'sha256': ops.sha(after_path)}, migrationLogSha256=ops.sha(migration_log))
        _, active = start_selected(candidate, CHECKS / ('used-photos-' + plan['runId'] + '-api.log'))
        checks = []
        for path, status in [('/health/live', 200), ('/api/storefront/fa?metadataOnly=true', 200),
                             ('/api/storefront/en?metadataOnly=true', 200), ('/api/auth/me', 401), ('/api/admin/staff', 401)]:
            checked, _ = ops.request(path, status, require_no_store=not path.startswith('/api/storefront/'))
            checks.append(checked)
        preserve_existing_files(plan['preservedFiles'], preserved_files())
        require(ops.frontend_descriptors() == plan['frontends'], 'Untouched frontend descriptors changed.')
        require(shape() == {'migrationCount': 86, 'tableCount': 223}, 'API startup changed the expected schema.')
        active.update(healthCheckPassed=True, promotedAtUtc=stamp(), usedInspectionPhotosApiAccepted=True)
        ops.write(CURRENT, active)
        require(ops.sha(AGGREGATE) == plan['aggregateSha256'], 'An unrelated aggregate change prevents this publication commit.')
        report.update(passed=True, apiPid=active['apiPid'], completedAtUtc=stamp(), unitPassed=accepted['unitPassed'],
                      fullSqlPassed=accepted['fullSqlPassed'], targetedSqlPassed=accepted['targetedSqlPassed'],
                      databaseMigrationCount=86, tableCount=223, sqlDowngradedOrRestored=False, httpChecks=checks)
        ops.write(report_path, report)
        aggregate = {**plan['aggregate'], 'databaseMigrationCount': 86, 'tableCount': 223, 'updatedAtUtc': stamp()}
        aggregate['componentReleaseEvidence'] = {**aggregate.get('componentReleaseEvidence', {}), 'api': relative(report_path)}
        aggregate['schemaReleaseEvidence'] = {'path': relative(report_path), 'sha256': ops.sha(report_path)}
        aggregate['lastComponentReleaseEvidence'] = {'path': relative(report_path), 'sha256': ops.sha(report_path)}
        ops.write(AGGREGATE, aggregate)
        return report
    except Exception as error:
        report.update(passed=False, failureType=type(error).__name__, failedAtUtc=stamp())
        if isinstance(error, OwnedStartupIncomplete):
            report.update(recoveryIncomplete=True, recoveryFailureType=type(error).__name__,
                          sqlDowngradedOrRestored=False, recovery='selected-compatible-artifact-retained-no-second-start')
        elif stop_requested:
            try:
                recover_api(plan, candidate, report, report_path)
            except Exception as recovery:
                report.update(recoveryIncomplete=True, recoveryFailureType=type(recovery).__name__)
        ops.write(report_path, report)
        raise


def recover_compatible_frontend(name, current, candidate, process, start, check, write, sleep=time.sleep):
    """Used by the generic min86 publisher; never selects an old UI artifact."""
    recovery = {'passed': False, 'compatibleCandidateRetained': True, 'recoveryAttempted': True, 'recoveryHealthy': False}
    if process is not None and process.poll() is None:
        process.terminate()
        process.wait(timeout=15)
    write(current, candidate)
    process = start(name)
    recovery['recoveryPid'] = process.pid
    for attempt in range(40):
        try:
            recovery['httpChecks'] = check(name, candidate)
            recovery.update(passed=True, recoveryHealthy=True, pid=process.pid,
                            runtimeDirectory=candidate['runtimeDirectory'])
            return recovery
        except Exception:
            if process.poll() is not None or attempt == 39:
                raise ops.PublishError('Compatible frontend recovery is unhealthy; keep its candidate descriptor and recover forward.') from None
            sleep(.25)
    raise ops.PublishError('Compatible frontend recovery did not finish.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', nargs='?', default='prepare', choices=('prepare', 'apply', 'rollback-check'))
    parser.add_argument('--plan-file', help='Workspace-relative artifacts/checks JSON; new on prepare, required existing plan on apply.')
    parser.add_argument('--backend-acceptance', help='Accepted backend JSON under artifacts/checks; defaults to used-photos-backend/acceptance.json on prepare.')
    parser.add_argument('--sql-proof', help='Full SQL proof JSON under artifacts/checks; defaults to used-photos-sql/proof.json on prepare.')
    parser.add_argument('--frontend-acceptance', help='Frontend quality acceptance JSON under artifacts/checks; defaults to used-inspection-photos-frontend/acceptance.json on prepare.')
    args = parser.parse_args()
    plan_path = evidence_path(args.plan_file) if args.plan_file else None
    with (ROOT / 'tmp/public-media-backend-publish.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.mode == 'rollback-check':
            require(not args.backend_acceptance and not args.sql_proof and not args.frontend_acceptance, 'Rollback inspection does not select release evidence.')
            value = photo_compatibility()
            print(json.dumps(value))
            return 0 if value['oldCodeCompatible'] else 1
        if args.mode == 'prepare':
            plan = prepare(args.backend_acceptance, args.sql_proof, args.frontend_acceptance)
            if plan_path is not None:
                require(not plan_path.exists(), 'Read-only prepare never overwrites an existing plan.')
                ops.write(plan_path, plan, private=True)
            print(json.dumps({'prepared': True, 'readOnly': True, 'planFile': relative(plan_path) if plan_path else None,
                              'requiredFreeBytes': plan['space']['requiredHostFreeBytes'], 'freeBytes': plan['space']['hostFreeBytes'],
                              'migration': MIGRATION, 'limitation': SAFE_RECOVERY}))
            return 0
        require(plan_path is not None, 'Explicit apply requires the exact prepared --plan-file.')
        plan = ops.read(plan_path)
        selection = plan['accepted']['selection']
        require((not args.backend_acceptance or evidence_selection(args.backend_acceptance)['backendAcceptance'] == selection['backendAcceptance'])
                and (not args.sql_proof or evidence_selection(sql_proof=args.sql_proof)['sqlProof'] == selection['sqlProof'])
                and (not args.frontend_acceptance or evidence_selection(frontend_acceptance=args.frontend_acceptance)['frontendAcceptance'] == selection['frontendAcceptance']),
                'Apply evidence selection differs from the exact prepared plan.')
        report = apply(plan)
        try:
            print(json.dumps({'passed': report['passed'], 'runtimeDirectory': report['runtimeDirectory'],
                              'databaseMigrationCount': 86, 'frontendPromotionPending': True}), flush=True)
        except (OSError, ValueError):
            pass
        return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({'passed': False, 'failureType': type(error).__name__,
                          'message': str(error) if isinstance(error, ops.PublishError) else 'Publication failed; private configuration and SQL details are omitted.'}))
        raise SystemExit(1) from None
