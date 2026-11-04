"""Read-only checks of the three current canonical local services.

Defaults to the historical D57/D58/D59 release. Used-inspection-photos checks
require their explicit flag and a fully promoted API plus both frontends.

Writes only a new requested proof. Uses anonymous GETs without cookies, tokens,
redirects or proxy configuration. It never starts services, authenticates a
user, changes SQL/settings or operates the user's browser.
"""
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
import argparse
import hashlib
import http.client
import json
import os
import re
import time
import uuid
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parent.parent
CHECKS = ROOT / 'artifacts/checks'
FROZEN = CHECKS / 'd57-final-frozen-backend.json'
USED_PHOTOS_FROZEN = CHECKS / 'used-photos-backend/frozen-accepted.json'
USED_PHOTOS_ACCEPTANCE = CHECKS / 'used-photos-backend/acceptance.json'
USED_PHOTOS_MIGRATION = '20261030160000_UsedInspectionPhotos'
AGGREGATE = ROOT / 'tmp/local-runtime-current.json'
DESCRIPTORS = {name: ROOT / f'tmp/{name}-runtime-current.json' for name in ('api', 'storefront', 'admin')}
PORTS = {'api': 5080, 'storefront': 3000, 'admin': 3173}
URLS = {name: f'http://127.0.0.1:{port}' for name, port in PORTS.items()}
HEADERS = ('Content-Type', 'Cache-Control', 'X-Robots-Tag', 'X-Content-Type-Options', 'Vary')
ID = '00000000000000000000000000000001'
MAX_BODY_BYTES = 8 * 1024 * 1024


class VerificationError(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise VerificationError(message)


def stamp():
    return datetime.now(timezone.utc).isoformat()


def sha(path):
    require(path.is_file() and not path.is_symlink(), 'An expected regular artifact file is unavailable.')
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def workspace_path(value, parent):
    require(isinstance(value, str) and value and not Path(value).is_absolute()
            and '..' not in Path(value).parts, 'Expected a workspace-relative owned artifact path.')
    path = ROOT / value
    require(path.resolve().is_relative_to(parent.resolve()) and path.resolve() != parent.resolve(),
            'Artifact path escaped its owned workspace directory.')
    for candidate in (path, *path.parents):
        require(not candidate.is_symlink(), 'Linked artifact paths are forbidden.')
        if candidate == ROOT:
            break
    return path


def read(path):
    sha(path)
    return json.loads(path.read_text())


def manifest(state, component):
    runtime = workspace_path(state['runtimeDirectory'], ROOT / 'tmp')
    require(runtime.is_dir() and runtime.name.startswith(component + '-runtime-'), 'Current runtime directory is invalid.')
    path = workspace_path(state['artifactManifest'], CHECKS)
    digest = sha(path)
    require(digest == state['artifactManifestSha256'], 'Current artifact manifest hash differs from its descriptor.')
    document = read(path)
    entries = document.get('files') if component == 'api' else document.get('artifacts')
    require(isinstance(entries, dict) and entries, 'A nonempty complete artifact manifest is required.')
    if component == 'api':
        require(document.get('algorithm') == 'SHA-256', 'API artifact manifest algorithm differs.')
    else:
        require(document.get('runtimeDirectory') == state['runtimeDirectory'], 'Frontend manifest selects another runtime.')
    actual = {}
    for directory, children, files in os.walk(runtime):
        require(not any((Path(directory) / name).is_symlink() for name in children), 'Runtime contains a linked directory.')
        for name in files:
            file = Path(directory) / name
            actual[str(file.relative_to(runtime))] = sha(file)
    require(actual == entries, 'Current runtime file set or bytes differ from its complete artifact manifest.')
    if component == 'storefront':
        require(state.get('runtimeLayout') == 'standalone' and state.get('port') == 3000
                and state.get('previewEnabled') is False
                and state.get('publicUrl') == URLS['storefront'], 'Storefront is not the canonical API-backed standalone runtime.')
        require(sha(runtime / 'apps/storefront/server.js') == state['serverSha256'], 'Storefront server entry changed.')
        dist = state['distDirectory']
        require(isinstance(dist, str) and Path(dist).name == dist and dist.startswith('.next'), 'Unexpected standalone build directory.')
        require((runtime / 'apps/storefront' / dist / 'BUILD_ID').read_text().strip() == state['buildId'], 'Storefront build identity differs.')
    if component == 'admin':
        require(state.get('admin') == URLS['admin'] and sha(runtime / 'server.mjs') == state['proxyModuleSha256'], 'Canonical admin proxy differs.')
    return runtime, entries, {'runtimeDirectory': state['runtimeDirectory'], 'manifest': state['artifactManifest'],
                              'manifestSha256': digest, 'filesVerified': len(entries), 'byteExact': True}


def backend_acceptance(acceptance_path=None):
    path = USED_PHOTOS_ACCEPTANCE if acceptance_path is None else Path(acceptance_path)
    path = workspace_path(str(path.relative_to(ROOT)), CHECKS)
    require(path.suffix == '.json', 'Backend acceptance must be an owned JSON artifact.')
    accepted = read(path)
    reference = accepted.get('frozen', {})
    require(isinstance(reference, dict) and set(reference) == {'path', 'sha256'},
            'Backend acceptance needs one exact frozen artifact reference.')
    frozen_path = workspace_path(reference['path'], CHECKS)
    require(frozen_path.suffix == '.json' and frozen_path != path
            and isinstance(reference['sha256'], str) and re.fullmatch(r'[0-9a-f]{64}', reference['sha256'])
            and sha(frozen_path) == reference['sha256'],
            'Backend acceptance does not reference the selected frozen evidence.')
    return path, accepted, frozen_path


def used_photos_evidence(frozen, acceptance_path=None):
    """Validate the new frozen format without weakening historical acceptance."""
    acceptance_path, accepted, frozen_path = backend_acceptance(acceptance_path)
    require(frozen == read(frozen_path), 'Selected frozen backend contents changed.')
    parity = frozen.get('module14parity')
    require(isinstance(parity, dict) and len(parity) == 14 and 'Shop.Api.dll' in parity
            and parity == accepted.get('module14parity'), 'Used-photo fourteen-module evidence differs.')
    expected = {}
    for name, values in parity.items():
        require(isinstance(values, dict) and set(values) == {'api', 'unit', 'sql'}
                and isinstance(values['api'], str) and re.fullmatch(r'[0-9a-f]{64}', values['api'])
                and len(set(values.values())) == 1, 'Used-photo compiled module parity is incomplete.')
        expected[name] = values['api']
    sources = frozen.get('sourceSha256')
    require(isinstance(sources, dict) and sources
            and len(sources) == accepted.get('backendSourceEntryCount'), 'Used-photo source freeze is incomplete.')
    for name, digest in sources.items():
        require(isinstance(digest, str) and re.fullmatch(r'[0-9a-f]{64}', digest)
                and sha(workspace_path(name, ROOT)) == digest, 'Current backend source differs from its used-photo freeze.')
    tests = frozen.get('testAssemblySha256')
    test_paths = {f'backend/tests/{assembly}/bin/Debug/net10.0/{assembly}.{suffix}'
                  for assembly in ('Shop.Tests', 'Shop.SqlTests')
                  for suffix in ('dll', 'deps.json', 'runtimeconfig.json')}
    require(isinstance(tests, dict) and set(tests) == test_paths
            and tests == accepted.get('testAssemblySha256'), 'Used-photo test assembly evidence differs.')
    for name, digest in tests.items():
        require(isinstance(digest, str) and re.fullmatch(r'[0-9a-f]{64}', digest)
                and sha(workspace_path(name, ROOT / 'backend/tests')) == digest,
                'Current unit/SQL test assemblies differ from their used-photo freeze.')
    unit = accepted.get('unit', {})
    total = unit.get('total')
    require(type(total) is int and total >= 1416 and unit.get('failed') == 0 and unit.get('skipped') == 0,
            'Used-photo backend unit acceptance needs at least1416passed.')
    trx = unit.get('trx', {})
    trx_path = workspace_path(trx.get('path'), CHECKS)
    require(sha(trx_path) == trx.get('sha256'), 'Used-photo accepted unit TRX changed.')
    counters = ET.parse(trx_path).find('.//{*}Counters')
    require(counters is not None and all(counters.get(name) == str(total) for name in ('total', 'executed', 'passed'))
            and all(counters.get(name) == '0' for name in ('failed', 'error', 'timeout', 'aborted', 'inconclusive',
                                                         'passedButRunAborted', 'notRunnable', 'notExecuted', 'disconnected')),
            'Used-photo unit TRX counters differ from the accepted total or contain exclusions.')
    return expected, {'path': str(acceptance_path.relative_to(ROOT)),
                      'sha256': sha(acceptance_path), 'unitPassed': total,
                      'unitTrxSha256': trx['sha256'], 'sourceEntriesVerified': len(sources),
                      'testArtifactsVerified': len(tests)}


def modules(api, runtime, used_photos=False, acceptance_path=None):
    frozen_path = backend_acceptance(acceptance_path)[2] if used_photos else FROZEN
    frozen = read(frozen_path)
    if used_photos:
        expected, acceptance = used_photos_evidence(frozen, acceptance_path)
    else:
        expected = frozen['modules']
        require(frozen.get('candidate14DllParity') is True, 'The historical fourteen-module candidate was not accepted.')
    require(isinstance(expected, dict) and len(expected) == 14 and 'Shop.Api.dll' in expected
            and expected == api['moduleSha256'], 'Current API differs from the frozen fourteen-module candidate.')
    locations = {'api': ROOT / 'backend/src/Shop.Api/bin/Debug/net10.0',
                 'unit': ROOT / 'backend/tests/Shop.Tests/bin/Debug/net10.0',
                 'sql': ROOT / 'backend/tests/Shop.SqlTests/bin/Debug/net10.0', 'runtime': runtime}
    for label, directory in locations.items():
        allowed = set(expected) | ({'Shop.Tests.dll'} if label == 'unit' else {'Shop.SqlTests.dll'} if label == 'sql' else set())
        require({path.name for path in directory.glob('Shop.*.dll')} == allowed, 'Compiled Shop module inventory differs from its frozen candidate.')
        for name, value in expected.items():
            require(Path(name).name == name and re.fullmatch(r'Shop\.[A-Za-z.]+\.dll', name)
                    and re.fullmatch(r'[0-9a-f]{64}', value) and sha(directory / name) == value,
                    'API/unit/SQL/runtime module parity failed.')
    result = {'frozenEvidence': str(frozen_path.relative_to(ROOT)), 'frozenEvidenceSha256': sha(frozen_path),
              'moduleCount': 14, 'moduleSha256': expected, 'apiUnitSqlRuntimeByteExact': True}
    if used_photos:
        result['backendAcceptance'] = acceptance
    return result


def get(component, path, expected, timeout, private=False, expected_hash=None, records=None):
    require(component in PORTS and path.startswith('/') and not path.startswith('//')
            and '\r' not in path and '\n' not in path, 'Only fixed canonical loopback GET paths are allowed.')
    started = time.monotonic()
    connection = http.client.HTTPConnection('127.0.0.1', PORTS[component], timeout=timeout)
    try:
        connection.request('GET', path, headers={'Accept': '*/*', 'Accept-Encoding': 'identity',
                                                'Connection': 'close', 'User-Agent': 'SaymanReadOnlyReleaseVerifier/1'})
        response = connection.getresponse()
        headers = {name.lower(): response.getheader(name, '') for name in HEADERS}
        digest, size, body = hashlib.sha256(), 0, bytearray()
        while True:
            remaining = timeout - (time.monotonic() - started)
            require(remaining > 0, 'A bounded canonical GET exceeded its deadline.')
            transport = connection.sock or getattr(getattr(response.fp, 'raw', None), '_sock', None)
            if transport is not None:
                transport.settimeout(remaining)
            block = response.read1(65536)
            if not block:
                break
            size += len(block)
            require(size <= MAX_BODY_BYTES, 'A canonical response exceeded the verifier body limit.')
            digest.update(block)
            body.extend(block)
        record = {'component': component, 'method': 'GET', 'path': path, 'expectedStatus': expected,
                  'status': response.status, 'headers': headers, 'bodyBytes': size,
                  'bodySha256': digest.hexdigest(), 'elapsedSeconds': round(time.monotonic() - started, 3)}
        if records is not None:
            records.append(record)
        require(response.status == expected, 'Canonical GET returned an unexpected status: ' + component + ' ' + path)
        if private:
            require('no-store' in headers['cache-control'].lower() and 'noindex' in headers['x-robots-tag'].lower(),
                    'An anonymous private response lacks no-store/noindex: ' + component + ' ' + path)
        if expected_hash is not None:
            require(record['bodySha256'] == expected_hash, 'Served admin asset differs from its selected artifact.')
        return record, bytes(body)
    finally:
        connection.close()


class AdminAssets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = set()

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        value = attributes.get('src') if tag == 'script' else attributes.get('href') if tag == 'link' else None
        if value and value.startswith('/assets/'):
            require(re.fullmatch(r'/assets/[A-Za-z0-9_./-]+\.(?:js|css)', value) is not None
                    and '..' not in Path(value).parts, 'Admin entry contains an unexpected asset URL.')
            self.paths.add(value)


def sql_shape(migrations=85, tables=222):
    # Optional and strictly read-only. The helper handles its existing private
    # connection; no credential or query result containing business rows is saved.
    from local_shop_ops import SCHEMAS, sql
    counts = ' UNION ALL '.join('SELECT COUNT_BIG(*) n FROM [' + schema + '].__EFMigrationsHistory' for schema in SCHEMAS)
    query = 'SELECT (SELECT SUM(n) migrationCount FROM (' + counts + ') h) migrations,' \
            '(SELECT COUNT(*) FROM sys.tables WHERE is_ms_shipped=0) tableCount FOR JSON PATH,WITHOUT_ARRAY_WRAPPER;'
    value = json.loads(''.join(sql(query, timeout=20).splitlines()).strip())
    require(value == {'migrations': migrations, 'tableCount': tables},
            f'Optional read-only canonical SQL shape differs from{migrations}/{tables}.')
    return {'readOnly': True, 'database': 'Sayman', 'migrationCount': migrations, 'tableCount': tables}


def ready_public_image_smoke(timeout, records):
    """Only existing public Ready metadata is selected; no original/actor fields."""
    from local_shop_ops import sql
    query = """SELECT JSON_QUERY((
      SELECT TOP (3) a.Id assetId, JSON_QUERY((
        SELECT v.Name name,v.Bytes bytes,v.Sha256 sha256
        FROM catalog.PublicImageVariants v WHERE v.AssetId=a.Id ORDER BY v.Name FOR JSON PATH
      )) variants
      FROM catalog.PublicImages a WHERE a.Status=N'Ready' ORDER BY a.Id FOR JSON PATH
    )) assets FOR JSON PATH,WITHOUT_ARRAY_WRAPPER;"""
    document = json.loads(''.join(sql(query, timeout=20).splitlines()).strip())
    require(isinstance(document, dict) and set(document) == {'assets'}
            and isinstance(document['assets'], list) and len(document['assets']) <= 3,
            'Ready public-image metadata exceeded its bounded selection.')
    assets = document['assets']
    ids = set()
    names = ('thumb', 'card', 'zoom')
    for asset in assets:
        require(isinstance(asset, dict) and set(asset) == {'assetId', 'variants'}
                and isinstance(asset['assetId'], str) and re.fullmatch(r'[0-9a-f]{32}', asset['assetId'])
                and asset['assetId'] != '0' * 32 and asset['assetId'] not in ids,
                'Ready public-image identity is invalid or duplicated.')
        ids.add(asset['assetId'])
        variants = asset['variants']
        require(isinstance(variants, list) and len(variants) == 3
                and all(isinstance(v, dict) and set(v) == {'name', 'bytes', 'sha256'}
                        and isinstance(v['name'], str) and v['name'] in names
                        and type(v['bytes']) is int and 12 <= v['bytes'] <= MAX_BODY_BYTES
                        and isinstance(v['sha256'], str) and re.fullmatch(r'[0-9a-f]{64}', v['sha256'])
                        for v in variants)
                and {v['name'] for v in variants} == set(names),
                'A selected Ready image lacks complete valid thumb/card/zoom metadata.')
    proof = {'readOnly': True, 'database': 'Sayman', 'maximumReadyAssets': 3,
             'selectedReadyAssets': len(assets), 'assets': assets, 'httpChecks': 0,
             'uploadPerformed': False, 'authenticatedGalleryOrBrowserAccepted': False,
             'adversarialUpstreamMimeTested': False, 'readyBytesAndSha256Match': False}
    if not assets:
        proof.update(status='not-run', reason='No existing Ready public catalogue images are available; no positive image delivery or new upload acceptance is claimed.')
        return proof
    for asset in assets:
        for variant in asset['variants']:
            suffix = asset['assetId'] + '/' + variant['name'] + '.webp'
            for component in PORTS:
                prefix = '/media/catalog/' if component == 'storefront' else '/api/media/catalog/'
                record, body = get(component, prefix + suffix, 200, timeout,
                                   expected_hash=variant['sha256'], records=records)
                require(record['headers']['content-type'] == 'image/webp'
                        and record['headers']['x-content-type-options'].lower() == 'nosniff'
                        and record['bodyBytes'] == variant['bytes']
                        and record['bodySha256'] == variant['sha256']
                        and body[:4] == b'RIFF' and body[8:12] == b'WEBP',
                        'An existing Ready public image differs from its SQL metadata or WebP protection.')
                proof['httpChecks'] += 1
    proof.update(status='passed', readyBytesAndSha256Match=True)
    return proof


def verify(proof, timeout, check_sql, used_photos=False, backend_acceptance_path=None):
    require(used_photos or backend_acceptance_path is None,
            'Explicit backend acceptance requires the used-inspection-photos release mode.')
    migrations, tables = (86, 223) if used_photos else (85, 222)
    if used_photos:
        backend_acceptance_path, accepted_backend, frozen_path = backend_acceptance(backend_acceptance_path)
    else:
        frozen_path = FROZEN
    tracked = [*DESCRIPTORS.values(), AGGREGATE, frozen_path, Path(__file__).resolve(), ROOT / 'scripts/local_shop_ops.py']
    if used_photos:
        tracked.append(backend_acceptance_path)
    before = {str(path.relative_to(ROOT)): sha(path) for path in tracked}
    if used_photos:
        require(read(backend_acceptance_path) == accepted_backend,
                'Selected backend acceptance changed while its release was being resolved.')
    proof['helperSourceSha256'] = {key: value for key, value in before.items() if key.startswith('scripts/')}
    states = {name: read(path) for name, path in DESCRIPTORS.items()}
    aggregate = read(AGGREGATE)
    require(aggregate.get('canonicalUrls') == URLS and aggregate.get('database') == 'Sayman'
            and aggregate.get('databaseMigrationCount') == migrations, 'Current aggregate is not the canonical local shop.')
    for name, state in states.items():
        require(aggregate.get(name + 'Descriptor') == str(DESCRIPTORS[name].relative_to(ROOT))
                and aggregate.get('componentReleaseEvidence', {}).get(name) == state.get('localReleaseEvidence'),
                'Aggregate does not reference the current component release.')
        require(state.get('mainPromoted') is True and state.get('api') == URLS['api']
                and state.get('sourceMigrationCount') == state.get('databaseMigrationCount') == migrations,
                'A current descriptor does not select the canonical accepted schema/API.')
    require(states['api'].get('digitalDeliveryApiAccepted') is True and states['api'].get('tableCount') == tables,
            'The accepted D57 digital delivery API has not been promoted.')
    if used_photos:
        require(aggregate.get('usedInspectionPhotosAccepted') is True and aggregate.get('tableCount') == tables,
                'The used-photo aggregate is not fully promoted.')
        require(states['api'].get('usedInspectionPhotosApiAccepted') is True
                and states['api'].get('usedInspectionPhotosFrontendPromotionPending') is False
                and states['api'].get('usedInspectionPhotosMigrationId') == USED_PHOTOS_MIGRATION,
                'The used-photo API or its frontend promotion is incomplete.')
        for name in ('storefront', 'admin'):
            require(states[name].get('tableCount') == tables
                    and states[name].get('usedInspectionPhotosFrontendAccepted') is True,
                    'A used-photo frontend has not been promoted with the current schema.')
        if accepted_backend.get('physicalFulfillmentCapacityAccepted') is True:
            require(states['api'].get('physicalFulfillmentCapacityAccepted') is True,
                    'The selected physical-fulfillment capacity fix has not been promoted.')
        if accepted_backend.get('customerLoginContinuityAccepted') is True:
            require(states['api'].get('customerLoginContinuityAccepted') is True,
                    'The selected customer-login continuity fix has not been promoted.')
    artifacts = {name: manifest(state, name) for name, state in states.items()}
    proof['descriptors'] = {name: {'path': str(DESCRIPTORS[name].relative_to(ROOT)),
                                  'sha256': before[str(DESCRIPTORS[name].relative_to(ROOT))], **value[2]}
                            for name, value in artifacts.items()}
    proof['backendParity'] = modules(states['api'], artifacts['api'][0], used_photos, backend_acceptance_path)
    proof['aggregate'] = {'path': str(AGGREGATE.relative_to(ROOT)), 'sha256': before[str(AGGREGATE.relative_to(ROOT))],
                          'currentComponentReleasesMatch': True}

    def request(component, path, status=200, private=False, expected_hash=None):
        _, body = get(component, path, status, timeout, private, expected_hash, proof['httpChecks'])
        return body

    request('api', '/health/live')
    require(json.loads(request('api', '/health/ready')).get('status') == 'ready', 'Canonical API readiness payload is invalid.')
    for locale in ('fa', 'en'):
        request('api', f'/api/storefront/{locale}?metadataOnly=true')
        for path in (f'/{locale}', f'/{locale}/account', f'/{locale}/addresses'):
            request('storefront', path)
    for path in ('/api/account/profile', f'/api/orders/{ID}/fulfillment/digital',
                 f'/api/orders/v2/{ID}/fulfillment/digital', f'/api/admin/orders/{ID}/{ID}/fulfillment/digital'):
        request('api', path, 401, private=True)
    for path in ('/api/account/profile', '/api/addresses', f'/api/orders/v2/{ID}/fulfillment/digital'):
        request('storefront', path, 401, private=True)
    admin_entries = artifacts['admin'][1]
    document = request('admin', '/', expected_hash=admin_entries['index.html'])
    assets = AdminAssets()
    assets.feed(document.decode('utf-8', errors='strict'))
    require(bool(assets.paths), 'Current admin entry references no root assets.')
    for path in sorted(assets.paths):
        require(path[1:] in admin_entries, 'Admin entry references an asset outside its accepted manifest.')
        request('admin', path, expected_hash=admin_entries[path[1:]])
    request('admin', '/api/auth/me', 401, private=True)
    request('admin', f'/api/admin/orders/{ID}/{ID}/fulfillment/digital', 401, private=True)
    if used_photos:
        for component in ('api', 'admin'):
            for path in ('/api/admin/used-items/variants', f'/api/admin/used-items/{ID}'):
                request(component, path, 401, private=True)
        missing = uuid.uuid4().hex
        for component in PORTS:
            prefix = '/media/catalog/' if component == 'storefront' else '/api/media/catalog/'
            for file in ('card.webp', 'original.png'):
                record, body = get(component, prefix + missing + '/' + file, 404, timeout,
                                   records=proof['httpChecks'])
                require(record['headers']['x-content-type-options'].lower() == 'nosniff'
                        and not record['headers']['content-type'].lower().startswith('image/')
                        and not (body[:4] == b'RIFF' and body[8:12] == b'WEBP'),
                        'An unavailable public image response was served as an image or lacks nosniff.')
        proof['usedInspectionPhotos'] = {'migrationCount': migrations, 'tableCount': tables,
            'migrationId': USED_PHOTOS_MIGRATION, 'allThreeDescriptorsAndAggregateAccepted': True,
            'anonymousAdminProtectionVerified': True, 'missingAndNonprocessedPublicImagesRejected': True,
            'realImageUploadOrAdversarialUpstreamMimeAccepted': False, 'authenticatedPhotoGalleryBrowserAccepted': False}
        if accepted_backend.get('physicalFulfillmentCapacityAccepted') is True:
            proof['physicalFulfillmentCapacity'] = {'selectedBackendAcceptanceAndApiMarkerMatch': True,
                                                    'authenticatedFulfillmentBrowserAccepted': False}
        if accepted_backend.get('customerLoginContinuityAccepted') is True:
            proof['customerLoginContinuity'] = {'selectedBackendAcceptanceAndApiMarkerMatch': True,
                                                'authenticatedCmsPublicationBrowserAccepted': False}
    if check_sql:
        proof['sqlShape'] = sql_shape(migrations, tables)
        if used_photos:
            proof['readyPublicImages'] = ready_public_image_smoke(timeout, proof['httpChecks'])
    after = {str(path.relative_to(ROOT)): sha(path) for path in tracked}
    require(before == after, 'Current descriptors, aggregate, frozen backend or verifier helpers changed during verification.')
    # Recheck runtime bytes after the HTTP pass as well as before it.
    for name, state in states.items():
        manifest(state, name)
    if used_photos:
        modules(states['api'], artifacts['api'][0], True, backend_acceptance_path)
    proof.update({'passed': True, 'status': 'passed', 'httpCheckCount': len(proof['httpChecks']),
                  'currentDescriptorsUnchanged': True, 'runtimeArtifactsUnchanged': True,
                  'helperSourceSha256': {key: value for key, value in before.items() if key.startswith('scripts/')},
                  'completedAtUtc': stamp()})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, help='New workspace-relative JSON proof below artifacts/checks; never overwrites a file.')
    parser.add_argument('--timeout-seconds', type=int, default=15, help='Per-request deadline from1to20seconds (default15).')
    parser.add_argument('--check-sql-shape', action='store_true', help='Also inspect only canonical SQL migration/table counts using the existing read-only helper.')
    parser.add_argument('--used-inspection-photos', action='store_true',
                        help='Explicitly verify the fully promoted used-inspection-photos86/223 release; default remains historical D57/85/222.')
    parser.add_argument('--backend-acceptance',
                        help='Optional workspace-relative backend acceptance JSON below artifacts/checks for photo mode; defaults to historical used-photo acceptance.')
    args = parser.parse_args()
    require(1 <= args.timeout_seconds <= 20, 'Request timeout must be between1and20seconds.')
    require(args.used_inspection_photos or args.backend_acceptance is None,
            'Explicit backend acceptance requires --used-inspection-photos.')
    selected_backend = workspace_path(args.backend_acceptance, CHECKS) if args.backend_acceptance else None
    output = workspace_path(args.output, CHECKS)
    require(output.suffix == '.json' and output.parent.is_dir() and not output.exists(), 'Proof needs a new JSON file in an existing artifacts/checks directory.')
    proof = {'schemaVersion': 1, 'passed': False, 'status': 'running', 'startedAtUtc': stamp(),
             'scope': 'Anonymous read-only current local API/storefront/admin artifacts and HTTP protection',
             'httpChecks': [], 'readOnly': True, 'browserOperated': False, 'authenticationPerformed': False,
             'cookiesOrTokensSent': False, 'requestMethods': ['GET'], 'businessWritesPerformed': False,
             'providersActivated': False, 'listenersStarted': False, 'sqlShapeRequested': args.check_sql_shape,
             'authenticatedDigitalDeliveryOrBrowserAcceptance': False, 'fullProjectComplete': False}
    code = 0
    if args.used_inspection_photos:
        proof['release'] = 'used-inspection-photos'
    try:
        verify(proof, args.timeout_seconds, args.check_sql_shape, args.used_inspection_photos, selected_backend)
    except Exception as error:
        proof.update({'status': 'failed', 'failedAtUtc': stamp(), 'failureType': type(error).__name__,
                      'failure': str(error) if isinstance(error, VerificationError) else 'A bounded local verification operation failed; private response/configuration details are omitted.'})
        code = 1
    descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        json.dump(proof, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    print(json.dumps({'passed': proof['passed'], 'httpChecks': len(proof['httpChecks']),
                      'proof': str(output.relative_to(ROOT))}))
    return code


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (VerificationError, OSError, ValueError):
        raise SystemExit('Local business release verification did not start or could not write its new proof; no runtime or business settings were changed.')
