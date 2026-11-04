"""Publish the accepted CMS identity code to the existing API88, without SQL writes.

Imports are inert. Prepare packages immutable offline bytes; apply only stops
the precisely selected API process. The two frontends, schema, policies, keys,
media and all229tables are retained. Recovery selects only that prior API88.
The explicit, separately executed Development example CLI is not part of this
publisher and is never invoked by it.
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


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


rma = load('store_identity_existing88', 'publish-local-commerce-rma.py')
ops, photo, runner = rma.ops, rma.photo, rma.runner
ROOT, CHECKS = rma.ROOT, rma.CHECKS
CURRENT, AGGREGATE = rma.DESCRIPTORS['api'], rma.AGGREGATE
BASELINE = CHECKS / 'commerce-rma-backend/round4/frozen-inputs.json'
ACCEPTANCE = CHECKS / 'store-identity-backend/acceptance.json'
KIND = 'store-identity-api88-code-only'
ALLOWED = {
    'backend/src/Shop.Api/Program.cs',
    'backend/src/Shop.Api/Development/DevelopmentStoreIdentitySeed.cs',
    'backend/src/Shop.Modules.Cms/Persistence/Content.cs',
    'backend/src/Shop.Modules.Cms/Services/CmsImageReferences.cs',
    'backend/src/Shop.Modules.Cms/Domain/StoreIdentityRules.cs',
    'backend/tests/Shop.Tests/StoreIdentityTests.cs',
    'backend/tests/Shop.SqlTests/StoreIdentitySqlTests.cs',
    'backend/tests/Shop.SqlTests/DevelopmentStoreIdentitySqlTests.cs',
}
SQL_CLASSES = {'Shop.SqlTests.' + name for name in (
    'StoreIdentitySqlTests', 'DevelopmentStoreIdentitySqlTests', 'CmsAppearanceSqlTests',
    'CmsReadyReferenceSqlTests', 'CmsPurchaseDependencySqlTests', 'CustomerLoginContinuitySqlTests',
    'DevelopmentNavigationSqlTests', 'SupportContentSqlTests', 'CommerceSqlTests')}


def require(condition, message): ops.require(condition, message)
def stamp(): return datetime.now(timezone.utc).isoformat()
def relative(path): return str(path.relative_to(ROOT))


def compatible88(state):
    pending = state.get('policyConfigurationPending')
    require(state.get('api') == 'http://127.0.0.1:5080'
            and state.get('sourceMigrationCount') == state.get('databaseMigrationCount') == 88
            and state.get('tableCount') == 229 and state.get('commerceRmaAccepted') is True
            and state.get('commerceRmaPolicyConfigured') is True
            and isinstance(pending, dict) and all(pending.get(key) is False for key in (
                'shippingTaxPolicy', 'reservationAndOpenOrderSettings', 'returnRequestPolicy'))
            and state.get('commerceRmaRecoveryRequired') is False,
            'The finalized canonical88/229 API and configured policies are required.')


def helpers():
    values = rma.helper_hashes()
    for name in ('publish-local-store-identity.py', 'test_publish_local_store_identity.py', 'serve-main-api.py'):
        path = ROOT / 'scripts' / name; values[relative(path)] = ops.sha(path)
    return values


def acceptance():
    accepted = ops.read(ACCEPTANCE)
    require(accepted.get('passed') is True and accepted.get('schemaChanges') == 0,
            'Fresh accepted backend evidence is required.')
    frozen = runner.freeze('Debug')
    require(frozen == accepted['frozen'], 'Accepted source, test binaries or14module parity changed.')
    old = ops.read(BASELINE)['sourceSha256']; now = frozen['sourceSha256']
    delta = {key for key in set(old) | set(now) if old.get(key) != now.get(key)}
    require(delta == ALLOWED, 'Backend changed outside the eight reviewed CMS paths.')
    for key in ('build', 'unit', 'sql', 'cleanup'):
        record = accepted[key]; file = rma.owned_path(record['path'])
        require(ops.sha(file) == record['sha256'] and record['exitCode'] == 0, 'Accepted check evidence changed.')
        if key in ('unit', 'sql'):
            names = ops.accepted_trx(file, record['passed'])
            require(Counter(names) == Counter(record['names']), 'Accepted test results changed.')
            if key == 'sql':
                require({name.split('(')[0].rsplit('.', 1)[0] for name in names} == SQL_CLASSES,
                        'Unexpected or missing SQL classes in actual TRX results.')
    require(accepted['unit']['passed'] >= 1486 and accepted['sql']['passed'] >= 5,
            'Full unit and meaningful CMS SQL coverage are required.')
    require(set(accepted['sql']['classes']) == set(accepted['sqlClassesExpected']) == SQL_CLASSES
            and {'Shop.SqlTests.StoreIdentitySqlTests', 'Shop.SqlTests.DevelopmentStoreIdentitySqlTests'} <= set(accepted['sql']['classes']),
            'Every selected complete SQL class must execute.')
    return accepted


def descriptor_hashes(): return {name: ops.sha(path) for name, path in rma.DESCRIPTORS.items()}
def fingerprints():
    value = rma.snapshot(); value.pop('atUtc', None)
    value['metadata'] = rma.payload(rma.METADATA_SQL)
    require(value.get('database') == 'Sayman' and len(value['tables']) == len(value['metadata']) == 229,
            'All229table fingerprints and metadata are required.')
    return value


def package_delta(before, after):
    require(set(after) == set(before), 'API package dependencies or file set changed.')
    changed = {name for name in after if after[name] != before[name]}
    require({'Shop.Api.dll', 'Shop.Modules.Cms.dll'} <= changed
            and changed <= {'Shop.Api.dll', 'Shop.Api.pdb', 'Shop.Modules.Cms.dll', 'Shop.Modules.Cms.pdb'},
            'Only existing API/CMS DLLs and PDBs may change.')
    return changed


def prepare():
    accepted = acceptance(); previous = ops.read(CURRENT); compatible88(previous)
    require(rma.shape() == {'migrationCount': 88, 'tableCount': 229}, 'Canonical schema differs.')
    old = rma.runtime('api', previous); files = photo.tree(ops.API_BIN); before = photo.tree(old)
    changed = package_delta(before, files)
    run = uuid.uuid4().hex; directory = ROOT / ('tmp/api-runtime-store-identity-' + run)
    require(not directory.exists(), 'Candidate package already exists.')
    shutil.copytree(ops.API_BIN, directory); require(photo.tree(directory) == files, 'Candidate copy changed.')
    manifest = CHECKS / ('store-identity-api-' + run + '-manifest.json')
    ops.write(manifest, {'algorithm': 'SHA-256', 'files': files})
    plan = {'kind': KIND, 'run': run, 'accepted': accepted, 'helpers': helpers(),
            'previous': previous, 'process': rma.owned_process('api', previous),
            'descriptors': descriptor_hashes(), 'aggregateSha256': ops.sha(AGGREGATE),
            'preservedFiles': photo.preserved_files(), 'runtimeDirectory': relative(directory),
            'artifactManifest': relative(manifest), 'artifactManifestSha256': ops.sha(manifest),
            'apiFiles': files, 'changedFiles': sorted(changed), 'preparedAtUtc': stamp()}
    return plan


def candidate(plan, report):
    previous = plan['previous']; compatible88(previous)
    accepted = plan['accepted']; modules = {name: values['api'] for name, values in accepted['frozen']['module14parity'].items()}
    return {**previous, 'runtimeDirectory': plan['runtimeDirectory'], 'previousRuntimeDirectory': previous['runtimeDirectory'],
            'artifactManifest': plan['artifactManifest'], 'artifactManifestSha256': plan['artifactManifestSha256'],
            'moduleSha256': modules, 'apiPid': None, 'slice': 'D63 configurable store identity and explicit development examples',
            'codeOnly': True, 'newMigrations': 0, 'newTables': 0, 'newBackupCreated': False,
            'mainSeedPerformed': False, 'healthCheckPassed': False, 'storeIdentityApiAccepted': False,
            'localReleaseEvidence': relative(report), 'healthEvidence': relative(report),
            'storeIdentityBackendEvidence': relative(ACCEPTANCE), 'unitPassed': accepted['unit']['passed'],
            'sqlPassed': accepted['sql']['passed'], 'targetedSqlPassed': accepted['sql']['passed'],
            'fullSqlRunThisRelease': False, 'fullSqlSingleRunPassed': False,
            'sqlAcceptanceMode': 'targeted-complete-CMS-classes', 'historicalFullSqlPassed': 1031,
            'fullProjectComplete': False}


def apply(plan):
    require(plan.get('kind') == KIND and len(plan.get('run', '')) == 32 and all(c in '0123456789abcdef' for c in plan['run']), 'Invalid prepared publication.')
    require(acceptance() == plan['accepted'] and helpers() == plan['helpers'], 'Accepted evidence or publisher changed.')
    require(descriptor_hashes() == plan['descriptors'] and ops.sha(AGGREGATE) == plan['aggregateSha256']
            and photo.preserved_files() == plan['preservedFiles'] and rma.shape() == {'migrationCount': 88, 'tableCount': 229}, 'Canonical inputs changed.')
    previous = plan['previous']; compatible88(previous)
    require(rma.owned_process('api', previous) == plan['process'], 'Selected API ownership changed.')
    report_path = CHECKS / ('store-identity-api-' + plan['run'] + '-main-release.json')
    require(not report_path.exists(), 'Publication report already exists.')
    state = candidate(plan, report_path); rma.runtime('api', state)
    require(photo.tree(ROOT / state['runtimeDirectory']) == plan['apiFiles'], 'Candidate manifest changed.')
    report = {'passed': False, 'startedAtUtc': stamp(), 'newMigrations': 0, 'newTables': 0,
              'mainSeedPerformed': False, 'sqlWritesPerformedByPublisher': False,
              'recoveryPolicy': 'Only the immediately previous finalized API88; never Down/restore or select86.',
              'acceptedEvidence': relative(ACCEPTANCE), 'acceptedSha256': ops.sha(ACCEPTANCE)}
    stopped = False; active = None; identity = None
    try:
        rma.stop_owned('api', previous, plan['process']); stopped = True
        before = fingerprints(); report['beforeSql'] = {'path': relative(CHECKS / ('store-identity-api-' + plan['run'] + '-before.json'))}
        ops.write(ROOT / report['beforeSql']['path'], before)
        active, checks, identity = rma.start_selected('api', state, CHECKS / ('store-identity-api-' + plan['run'] + '.log'))
        for path, status in [('/api/storefront/fa?metadataOnly=true', 200), ('/api/storefront/en?metadataOnly=true', 200), ('/api/auth/me', 401), ('/api/admin/content', 401), ('/api/returns', 401)]:
            check, _ = ops.request(path, status, require_no_store='storefront' not in path); checks.append(check)
        require(fingerprints() == before and photo.preserved_files() == plan['preservedFiles'], 'SQL rows/metadata, keys or media changed across code-only startup.')
        require(all(ops.sha(rma.DESCRIPTORS[name]) == plan['descriptors'][name] for name in ('storefront', 'admin')),
                'A frontend descriptor changed during API publication.')
        require(ops.sha(AGGREGATE) == plan['aggregateSha256'] and rma.owned_process('api', active) == identity, 'Publication ownership changed.')
        active.update(healthCheckPassed=True, storeIdentityApiAccepted=True, promotedAtUtc=stamp()); ops.write(CURRENT, active)
        report.update(passed=True, runtimeDirectory=active['runtimeDirectory'], apiPid=identity['pid'], httpChecks=checks,
                      sql229TablesAndMetadataPreserved=True, configurationKeysMediaPreserved=True, frontendDescriptorsUnchanged=True, finishedAtUtc=stamp())
        ops.write(report_path, report)
        aggregate = ops.read(AGGREGATE); aggregate['componentReleaseEvidence']['api'] = relative(report_path)
        aggregate.update(updatedAtUtc=stamp(), storeIdentityApiAccepted=True,
                         lastComponentReleaseEvidence={'path': relative(report_path), 'sha256': ops.sha(report_path)})
        ops.write(AGGREGATE, aggregate)
        return report
    except Exception as error:
        report.update(passed=False, errorType=type(error).__name__, finishedAtUtc=stamp())
        if stopped:
            try:
                if rma.listener('api') is not None:
                    require(active is not None and identity is not None, 'Unproved child ownership; preserve state for explicit recovery.')
                    rma.stop_owned('api', active, identity)
                compatible88(previous)
                recovered, _, _ = rma.start_selected('api', previous, CHECKS / ('store-identity-api-' + plan['run'] + '-recovery.log'))
                report.update(recoveredPreviousCompatible88=True, recoveryApiPid=recovered['apiPid'])
            except Exception as recovery:
                report['recoveryRequired'] = True; report['recoveryErrorType'] = type(recovery).__name__
        ops.write(report_path, report); raise


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('action', choices=('prepare', 'apply')); parser.add_argument('--plan', required=True)
    args = parser.parse_args(); path = rma.owned_path(args.plan)
    require(path.suffix == '.json', 'Plan must be a new JSON evidence file.')
    with (ROOT / 'tmp/store-identity-publication.lock').open('a') as stream:
        fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.action == 'prepare':
            require(not path.exists(), 'Prepared plan already exists.'); value = prepare(); ops.write(path, value, private=True)
            print(json.dumps({'prepared': True, 'run': value['run'], 'changedFiles': value['changedFiles']}))
        else:
            result = apply(ops.read(path)); print(json.dumps({'passed': result['passed'], 'apiPid': result['apiPid']}))


if __name__ == '__main__': main()
