"""Project the separately licensed, pinned geography data; never fetch at build/runtime."""
from pathlib import Path
import json
import hashlib
ROOT = Path(__file__).resolve().parent.parent
source = ROOT / 'data/iran-geography'
output = ROOT / 'apps/storefront/public/data'
result = {'version': 'iran-1404-v3.1.2', 'sourceYear': 1404}
for kind, parents, expected in [('provinces', [], 31), ('counties', ['province_id'], 484), ('cities', ['province_id', 'county_id'], 1672)]:
    rows = json.loads((source / (kind + '.json')).read_text())
    assert len(rows) == expected and len({r['id'] for r in rows}) == expected
    result[kind] = sorted([[str(r['id']), r['name'], *[str(r[p]) for p in parents]] for r in rows], key=lambda x: x[0])
centers = json.loads((source / 'county-centers.json').read_text())
result['centers'] = [[str(r['county_id']), r['latitude'], r['longitude']] for r in centers]
output.mkdir(exist_ok=True)
raw = (json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
(output / 'iran-geography.v1.json').write_bytes(raw)
backend = ROOT / 'backend/src/Shop.Modules.Sales/Data'
backend.mkdir(exist_ok=True)
(backend / 'iran-geography.v1.json').write_bytes(raw)
(output / 'iran-geography-LICENSE.txt').write_bytes((source / 'LICENSE').read_bytes())
meta = {'upstream': 'https://github.com/sajaddp/list-of-cities-in-Iran', 'commit': (source / 'upstream-commit.txt').read_text().strip(), 'version': '3.1.2', 'sourceYear': 1404, 'license': 'GPL-3.0 (geography); CC BY 4.0 (GeoNames centers)', 'modifiedOn': '2026-10-30', 'transformation': 'Standalone data projection: decimal-string identifiers and explicit parent references; all rows retained. No upstream software copied.', 'correspondingSource': 'https://github.com/sajaddp/list-of-cities-in-Iran/tree/' + (source / 'upstream-commit.txt').read_text().strip(), 'coordinatesSource': 'https://www.geonames.org/', 'sha256': hashlib.sha256(raw).hexdigest(), 'counts': {k: len(result[k]) for k in ['provinces', 'counties', 'cities']}}
meta['licenseText'] = (source / 'LICENSE').read_text()
meta['leafletLicense'] = (ROOT / 'node_modules/leaflet/LICENSE').read_text()
meta['coordinateAttribution'] = 'GeoNames, https://www.geonames.org/, CC BY 4.0, https://creativecommons.org/licenses/by/4.0/; county-center subset from pinned upstream.'
for path in [output / 'iran-geography-source.json', source / 'projection.json']:
    path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'counts': meta['counts'], 'bytes': len(raw), 'sha256': meta['sha256']}))
