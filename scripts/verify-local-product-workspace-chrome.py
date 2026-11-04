"""Read-only SQL/HTTP/source proof after owner-authorized D70 Chrome QA.

Does not log in, seed, migrate, restart, send SMS, or alter SQL. Browser
observations are recorded separately, never inferred from these HTTP checks.
"""
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import hashlib
import importlib.util
import json
import re

ROOT = Path(__file__).resolve().parent.parent
EVIDENCE = ROOT / 'artifacts/checks/d70-private-chrome'
spec = importlib.util.spec_from_file_location('d70_chrome_helpers', ROOT / 'scripts/publish-local-product-workspace.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


def binding(path):
    path = Path(path)
    return {'path': str(path.relative_to(ROOT)), 'sha256': p.ops.sha(path)}


def fetch(port, path, headers=None):
    try:
        response = urlopen(Request(f'http://127.0.0.1:{port}{path}', headers=headers or {}), timeout=30)
    except HTTPError as response:
        return response.code, response.headers, response.read()
    with response:
        return response.status, response.headers, response.read()


def main():
    p.accepted(ROOT / 'artifacts/checks/d70-product-workspace/run2/acceptance.json')
    assert p.shape() == {'migrationCount': 93, 'tableCount': 244}
    before = p.ops.read(EVIDENCE / 'before-mutations.private.json')
    after = p.snapshot()
    p.ops.write(EVIDENCE / 'final-readback.private.json', after, private=True)
    old, new = p.rma.table_map(before['tables']), p.rma.table_map(after['tables'])
    changed = {name for name in old if old[name] != new[name]}
    expected = {'catalog.ProductMedia', 'catalog.Products', 'catalog.ProductWorkspaceCommands',
                'catalog.PublicImages', 'catalog.PublicImageVariants', 'catalog.PublicVideos',
                'catalog.Variants', 'identity.Audit'}
    assert changed - {'identity.Sessions'} == expected
    assert before['histories'] == after['histories']
    assert before['configuration'] == after['configuration']
    assert before['metadata'] == after['metadata']

    previous = p.ops.read(ROOT / 'artifacts/checks/d70-examples-verification.json')
    checks = []
    for locale in ('fa', 'en'):
        code, _, raw = fetch(5080, '/api/storefront/' + locale)
        snapshot = json.loads(raw)
        assert code == 200 and snapshot['dataSource'] == 'api'
        assert snapshot['authSettings']['mobileOtp'] and snapshot['authSettings']['registration']
        for source in previous['products']:
            item = next(v for v in snapshot['products'] if v['slug'] == source['Slug'])
            assert len(item['variants']) == len(source['Variants'])
            for variant in item['variants']:
                old_variant = next(v for v in source['Variants'] if v['Id'] == variant['id'])
                assert variant['priceRial'] == old_variant['PriceRial']
                assert variant.get('compareAtRial') == old_variant.get('CompareAtPriceRial')
                assert variant['stock'] == old_variant['OnHand']
            checks.append({'locale': locale, 'slug': source['Slug'], 'pricesAndStockUnchanged': True})
        sample = next(v for v in snapshot['products'] if v['slug'] == 'd70-sample-galaxy-a10')
        assert sample['images'] == ['/products/phone-titanium.svg', '/media/catalog/86277387203549059605d1efe459f9a0/card.webp']
        assert sample['videos'] == [{'url': '/media/videos/f7cf7fa421b0430da6962018d7401403/clip.mp4',
                                      'variantId': 'd39371ebc9c1471585263dd87e7a30d2'}]
        code, _, html = fetch(3000, f'/{locale}/product/d70-sample-galaxy-a10')
        assert code == 200 and sample['name'] in html.decode()

    video = p.ops.payload("""
SELECT Id,Extension,Sha256,Bytes,Width,Height,DurationMilliseconds,Status
FROM catalog.PublicVideos WHERE Id='f7cf7fa421b0430da6962018d7401403'
FOR JSON PATH,WITHOUT_ARRAY_WRAPPER
""")
    assert video['Status'] == 'Ready' and video['DurationMilliseconds'] == 4000
    for port, prefix in ((5080, '/api'), (3000, ''), (3173, '/api')):
        path = prefix + '/media/videos/' + video['Id'] + '/clip.mp4'
        code, headers, body = fetch(port, path)
        assert code == 200 and len(body) == video['Bytes']
        assert hashlib.sha256(body).hexdigest() == video['Sha256']
        assert headers.get('X-Shop-Public-Resource') == 'catalog-video-v1'
        assert not headers.get('Set-Cookie')
        tag = headers['ETag']
        code, partial_headers, part = fetch(port, path, {'Range': 'bytes=0-127'})
        assert code == 206 and part == body[:128]
        assert partial_headers['Content-Range'] == f'bytes 0-127/{len(body)}'
        code, _, body304 = fetch(port, path, {'If-None-Match': tag})
        assert code == 304 and not body304
        image_path = prefix + '/media/catalog/86277387203549059605d1efe459f9a0/card.webp'
        code, headers, image = fetch(port, image_path)
        assert code == 200 and headers.get_content_type() == 'image/webp' and image
        checks.append({'port': port, 'video200Sha256Equal': True, 'range206': True,
                       'etag304': True, 'uploadedImage200': True})

    build = p.ops.read(ROOT / 'tmp/frontend-quality-build.json')
    assert build['passed'] and build['targets'] == ['admin'] and build['sourceStableDuringBuild']
    assert build['run'] == 'b0d7cbe34d5c4a1ab413fc5e04fe3f19'
    assert all(p.ops.sha(ROOT / name) == digest for name, digest in build['source'].items())
    p.ops.write(EVIDENCE / 'final-admin-build.json', build)
    tests = (ROOT / 'artifacts/checks/d70-csp-admin-tests.log').read_text()
    for key, value in [('tests', 397), ('pass', 397), ('fail', 0), ('skipped', 0), ('cancelled', 0)]:
        assert re.search(r'^# ' + key + ' ' + str(value) + '$', tests, re.M)
    report = {'passed': True, 'finishedAtUtc': p.m.stamp(), 'readOnlyVerification': True,
              'schema': 93, 'tables': 244, 'changedTablesDuringAuthorizedBrowserQa': sorted(changed),
              'unchangedTables': len(old) - len(changed), 'sessionsTrackedSeparately': True,
              'configurationKeysHistoryMetadataUnchanged': True, 'samplePricesAndStockUnchanged': True,
              'newGuiUploadedVideo': video, 'httpChecks': checks, 'adminTestsPassed': 397,
              'build': binding(EVIDENCE / 'final-admin-build.json'),
              'snapshot': binding(EVIDENCE / 'final-readback.private.json'),
              'browserAcceptanceInferredFromHttp': False, 'fullSqlRerun': False,
              'newMigrations': 0, 'credentialsChanged': False, 'paidSmsSent': False}
    p.ops.write(EVIDENCE / 'sql-http-source-acceptance.json', report)
    print(json.dumps({'passed': True, 'unchangedTables': report['unchangedTables'], 'httpChecks': len(checks)}))


if __name__ == '__main__':
    main()
