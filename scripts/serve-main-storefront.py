"""Run the single canonical local storefront selected by the current descriptor."""
from pathlib import Path
import hashlib, json, os

root = Path(__file__).resolve().parent.parent
descriptor = root / 'tmp/storefront-runtime-current.json'
state = json.loads(descriptor.read_text())
if state.get('runtimeLayout') != 'standalone' or state.get('port') != 3000 or state.get('api') != 'http://127.0.0.1:5080':
    raise SystemExit('Expected the canonical local storefront descriptor.')
runtime = (root / state['runtimeDirectory']).resolve()
if not runtime.is_relative_to(root / 'tmp'):
    raise SystemExit('Runtime must be inside the shop workspace tmp directory.')
entry = runtime / 'apps/storefront/server.js'
if hashlib.sha256(entry.read_bytes()).hexdigest() != state['serverSha256']:
    raise SystemExit('Storefront entry differs from the selected build.')
if state.get('artifactManifest'):
    manifest_path = root / state['artifactManifest']
    if hashlib.sha256(manifest_path.read_bytes()).hexdigest() != state['artifactManifestSha256']:
        raise SystemExit('Storefront artifact manifest changed.')
    manifest = json.loads(manifest_path.read_text())
    for relative, expected in manifest['artifacts'].items():
        file = (runtime / relative).resolve()
        if not file.is_relative_to(runtime) or hashlib.sha256(file.read_bytes()).hexdigest() != expected:
            raise SystemExit('Storefront artifact differs from the selected build.')
environment = os.environ.copy()
environment.update(HOSTNAME='127.0.0.1', PORT='3000', SHOP_DATA_MODE='api',
                   SHOP_API_URL='http://127.0.0.1:5080', SHOP_PUBLIC_URL='http://127.0.0.1:3000',
                   NEXT_TELEMETRY_DISABLED='1')
environment.pop('SHOP_ENABLE_PREVIEW', None)
state['pid'] = os.getpid()
descriptor.write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n')
os.execvpe('node', ['node', str(entry)], environment)
