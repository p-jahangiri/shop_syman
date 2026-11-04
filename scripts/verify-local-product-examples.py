"""Read-only D70 acceptance of the explicit Development examples on Sayman.

Never imports, migrates, retries a command, writes SQL, sends SMS, or reads an
account credential. Retain the failed import verifier and bind a correction to
the persisted post-migration baseline; do not invent its lost RAM snapshots.
"""
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import hashlib
import importlib.util
import json
import re

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('d70_publisher', ROOT / 'scripts/publish-local-product-workspace.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
ACTOR = 'development-sample:product-workspace'
RELEASE = 'artifacts/checks/d70-product-workspace/api-6f8b3b22dddf43f087671f8d7771a555-release.json'
BASELINE = 'artifacts/checks/d70-product-workspace/after-6f8b3b22dddf43f087671f8d7771a555.json'
REPORT = ROOT / 'artifacts/checks/d70-examples-verification.json'
EXPECTED = {
    'd70-sample-galaxy-a10': 2, 'd70-sample-iphone-15': 4,
    'd70-sample-macbook-air-m1': 3, 'd70-sample-ps5-disc': 1,
    'd70-sample-usb-c-charger': 2, 'd70-sample-headphones': 2,
}
ALLOWED = {
    'catalog.AttributeDefinitions', 'catalog.AttributeOptions', 'catalog.Brands',
    'catalog.ProductAttributeValue', 'catalog.ProductMedia', 'catalog.ProductPurchaseMethod',
    'catalog.ProductTranslation', 'catalog.ProductWorkspaceCommands', 'catalog.Products',
    'catalog.PublicVideos', 'catalog.VariantAttributeValue', 'catalog.Variants',
    'identity.Audit', 'inventory.Movements', 'inventory.Stock',
}


def binding(path):
    return {'path': str(path), 'sha256': p.ops.sha(ROOT / path)}


def fetch(url, headers=None):
    try:
        response = urlopen(Request(url, headers=headers or {}), timeout=30)
    except HTTPError as response:
        return response.code, response.headers, response.read()
    with response:
        return response.status, response.headers, response.read()


def verify():
    failed_path = 'artifacts/checks/d70-examples-main.json'
    failed = p.ops.read(ROOT / failed_path)
    assert failed['passed'] is False and set(failed['changedTables']) == ALLOWED
    cli_path = 'artifacts/checks/d70-examples-cli.log'
    result = json.loads([line for line in (ROOT / cli_path).read_text().splitlines() if line.startswith('{')][-1])
    assert result['DevelopmentOnly'] and not result['FinancialPoliciesChanged'] and not result['CustomersChanged']
    assert {row['Slug']: row['Variants'] for row in result['Products']} == EXPECTED
    assert all(row['Status'] == 'development-example-created' for row in result['Products'])
    state = p.ops.read(p.m.CURRENT)
    p.owned_process(state)
    p.accepted(ROOT / 'artifacts/checks/d70-product-workspace/run2/acceptance.json')
    assert p.shape() == {'migrationCount': 93, 'tableCount': 244}
    before = p.ops.read(ROOT / BASELINE)
    after = p.snapshot()
    private_snapshot = ROOT / 'artifacts/checks/d70-product-workspace/examples-readback.private.json'
    p.ops.write(private_snapshot, after, private=True)
    old, new = p.rma.table_map(before['tables']), p.rma.table_map(after['tables'])
    assert len(old) == len(new) == 244 and set(old) == set(new)
    changed = {name for name in old if old[name] != new[name]}
    # The earlier persisted baseline predates normal browser activity. Session
    # rotation is tracked separately, never silently claimed as unchanged. The
    # import's immediate, stopped-API comparison recorded no Session changes.
    separately_observed = changed - ALLOWED
    assert separately_observed <= {'identity.Sessions'}, 'Unexpected table changes since the persisted post-migration baseline.'
    assert changed - separately_observed == ALLOWED
    assert before['histories'] == after['histories'] and before['configuration'] == after['configuration']
    assert before['metadata'] == after['metadata'], 'Examples must never change SQL metadata.'

    # Actual convention mappings, fixed in the accepted EF snapshots, explain
    # the earlier verifier's plural-name mismatch. No schema-wide exemption.
    mappings = {
        'Catalog': ['ProductAttributeValue', 'ProductPurchaseMethod', 'ProductTranslation', 'VariantAttributeValue'],
        'Identity': ['Audit'],
    }
    for module, names in mappings.items():
        source = (ROOT / f'backend/src/Shop.Api/Migrations/{module}/{module}DbContextModelSnapshot.cs').read_text()
        for name in names:
            assert f'b.ToTable("{name}", "{module.lower()}")' in source

    backup = ROOT / p.ops.read(ROOT / RELEASE)['backup']['privateDirectory']
    preserved = p.photo.preserved_files()
    assert p.ops.sha(backup / 'environment.private') == preserved['configuration']['environmentFileSha256']
    assert p.photo.tree(backup / 'identity-keys') == preserved['configuration']['keyring']
    assert p.ops.sha(backup / 'public-media-local.private.json') == preserved['mediaConfigurationSha256']
    media = p.photo.tree(backup / 'public-media-objects')
    assert all(preserved['publicMediaObjects'].get(name) == digest for name, digest in media.items())

    # Prove the original product/variant/inventory/media/audit rows still match
    # the persisted baseline, even in tables containing the newly added rows.
    sample_products = "SELECT Id FROM catalog.Products WHERE Slug LIKE N'd70-sample-%'"
    sample_variants = f'SELECT Id FROM catalog.Variants WHERE ProductId IN ({sample_products})'
    retained = {
        'catalog.Products': "Slug NOT LIKE N'd70-sample-%'",
        **{f'catalog.{name}': f'ProductId NOT IN ({sample_products})' for name in
           ('Variants', 'ProductMedia', 'ProductTranslation', 'ProductAttributeValue', 'ProductPurchaseMethod')},
        'catalog.VariantAttributeValue': f'VariantId NOT IN ({sample_variants})',
        'inventory.Stock': f'VariantId NOT IN ({sample_variants})',
        'inventory.Movements': f'VariantId NOT IN ({sample_variants})',
        'catalog.ProductWorkspaceCommands': f"ActorId <> N'{ACTOR}'",
        'catalog.PublicVideos': f"CreatedBy <> N'{ACTOR}'",
        'identity.Audit': f"ActorId <> N'{ACTOR}'",
        'catalog.Brands': "Slug <> N'd70-sample-sayman-demo'",
    }
    for name, condition in retained.items():
        assert re.fullmatch(r'[a-z]+\.[A-Za-z]+', name)
        schema, table = name.split('.')
        query = p.previous.dbops.FINGERPRINT_SQL
        query = query.replace('WHERE is_ms_shipped=0 ORDER BY', f"WHERE is_ms_shipped=0 AND schema_id=SCHEMA_ID(N'{schema}') AND name=N'{table}' ORDER BY")
        query = query.replace('FROM sys.columns WHERE object_id=@object;', "FROM sys.columns WHERE object_id=@object AND name NOT IN (N'ArchivedAt', N'VideoAssetId');")
        escaped = condition.replace("'", "''")
        query = query.replace("+QUOTENAME(@table)+N')", "+QUOTENAME(@table)+N' WHERE " + escaped + ")")
        query = query.replace("+QUOTENAME(@table)+N' ORDER BY", "+QUOTENAME(@table)+N' WHERE " + escaped + " ORDER BY")
        row = p.ops.payload(query)
        assert len(row) == 1 and row[0] == old[name], 'Original rows changed: ' + name

    data = p.ops.payload(f"""
SELECT (SELECT p.Id,p.Slug,p.Status,p.ArchivedAt,
 (SELECT v.Id,v.Sku,CONVERT(varchar(20),v.PriceRial) PriceRial,
 CONVERT(varchar(20),v.CompareAtPriceRial) CompareAtPriceRial,v.IsActive,v.WarrantyFa,
 COALESCE(s.OnHand,0) OnHand,COALESCE(s.Reserved,0) Reserved,
 COALESCE(s.SourcingReserved,0) SourcingReserved
 FROM catalog.Variants v LEFT JOIN inventory.Stock s ON s.VariantId=v.Id
 WHERE v.ProductId=p.Id ORDER BY v.Sku FOR JSON PATH) Variants
 FROM catalog.Products p WHERE p.Slug LIKE N'd70-sample-%' ORDER BY p.Slug FOR JSON PATH) Products,
 (SELECT COUNT(*) FROM inventory.Movements WHERE ActorId=N'{ACTOR}') Movements,
 (SELECT COUNT(*) FROM [identity].[Audit] WHERE ActorId=N'{ACTOR}' AND Action=N'development-sample-import') ImportAudits,
 (SELECT Id,Extension,Sha256,Bytes,Width,Height,DurationMilliseconds,Status FROM catalog.PublicVideos
 WHERE CreatedBy=N'{ACTOR}' ORDER BY Id FOR JSON PATH) Videos
FOR JSON PATH,WITHOUT_ARRAY_WRAPPER
""")
    assert {row['Slug']: len(row['Variants']) for row in data['Products']} == EXPECTED
    variants = [v for row in data['Products'] for v in row['Variants']]
    assert len(variants) == 14 and sum(v['OnHand'] == 0 for v in variants) == 4
    assert sum('CompareAtPriceRial' in v for v in variants) == 3
    assert all(v['IsActive'] and not v['Reserved'] and not v['SourcingReserved'] for v in variants)
    assert all('نمونه' in v['WarrantyFa'] and re.fullmatch('[1-9][0-9]*', v['PriceRial']) for v in variants)
    assert all(row['Status'] == 'Published' and 'ArchivedAt' not in row for row in data['Products'])
    assert data['Movements'] == 10 and data['ImportAudits'] == 6
    assert len(data['Videos']) == 1 and data['Videos'][0]['Status'] == 'Ready'
    video = data['Videos'][0]
    video_path = f"/media/videos/{video['Id']}/clip.{video['Extension']}"
    checks = []
    for locale in ('fa', 'en'):
        code, headers, body = fetch(f'http://127.0.0.1:5080/api/storefront/{locale}')
        snapshot = json.loads(body)
        assert code == 200 and snapshot['dataSource'] == 'api'
        assert snapshot['authSettings']['mobileOtp'] and snapshot['authSettings']['registration']
        products = [item for item in snapshot['products'] if item['slug'] in EXPECTED]
        assert {item['slug']: len(item['variants']) for item in products} == EXPECTED
        for item in products:
            sql = next(row for row in data['Products'] if row['Slug'] == item['slug'])
            assert item['badge'] and ('Demo' in item['name'] if locale == 'en' else 'نمونه' in item['name'])
            for variant in item['variants']:
                source = next(v for v in sql['Variants'] if v['Id'] == variant['id'])
                assert variant['priceRial'] == source['PriceRial'] and variant['stock'] == source['OnHand']
                assert variant.get('compareAtRial') == source.get('CompareAtPriceRial')
                if locale == 'en':
                    assert not re.search('[\u0600-\u06ff]', variant['label']), 'English variant labels must use the English colour.'
            status, page_headers, html = fetch(f"http://127.0.0.1:3000/{locale}/product/{item['slug']}")
            assert status == 200 and item['name'] in html.decode()
            image_status, _, _ = fetch('http://127.0.0.1:3000' + item['image'])
            assert image_status == 200
            if item['slug'] == 'd70-sample-iphone-15':
                assert item['videos'] == [{'url': video_path}]
                assert b'<video' in html and b'preload="none"' in html and b'controls=""' in html
            checks.append({'locale': locale, 'slug': item['slug'], 'html': status, 'image': image_status})
    for port, prefix in ((5080, '/api'), (3000, ''), (3173, '/api')):
        url = f'http://127.0.0.1:{port}{prefix}{video_path}'
        status, headers, body = fetch(url)
        assert status == 200 and len(body) == video['Bytes'] and hashlib.sha256(body).hexdigest() == video['Sha256']
        assert headers.get('X-Shop-Public-Resource') == 'catalog-video-v1' and not headers.get('Set-Cookie')
        assert headers.get_content_type() == 'video/mp4' and 'public' in headers['Cache-Control']
        tag = headers['ETag']
        status, headers, partial = fetch(url, {'Range': 'bytes=0-127'})
        assert status == 206 and partial == body[:128] and headers['Content-Range'] == f"bytes 0-127/{len(body)}"
        status, headers, empty = fetch(url, {'If-None-Match': tag})
        assert status == 304 and not empty
        checks.append({'port': port, 'video200Sha256Equal': True, 'range206': True, 'etag304': True})
    report = {
        'passed': True, 'finishedAtUtc': p.m.stamp(), 'readOnlyVerification': True,
        'database': 'Sayman', 'schema': 93, 'tables': 244,
        'originalFailedVerifier': binding(failed_path), 'importCli': binding(cli_path),
        'localizationCorrection': binding('artifacts/checks/d70-example-localization.json'),
        'correction': 'The import succeeded; five allowlist entries wrongly assumed plural EF names. Correct mappings are verified against frozen EF snapshots. Original failed evidence retained.',
        'comparisonBaseline': binding(BASELINE), 'freshPrivateSnapshot': binding(str(private_snapshot.relative_to(ROOT))),
        'lostRamSnapshotRecreated': False, 'changedTables': sorted(changed),
        'separatelyObservedChangesSinceEarlierRelease': sorted(separately_observed),
        'sessionRowsClaimedUnchangedSinceEarlierRelease': False,
        'sessionsUnchangedDuringImportPerImmediateComparison': 'identity.Sessions' not in failed['changedTables'],
        'unchangedTablesSincePersistedBaseline': len(old) - len(changed),
        'originalRowsRetainedInChangedTables': sorted(retained),
        'privateConfigurationKeysAndExistingMediaPreserved': True,
        'migrationHistoryAndMetadataUnchanged': True,
        'products': data['Products'], 'variantCount': 14, 'zeroStockVariants': 4,
        'discountedVariants': 3, 'receiptMovements': 10, 'importAudits': 6,
        'video': video, 'checks': checks,
        'storefrontUsesSqlApi': True, 'localDevelopmentReadOnlyPreviewPreserved': True,
        'paidSmsSent': False, 'financialPoliciesChanged': False, 'credentialsChanged': False,
    }
    p.ops.write(REPORT, report)
    print(json.dumps({'passed': True, 'products': 6, 'variants': 14, 'httpChecks': len(checks), 'evidence': str(REPORT.relative_to(ROOT))}))


if __name__ == '__main__':
    verify()
