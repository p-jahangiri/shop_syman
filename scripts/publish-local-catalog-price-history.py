"""Publish the accepted catalog price-history read code to the existing API88, without SQL writes.

Imports are inert. Prepare packages immutable offline bytes; apply only stops
the precisely selected API process. The two frontends, schema, policies, keys,
media and all229tables are retained. Recovery selects only that prior API88.
No seed, migration, privileged authentication, financial write or provider
activation is part of this publisher.
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
from urllib.error import HTTPError


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


rma = load('catalog_price_history_existing88', 'publish-local-commerce-rma.py')
ops, photo, runner = rma.ops, rma.photo, rma.runner
ROOT, CHECKS = rma.ROOT, rma.CHECKS
CURRENT, AGGREGATE = rma.DESCRIPTORS['api'], rma.AGGREGATE
BASELINE = CHECKS / 'store-identity-backend/acceptance.json'
ACCEPTANCE = CHECKS / 'catalog-price-history-backend/acceptance.json'
KIND = 'catalog-price-history-api88-code-only'
ALLOWED = {
    'backend/src/Shop.Modules.Catalog/Application/AdminPriceHistory.cs',
    'backend/src/Shop.Modules.Catalog/Infrastructure/AdminPriceHistory.cs',
    'backend/src/Shop.Api/Endpoints/AdminPriceHistoryEndpoints.cs',
    'backend/src/Shop.Api/Program.cs',
    'backend/tests/Shop.Tests/AdminPriceHistoryTests.cs',
    'backend/tests/Shop.SqlTests/AdminPriceHistorySqlTests.cs',
}
SQL_CLASSES = {'Shop.SqlTests.' + name for name in (
    'AdminPriceHistorySqlTests', 'CatalogSqlTests', 'AdminProductSqlTests',
    'CatalogVersionSqlTests', 'PublicCatalogReadSqlTests')}
CHANGED_MODULES = {'Shop.Api.dll', 'Shop.Modules.Catalog.dll'}
CLEANUP_ZERO = 'SQL cleanup verified: zero SaymanTest_* databases remain. No data was deleted.'


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
    for name in ('publish-local-catalog-price-history.py', 'test_publish_local_catalog_price_history.py', 'serve-main-api.py'):
        path = ROOT / 'scripts' / name; values[relative(path)] = ops.sha(path)
    values[relative(BASELINE)] = ops.sha(BASELINE)
    return values


def acceptance():
    accepted = ops.read(ACCEPTANCE)
    require(accepted.get('passed') is True and accepted.get('schemaChanges') == 0,
            'Fresh accepted backend evidence is required.')
    frozen = runner.freeze('Debug')
    require(frozen == accepted['frozen'], 'Accepted source, test binaries or14module parity changed.')
    baseline = ops.read(BASELINE)
    require(baseline.get('passed') is True and baseline.get('schemaChanges') == 0,
            'The accepted D63 backend is the only source baseline.')
    old = baseline['frozen']['sourceSha256']; now = frozen['sourceSha256']
    delta = {key for key in set(old) | set(now) if old.get(key) != now.get(key)}
    require(delta == ALLOWED, 'Backend changed outside the six reviewed price-history paths.')
    before_modules = baseline['frozen']['module14parity']; modules = frozen['module14parity']
    require(set(modules) == set(before_modules) and len(modules) == 14
            and all(set(values) == {'api', 'unit', 'sql'} and len(set(values.values())) == 1
                    for values in modules.values())
            and {name for name in modules if modules[name] != before_modules[name]} == CHANGED_MODULES,
            'Only API/Catalog modules may differ; the other12 must retain D63 bytes.')
    for key in ('build', 'unit', 'sql', 'cleanup'):
        record = accepted[key]; file = rma.owned_path(record['path'])
        require(ops.sha(file) == record['sha256'] and record['exitCode'] == 0, 'Accepted check evidence changed.')
        if key in ('unit', 'sql'):
            names = ops.accepted_trx(file, record['passed'])
            require(Counter(names) == Counter(record['names']), 'Accepted test results changed.')
            if key == 'sql':
                require({name.split('(')[0].rsplit('.', 1)[0] for name in names} == SQL_CLASSES,
                        'Unexpected or missing SQL classes in actual TRX results.')
        if key == 'cleanup':
            require(file.read_text().strip() == CLEANUP_ZERO,
                    'The actual cleanup log must prove zero disposable SQL fixtures.')
    require(accepted['unit']['passed'] >= 1519 and accepted['sql']['passed'] >= 5,
            'Full unit and meaningful catalog SQL coverage are required.')
    require(set(accepted['sql']['classes']) == set(accepted['sqlClassesExpected']) == SQL_CLASSES
            and accepted['sql'].get('exactDiscoveryCounter') is True,
            'Every selected complete SQL class must execute.')
    record = accepted['sqlDiscovery']; file = rma.owned_path(record['path'])
    require(record['exitCode'] == 0 and ops.sha(file) == record['sha256'],
            'Fresh SQL discovery evidence changed.')
    discovered = ops.read(file)
    require(set(discovered['selectedClasses']) == SQL_CLASSES
            and type(discovered['allCases']) is int
            and discovered['allCases'] >= len(discovered['selected']) >= 5
            and {name.split('(')[0].rsplit('.', 1)[0] for name in discovered['selected']} == SQL_CLASSES
            and Counter(discovered['selected']) == Counter(accepted['sql']['names']),
            'Discovery/TRX must include every case in the five whole SQL classes.')
    return accepted


def descriptor_hashes(): return {name: ops.sha(path) for name, path in rma.DESCRIPTORS.items()}
def fingerprints():
    value = rma.snapshot(); value.pop('atUtc', None)
    value['metadata'] = rma.payload(rma.METADATA_SQL)
    require(value.get('database') == 'Sayman' and len(value['tables']) == len(value['metadata']) == 229,
            'All229table fingerprints and metadata are required.')
    return value


def aggregate88(state):
    compatible88({**state, 'api': state.get('canonicalUrls', {}).get('api')})
    require(state.get('database') == 'Sayman' and state.get('canonicalUrls') == rma.URLS
            and set(state.get('componentReleaseEvidence', {})) == {'api', 'storefront', 'admin'},
            'The aggregate must describe only the finalized canonical88 Sayman services.')


def private_probe(path):
    require(path in {'/api/admin/products/p1/price-history', '/api/admin/content', '/api/returns'},
            'Only fixed anonymous read-only private probes are permitted.')
    try:
        response = ops.HTTP.open(ops.API_URL + path, timeout=10)
    except HTTPError as error:
        response = error
    with response:
        headers = response.headers
        cache = {item.strip().lower() for item in headers.get('Cache-Control', '').split(',')}
        vary = {item.strip().lower() for item in headers.get('Vary', '').split(',')}
        body = response.read(32769)
        require(response.status == 401 and {'private', 'no-store'} <= cache
                and {'cookie', 'authorization'} <= vary
                and 'noindex' in headers.get('X-Robots-Tag', '').lower()
                and headers.get('X-Content-Type-Options', '').lower() == 'nosniff'
                and not headers.get('Set-Cookie') and not headers.get('Location')
                and len(body) <= 32768,
                'Anonymous private challenge lacks401/private/no-store/noindex/nosniff/Vary.')
        if path == '/api/returns':
            require(headers.get('X-Sayman-Returns-Contract') == 'rma-v1',
                    'The existing RMA challenge lost its accepted contract marker.')
        return {'path': path, 'status': 401, 'privateHeadersAccepted': True,
                'noStore': True, 'bodyBytes': len(body)}


def package_delta(before, after):
    require(set(after) == set(before), 'API package dependencies or file set changed.')
    changed = {name for name in after if after[name] != before[name]}
    require({'Shop.Api.dll', 'Shop.Modules.Catalog.dll'} <= changed
            and changed <= {'Shop.Api.dll', 'Shop.Api.pdb', 'Shop.Modules.Catalog.dll', 'Shop.Modules.Catalog.pdb'},
            'Only existing API/Catalog DLLs and PDBs may change.')
    return changed


def prepare():
    accepted = acceptance(); previous = ops.read(CURRENT); compatible88(previous)
    aggregate88(ops.read(AGGREGATE))
    require(rma.shape() == {'migrationCount': 88, 'tableCount': 229}, 'Canonical schema differs.')
    old = rma.runtime('api', previous); files = photo.tree(ops.API_BIN); before = photo.tree(old)
    changed = package_delta(before, files)
    run = uuid.uuid4().hex; directory = ROOT / ('tmp/api-runtime-catalog-price-history-' + run)
    require(not directory.exists(), 'Candidate package already exists.')
    shutil.copytree(ops.API_BIN, directory); require(photo.tree(directory) == files, 'Candidate copy changed.')
    manifest = CHECKS / ('catalog-price-history-api-' + run + '-manifest.json')
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
            'moduleSha256': modules, 'apiPid': None, 'slice': 'D65 read-only catalog price history',
            'codeOnly': True, 'newMigrations': 0, 'newTables': 0, 'newBackupCreated': False,
            'mainSeedPerformed': False, 'healthCheckPassed': False, 'catalogPriceHistoryApiAccepted': False,
            'localReleaseEvidence': relative(report), 'healthEvidence': relative(report),
            'catalogPriceHistoryBackendEvidence': relative(ACCEPTANCE), 'unitPassed': accepted['unit']['passed'],
            'sqlPassed': accepted['sql']['passed'], 'targetedSqlPassed': accepted['sql']['passed'],
            'fullSqlRunThisRelease': False, 'fullSqlSingleRunPassed': False,
            'sqlAcceptanceMode': 'targeted-complete-catalog-price-history-classes', 'historicalFullSqlPassed': 1031,
            'fullProjectComplete': False}


def apply(plan):
    require(plan.get('kind') == KIND and len(plan.get('run', '')) == 32 and all(c in '0123456789abcdef' for c in plan['run']), 'Invalid prepared publication.')
    require(acceptance() == plan['accepted'] and helpers() == plan['helpers'], 'Accepted evidence or publisher changed.')
    require(descriptor_hashes() == plan['descriptors'] and ops.sha(AGGREGATE) == plan['aggregateSha256']
            and photo.preserved_files() == plan['preservedFiles'] and rma.shape() == {'migrationCount': 88, 'tableCount': 229}, 'Canonical inputs changed.')
    previous = plan['previous']; compatible88(previous)
    aggregate88(ops.read(AGGREGATE))
    require(rma.owned_process('api', previous) == plan['process'], 'Selected API ownership changed.')
    report_path = CHECKS / ('catalog-price-history-api-' + plan['run'] + '-main-release.json')
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
        before = fingerprints(); report['beforeSql'] = {'path': relative(CHECKS / ('catalog-price-history-api-' + plan['run'] + '-before.json'))}
        ops.write(ROOT / report['beforeSql']['path'], before)
        active, checks, identity = rma.start_selected('api', state, CHECKS / ('catalog-price-history-api-' + plan['run'] + '.log'))
        for path, status in [('/api/storefront/fa?metadataOnly=true', 200), ('/api/storefront/en?metadataOnly=true', 200), ('/api/auth/me', 401)]:
            check, _ = ops.request(path, status, require_no_store='storefront' not in path); checks.append(check)
        checks.extend(private_probe(path) for path in (
            '/api/admin/content', '/api/returns', '/api/admin/products/p1/price-history'))
        require(fingerprints() == before and photo.preserved_files() == plan['preservedFiles'], 'SQL rows/metadata, keys or media changed across code-only startup.')
        require(all(ops.sha(rma.DESCRIPTORS[name]) == plan['descriptors'][name] for name in ('storefront', 'admin')),
                'A frontend descriptor changed during API publication.')
        require(ops.sha(AGGREGATE) == plan['aggregateSha256'] and rma.owned_process('api', active) == identity, 'Publication ownership changed.')
        active.update(healthCheckPassed=True, catalogPriceHistoryApiAccepted=True, promotedAtUtc=stamp()); ops.write(CURRENT, active)
        report.update(passed=True, runtimeDirectory=active['runtimeDirectory'], apiPid=identity['pid'], httpChecks=checks,
                      sql229TablesAndMetadataPreserved=True, configurationKeysMediaPreserved=True, frontendDescriptorsUnchanged=True, finishedAtUtc=stamp())
        ops.write(report_path, report)
        aggregate = ops.read(AGGREGATE); aggregate['componentReleaseEvidence']['api'] = relative(report_path)
        aggregate.update(updatedAtUtc=stamp(), catalogPriceHistoryApiAccepted=True,
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
                recovered, _, _ = rma.start_selected('api', previous, CHECKS / ('catalog-price-history-api-' + plan['run'] + '-recovery.log'))
                report.update(recoveredPreviousCompatible88=True, recoveryApiPid=recovered['apiPid'])
            except Exception as recovery:
                report['recoveryRequired'] = True; report['recoveryErrorType'] = type(recovery).__name__
        ops.write(report_path, report); raise


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('action', choices=('prepare', 'apply')); parser.add_argument('--plan', required=True)
    args = parser.parse_args(); path = rma.owned_path(args.plan)
    require(path.suffix == '.json', 'Plan must be a new JSON evidence file.')
    with (ROOT / 'tmp/catalog-price-history-publication.lock').open('a') as stream:
        fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.action == 'prepare':
            require(not path.exists(), 'Prepared plan already exists.'); value = prepare(); ops.write(path, value, private=True)
            print(json.dumps({'prepared': True, 'run': value['run'], 'changedFiles': value['changedFiles']}))
        else:
            result = apply(ops.read(path)); print(json.dumps({'passed': result['passed'], 'apiPid': result['apiPid']}))


if __name__ == '__main__': main()
