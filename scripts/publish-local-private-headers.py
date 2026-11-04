"""Guarded code-only API86 private-admin-header publication.

Prepare only reads local evidence/runtime/SQL and optionally writes a new plan.
Explicit apply replaces the API package without migrations, seeds, restores or
frontend changes. Recovery can select only the exact previously selected API86.
This module is import-safe; offline tests must mock every live boundary.
"""
from datetime import datetime, timezone
from pathlib import Path
import argparse
import fcntl
import hashlib
import importlib.util
import json
import re
import shutil
import uuid
from urllib.error import HTTPError


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


photo = load('private_header_photo_primitives', 'publish_local_used_photos.py')
verifier = load('private_header_manifest_verifier', 'verify-local-business-release.py')
ops = photo.ops
ROOT, CHECKS, CURRENT, AGGREGATE = photo.ROOT, photo.CHECKS, photo.CURRENT, photo.AGGREGATE
FRONTEND = 'artifacts/checks/business-continuity-frontend/acceptance.json'
KIND = 'private-admin-headers-api86-plan'
POLICY = 'Code-only; recover only the previously selected compatible86 API. Never Down, restore SQL, select85 or replace frontends.'
API_FLAGS = ('digitalDeliveryApiAccepted', 'usedInspectionPhotosApiAccepted',
             'physicalFulfillmentCapacityAccepted', 'customerLoginContinuityAccepted')
PRIVATE_PATHS = ('/api/admin/used-items/variants', '/api/admin/used-items/11111111111111111111111111111111')


def require(value, message):
    photo.require(value, message)


def stamp():
    return datetime.now(timezone.utc).isoformat()


def require_api86(state):
    require(state.get('api') == 'http://127.0.0.1:5080'
            and state.get('sourceMigrationCount') == state.get('databaseMigrationCount') == 86
            and state.get('tableCount') == 223 and all(state.get(key) is True for key in API_FLAGS)
            and state.get('usedInspectionPhotosFrontendPromotionPending') is False
            and state.get('usedInspectionPhotosMigrationId') == photo.MIGRATION,
            'A finalized compatible86/223 API with all accepted business features is required.')


def accepted_evidence(backend_acceptance, sql_proof, frontend_acceptance=FRONTEND):
    require(backend_acceptance and sql_proof, 'Select explicit fresh backend acceptance and complete SQL proof paths.')
    accepted = photo.accepted_evidence(backend_acceptance, sql_proof, frontend_acceptance)
    path = photo.evidence_path(accepted['selection']['backendAcceptance'])
    require(ops.sha(path) == accepted['files'][photo.relative(path)], 'Selected backend acceptance changed during verification.')
    record = ops.read(path)
    require(record.get('privateAdminHeadersAccepted') is True
            and accepted.get('physicalFulfillmentCapacityAccepted') is True
            and accepted.get('customerLoginContinuityAccepted') is True,
            'Fresh acceptance must explicitly accept private headers, capacity and customer login continuity.')
    accepted['privateAdminHeadersAccepted'] = True
    return accepted


def helper_hashes():
    values = photo.helper_hashes()
    for name in ('publish-local-private-headers.py', 'test_publish_local_private_headers.py',
                 'verify-local-business-release.py', 'test_verify_local_business_release.py',
                 'test_sql_batches.py', 'test-sql-local.py', 'verify-sql-test-cleanup.py'):
        path = ROOT / 'scripts' / name
        values[photo.relative(path)] = ops.sha(path)
    return values


def finalized_frontends():
    result = {}
    for name in ('storefront', 'admin'):
        path = ROOT / 'tmp' / (name + '-runtime-current.json')
        state = ops.read(path)
        require(state.get('sourceMigrationCount') == state.get('databaseMigrationCount') == 86
                and state.get('tableCount') == 223 and state.get('usedInspectionPhotosFrontendAccepted') is True,
                'Both unchanged frontends must already be finalized for API86/223.')
        _, _, proof = verifier.manifest(state, name)
        result[name] = {'descriptorSha256': ops.sha(path), 'artifact': proof}
    return result


def schema_evidence(aggregate):
    """Retain the migration85 backup chain; this code-only release makes none."""
    original = aggregate.get('schemaReleaseEvidence', {})
    path = photo.evidence_path(original['path'])
    require(ops.sha(path) == original['sha256'], 'The original schema-release proof changed.')
    record = ops.read(path)
    backup = record.get('backup', {})
    require(record.get('passed') is True and record.get('databaseMigrationCount') == 86
            and record.get('tableCount') == 223 and record.get('migration') == photo.MIGRATION
            and backup.get('passed') is True and backup.get('database') == 'Sayman'
            and all(backup.get(key) is True for key in ('copyOnly', 'checksumVerifyOnly', 'localRemoteSha256Equal',
                                                       'privateEnvironmentKeysAndMediaCopied')),
            'The existing verified migration backup evidence is required; no new backup is claimed.')
    directory = ops.relative_path(backup['privateDirectory'], ROOT / 'tmp/local-backups')
    require(ops.sha(directory / 'Sayman.bak') == backup['backupSha256']
            and (directory / 'Sayman.bak').stat().st_size == backup['backupBytes']
            and ops.read(directory / 'backup-proof.json') == backup,
            'The original migration backup or its private proof changed.')
    files = {photo.relative(path): ops.sha(path), photo.relative(directory / 'Sayman.bak'): backup['backupSha256'],
             photo.relative(directory / 'backup-proof.json'): ops.sha(directory / 'backup-proof.json')}
    for key in ('beforeSnapshot', 'afterSnapshot'):
        bound = photo.evidence_path(record[key]['path'])
        require(ops.sha(bound) == record[key]['sha256'], 'Original migration snapshot evidence changed.')
        files[photo.relative(bound)] = ops.sha(bound)
    final = photo.evidence_path(aggregate['usedInspectionPhotosFinalizationEvidence'])
    files[photo.relative(final)] = ops.sha(final)
    return {'schemaReleaseEvidence': original, 'files': files, 'originalBackupSchema': 85,
            'newBackupCreated': False, 'newRestoreAcceptanceClaimed': False}


def finalized_aggregate(previous):
    value = ops.read(AGGREGATE)
    require(value.get('database') == 'Sayman' and value.get('sourceMigrationCount') == value.get('databaseMigrationCount') == 86
            and value.get('tableCount') == 223 and value.get('apiDescriptor') == 'tmp/api-runtime-current.json'
            and value.get('canonicalUrls') == {'storefront': 'http://127.0.0.1:3000', 'api': 'http://127.0.0.1:5080', 'admin': 'http://127.0.0.1:3173'}
            and all(value.get(key) is True for key in ('usedInspectionPhotosAccepted', 'physicalFulfillmentCapacityAccepted', 'customerLoginContinuityAccepted'))
            and value.get('componentReleaseEvidence', {}).get('api') == previous['localReleaseEvidence'],
            'The aggregate must describe the finalized canonical86 release.')
    return value


def package_delta(previous, accepted):
    old = photo.runtime(previous)
    require(set(previous['moduleSha256']) == set(accepted['modules']) and len(accepted['modules']) == 14,
            'The exact accepted14product module identities must be preserved.')
    changed = {name for name, value in accepted['modules'].items() if previous['moduleSha256'][name] != value}
    require(changed == {'Shop.Api.dll'}, 'Only Shop.Api.dll may differ among the14product modules.')
    before, after = photo.tree(old), photo.tree(ops.API_BIN)
    delta = {name for name in set(before) | set(after) if before.get(name) != after.get(name)}
    require(set(before) == set(after) and delta <= {'Shop.Api.dll', 'Shop.Api.pdb'} and 'Shop.Api.dll' in delta,
            'Only existing Shop.Api.dll/Shop.Api.pdb bytes may change in the complete API package.')
    require(all(after.get(name) == value for name, value in accepted['modules'].items()), 'Candidate package differs from accepted14module hashes.')
    return {'files': after, 'changedFiles': sorted(delta)}


def table_map(rows, expected, label):
    result = {(row['schema'], row['table']): row for row in rows}
    require(len(rows) == len(result) == expected, label + ' must cover each of the223tables exactly once.')
    return result


def valid_snapshot(value):
    require(value.get('database') == 'Sayman', 'Unexpected snapshot database.')
    table_map(value['tables'], 223, 'Business snapshot')
    table_map(value['metadata'], 223, 'Metadata snapshot')
    identities = {(row['schema'], row['MigrationId']) for row in value['histories']}
    require(len(value['histories']) == len(identities) == 86 and identities == photo.source_migrations(),
            'All86migration histories must exactly match the frozen source.')


def unchanged_database(before, after):
    valid_snapshot(before)
    valid_snapshot(after)
    require(table_map(before['tables'], 223, 'Before rows') == table_map(after['tables'], 223, 'After rows')
            and table_map(before['metadata'], 223, 'Before metadata') == table_map(after['metadata'], 223, 'After metadata')
            and sorted(before['histories'], key=lambda row: (row['schema'], row['MigrationId'])) == sorted(after['histories'], key=lambda row: (row['schema'], row['MigrationId']))
            and before['configuration'] == after['configuration'],
            'All223table data/metadata,86histories and private configuration must remain byte-exact; no exclusions apply.')


def prepare(backend_acceptance, sql_proof, frontend_acceptance=FRONTEND):
    accepted = accepted_evidence(backend_acceptance, sql_proof, frontend_acceptance)
    previous = ops.read(CURRENT)
    require_api86(previous)
    process = photo.owned_process(previous)
    require(photo.shape() == {'migrationCount': 86, 'tableCount': 223}, 'Only existing Sayman86/223 is supported.')
    photo.source_migrations()
    aggregate = finalized_aggregate(previous)
    return {'schemaVersion': 1, 'kind': KIND, 'runId': uuid.uuid4().hex, 'preparedAtUtc': stamp(),
            'accepted': accepted, 'helpers': helper_hashes(), 'previous': previous, 'previousSha256': ops.sha(CURRENT),
            'process': process, 'aggregate': aggregate, 'aggregateSha256': ops.sha(AGGREGATE),
            'frontends': finalized_frontends(), 'preservedFiles': photo.preserved_files(),
            'schemaEvidence': schema_evidence(aggregate), 'package': package_delta(previous, accepted),
            'codeOnly': True, 'newMigrations': 0, 'newTables': 0, 'newBackupCreated': False,
            'rollbackPolicy': POLICY, 'readOnlyPrepared': True}


def state86(plan, directory, manifest, report_path):
    require_api86(plan['previous'])
    accepted = plan['accepted']
    require(accepted.get('privateAdminHeadersAccepted') is True, 'Private-header acceptance must be explicit.')
    return {**plan['previous'], 'runtimeDirectory': photo.relative(directory),
            'previousRuntimeDirectory': plan['previous']['runtimeDirectory'], 'apiPid': None,
            'artifactManifest': photo.relative(manifest), 'artifactManifestSha256': ops.sha(manifest),
            'moduleSha256': accepted['modules'], 'slice': 'Private admin used-item response headers',
            'localReleaseEvidence': photo.relative(report_path), 'healthEvidence': photo.relative(report_path),
            'runtimeSet': photo.relative(report_path), 'codeOnly': True, 'newMigrations': 0, 'newTables': 0,
            'newBackupCreated': False, 'mainSeedPerformed': False, 'healthCheckPassed': False, 'privateAdminHeadersAccepted': False,
            'usedInspectionPhotosFrontendPromotionPending': False, 'unitPassed': accepted['unitPassed'],
            'sqlPassed': accepted['fullSqlPassed'], 'fullSqlPassed': accepted['fullSqlPassed'],
            'sqlAcceptanceMode': 'complete-class-batches', 'fullSqlSingleRunPassed': False, 'fullProjectComplete': False}


def private_headers(headers):
    values = {name.lower(): value.lower() for name, value in headers.items()}
    controls = {part.strip() for part in values.get('cache-control', '').split(',')}
    require({'private', 'no-store'} <= controls and 'noindex' in {part.strip() for part in values.get('x-robots-tag', '').split(',')}
            and values.get('x-content-type-options') == 'nosniff',
            'A raw private401 must include Cache-Control private/no-store, X-Robots-Tag noindex and nosniff.')
    return {name: values.get(name, '') for name in ('cache-control', 'x-robots-tag', 'x-content-type-options')}


def raw_private(path):
    require(path in PRIVATE_PATHS, 'Only the two fixed anonymous private-admin GET probes are permitted.')
    try:
        response = ops.HTTP.open('http://127.0.0.1:5080' + path, timeout=10)
    except HTTPError as error:
        response = error
    with response:
        require(response.status == 401, 'Raw private-admin probe must return401.')
        headers = private_headers(dict(response.headers.items()))
        body = response.read(65537)
        require(len(body) <= 65536, 'Private error response exceeded its inspection bound.')
        return {'path': path, 'status': response.status, 'headers': headers, 'bodySha256': hashlib.sha256(body).hexdigest()}


def smoke():
    checks = []
    for path in ('/health/ready', '/health/live', '/api/storefront/fa?metadataOnly=true', '/api/storefront/en?metadataOnly=true'):
        value, body = ops.request(path, 200, require_no_store=not path.startswith('/api/storefront/'))
        checks.append({**value, 'bodySha256': hashlib.sha256(body).hexdigest()})
    return checks + [raw_private(path) for path in PRIVATE_PATHS]


def aggregate_for(plan, report_path):
    # Never replace the immutable85->86 migration/backup/finalization chain.
    return {**plan['aggregate'], 'updatedAtUtc': stamp(), 'privateAdminHeadersAccepted': True,
            'componentReleaseEvidence': {**plan['aggregate']['componentReleaseEvidence'], 'api': photo.relative(report_path)},
            'lastComponentReleaseEvidence': {'path': photo.relative(report_path), 'sha256': ops.sha(report_path)}}


def recover_previous86(plan, candidate, report, report_path, candidate_process=None):
    previous = plan['previous']
    require_api86(previous)
    require(photo.shape() == {'migrationCount': 86, 'tableCount': 223}, 'Unexpected schema; no downgrade/restore is available.')
    current = ops.read(CURRENT)
    require(current.get('runtimeDirectory') in (previous['runtimeDirectory'], candidate['runtimeDirectory']),
            'A foreign descriptor was preserved; manual compatible86 recovery is required.')
    present = ops.listener()
    if present is not None:
        identity = photo.owned_process(current)
        if current['runtimeDirectory'] == previous['runtimeDirectory']:
            require(identity == plan['process'], 'The previous API process identity changed; it was preserved.')
            ops.request('/health/ready', 200)
            report.update(recoveryHealthy=True, recoveryPid=present, recovery='previous-compatible86-still-running')
            return
        require(candidate_process is not None and identity == candidate_process,
                'The listener is not the exact child started by this publication; it was preserved.')
        photo.stop_owned(current, identity)
    # Recheck before writing the descriptor. start_selected also refuses a listener.
    require(ops.listener() is None, 'A foreign listener prevents recovery and was preserved.')
    require(ops.read(CURRENT) == current, 'An unrelated descriptor change was preserved before recovery startup.')
    _, active = photo.start_selected(previous, CHECKS / ('private-headers-' + plan['runId'] + '-recovery.log'))
    report.update(recoveryHealthy=True, recoveryPid=active['apiPid'], recovery='previous-compatible86-only',
                  recoveryRuntimeDirectory=previous['runtimeDirectory'], sqlDowngradedOrRestored=False)


def reconcile_failed_aggregate(plan, report_path):
    present = ops.read(AGGREGATE)
    if present == plan['aggregate']:
        return
    # Only an aggregate written by this invocation may be rolled back. Preserve
    # an unrelated component release even when that needs manual reconciliation.
    require(present.get('componentReleaseEvidence', {}).get('api') == photo.relative(report_path)
            and present.get('schemaReleaseEvidence') == plan['aggregate']['schemaReleaseEvidence']
            and {key: value for key, value in present.get('componentReleaseEvidence', {}).items() if key != 'api'}
            == {key: value for key, value in plan['aggregate']['componentReleaseEvidence'].items() if key != 'api'},
            'An unrelated aggregate change was preserved; manual reconciliation is required.')
    ops.write(AGGREGATE, plan['aggregate'])


def validate_plan(plan):
    require(plan.get('schemaVersion') == 1 and plan.get('kind') == KIND and re.fullmatch('[a-f0-9]{32}', plan.get('runId', '')),
            'Invalid prepared private-header publication plan.')
    require_api86(plan['previous'])
    selection = plan['accepted']['selection']
    require(accepted_evidence(selection['backendAcceptance'], selection['sqlProof'], selection['frontendAcceptance']) == plan['accepted']
            and helper_hashes() == plan['helpers'], 'Accepted source, evidence, artifacts or helper code changed since prepare.')
    require(ops.sha(CURRENT) == plan['previousSha256'] and ops.read(CURRENT) == plan['previous']
            and ops.sha(AGGREGATE) == plan['aggregateSha256'] and finalized_aggregate(plan['previous']) == plan['aggregate']
            and finalized_frontends() == plan['frontends'] and photo.preserved_files() == plan['preservedFiles']
            and schema_evidence(plan['aggregate']) == plan['schemaEvidence']
            and package_delta(plan['previous'], plan['accepted']) == plan['package']
            and photo.owned_process(plan['previous']) == plan['process']
            and photo.shape() == {'migrationCount': 86, 'tableCount': 223}, 'Canonical inputs changed after read-only prepare.')


def apply(plan):
    validate_plan(plan)
    directory = ROOT / 'tmp' / ('api-runtime-private-headers-' + plan['runId'])
    manifest = CHECKS / (directory.name + '-artifacts.json')
    report_path = CHECKS / ('private-headers-' + plan['runId'] + '-main-release.json')
    require(not any(path.exists() for path in (directory, manifest, report_path)), 'Unique publication artifacts already exist; nothing will be overwritten.')
    shutil.copytree(ops.API_BIN, directory)
    require(photo.tree(directory) == plan['package']['files'], 'Candidate API copy is incomplete.')
    ops.write(manifest, {'algorithm': 'SHA-256', 'files': plan['package']['files']})
    candidate = state86(plan, directory, manifest, report_path)
    accepted = plan['accepted']
    report = {'passed': False, 'runId': plan['runId'], 'startedAtUtc': stamp(), 'database': 'Sayman',
              'runtimeDirectory': photo.relative(directory), 'previousRuntimeDirectory': plan['previous']['runtimeDirectory'],
              'codeOnly': True, 'newMigrations': 0, 'newTables': 0, 'newBackupCreated': False,
              'schemaReleaseEvidence': plan['schemaEvidence']['schemaReleaseEvidence'], 'schemaBackupRetained': True,
              'accepted': accepted, 'helpers': plan['helpers'], 'frozen': accepted['frozenRecord'],
              'backendAcceptance': {'path': accepted['selection']['backendAcceptance'], 'sha256': accepted['files'][accepted['selection']['backendAcceptance']]},
              'sqlProof': {'path': accepted['selection']['sqlProof'], 'sha256': accepted['files'][accepted['selection']['sqlProof']]},
              'frontendPromotionPerformed': False, 'frontendPromotionPending': False, 'rollbackPolicy': POLICY,
              'mainSeedPerformed': False, 'providerActivated': False, 'sqlDowngradedOrRestored': False, 'fullProjectComplete': False}
    stop_requested, candidate_process = False, None
    try:
        ops.write(report_path, report)
        # The copy can take time; repeat the full prepare boundary before stop.
        validate_plan(plan)
        stop_requested = True
        photo.stop_owned(plan['previous'], plan['process'])
        before = photo.database_snapshot()
        valid_snapshot(before)
        before_path = CHECKS / ('private-headers-' + plan['runId'] + '-stopped-before.json')
        ops.write(before_path, before, private=True)
        report['beforeSnapshot'] = {'path': photo.relative(before_path), 'sha256': ops.sha(before_path)}
        require(photo.preserved_files() == plan['preservedFiles'] and finalized_frontends() == plan['frontends'], 'Private files, media or frontends changed during stopped cutover.')
        process, active = photo.start_selected(candidate, CHECKS / ('private-headers-' + plan['runId'] + '-api.log'))
        candidate_process = photo.owned_process(active)
        require(candidate_process['pid'] == process.pid, 'The candidate listener differs from the child started by this publication.')
        report['candidateProcess'] = candidate_process
        checks = smoke()
        after = photo.database_snapshot()
        after_path = CHECKS / ('private-headers-' + plan['runId'] + '-started-after.json')
        ops.write(after_path, after, private=True)
        report['afterSnapshot'] = {'path': photo.relative(after_path), 'sha256': ops.sha(after_path)}
        unchanged_database(before, after)
        require(photo.preserved_files() == plan['preservedFiles'] and finalized_frontends() == plan['frontends']
                and schema_evidence(plan['aggregate']) == plan['schemaEvidence']
                and photo.shape() == {'migrationCount': 86, 'tableCount': 223}, 'Unchanged configuration/media/frontends/schema evidence no longer matches.')
        selection = accepted['selection']
        require(accepted_evidence(selection['backendAcceptance'], selection['sqlProof'], selection['frontendAcceptance']) == accepted
                and helper_hashes() == plan['helpers'], 'Publication inputs changed during startup.')
        require(photo.owned_process(active)['pid'] == active['apiPid'] and ops.read(CURRENT) == active
                and ops.sha(AGGREGATE) == plan['aggregateSha256'], 'An unrelated descriptor or aggregate change prevents commit.')
        active.update(healthCheckPassed=True, promotedAtUtc=stamp(), privateAdminHeadersAccepted=True)
        ops.write(CURRENT, active)
        report.update(passed=True, completedAtUtc=stamp(), apiPid=active['apiPid'], privateAdminHeadersAccepted=True,
                      physicalFulfillmentCapacityAccepted=True, customerLoginContinuityAccepted=True,
                      all223DataAndMetadataPreserved=True, all86HistoriesPreserved=True, httpChecks=checks,
                      databaseMigrationCount=86, tableCount=223, unitPassed=accepted['unitPassed'],
                      targetedSqlPassed=accepted['targetedSqlPassed'], fullSqlPassed=accepted['fullSqlPassed'])
        ops.write(report_path, report)
        ops.write(AGGREGATE, aggregate_for(plan, report_path))
        return report
    except Exception as error:
        report.update(passed=False, failureType=type(error).__name__, failedAtUtc=stamp())
        if isinstance(error, photo.OwnedStartupIncomplete):
            report.update(recoveryIncomplete=True, recovery='owned-startup-incomplete-no-second-start')
        elif stop_requested:
            try:
                recover_previous86(plan, candidate, report, report_path, candidate_process)
                reconcile_failed_aggregate(plan, report_path)
            except Exception as recovery:
                report.update(recoveryIncomplete=True, recoveryFailureType=type(recovery).__name__)
        ops.write(report_path, report)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', nargs='?', default='prepare', choices=('prepare', 'apply'))
    parser.add_argument('--plan-file', help='New prepare plan or exact existing apply plan under artifacts/checks.')
    parser.add_argument('--backend-acceptance', help='Explicit fresh backend acceptance under artifacts/checks; required on prepare.')
    parser.add_argument('--sql-proof', help='Explicit complete SQL proof under artifacts/checks; required on prepare.')
    parser.add_argument('--frontend-acceptance', help='Unchanged accepted frontend evidence under artifacts/checks.')
    args = parser.parse_args()
    path = photo.evidence_path(args.plan_file) if args.plan_file else None
    with (ROOT / 'tmp/public-media-backend-publish.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.mode == 'prepare':
            require(path is None or not path.exists(), 'Prepare never overwrites a plan.')
            plan = prepare(args.backend_acceptance, args.sql_proof, args.frontend_acceptance or FRONTEND)
            if path is not None:
                ops.write(path, plan, private=True)
            print(json.dumps({'prepared': True, 'readOnly': True, 'planFile': photo.relative(path) if path else None,
                              'newMigrations': 0, 'newTables': 0, 'newBackupCreated': False, 'rollbackPolicy': POLICY}))
            return 0
        require(path is not None, 'Explicit apply requires the exact prepared --plan-file.')
        plan = ops.read(path)
        for argument, key in ((args.backend_acceptance, 'backendAcceptance'), (args.sql_proof, 'sqlProof'), (args.frontend_acceptance, 'frontendAcceptance')):
            require(not argument or photo.relative(photo.evidence_path(argument)) == plan['accepted']['selection'][key],
                    'Apply evidence selection differs from the prepared plan.')
        report = apply(plan)
        # A closed output pipe after commit must not trigger runtime recovery.
        try:
            print(json.dumps({'passed': report['passed'], 'runtimeDirectory': report['runtimeDirectory'], 'newMigrations': 0}), flush=True)
        except (OSError, ValueError):
            pass
        return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({'passed': False, 'failureType': type(error).__name__,
                          'message': str(error) if isinstance(error, ops.PublishError) else 'Publication failed; private configuration and SQL details omitted.'}))
        raise SystemExit(1) from None
