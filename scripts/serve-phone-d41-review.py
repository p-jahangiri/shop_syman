"""Serve only the private phone review build; never stop or replace another runtime."""
from pathlib import Path
import json, os, shutil

root = Path(__file__).resolve().parent.parent
report = json.loads((root / 'tmp/phone-d41-review-build.json').read_text())
directory = report['directory']
if report['exitCode'] != 0 or not directory.startswith('.next-qa-phones-') or '/' in directory:
    raise SystemExit('A successful private phone build is required.')
app = root / 'apps/storefront'
runtime = app / directory / 'standalone/apps/storefront'
if not (runtime / 'server.js').is_file():
    raise SystemExit('Standalone entry is missing.')
shutil.copytree(app / directory / 'static', runtime / directory / 'static', dirs_exist_ok=True)
shutil.copytree(app / 'public', runtime / 'public', dirs_exist_ok=True)
environment = os.environ.copy()
environment.update(HOSTNAME='127.0.0.1', PORT='3110', SHOP_ISOLATED_BUILD='1',
                   SHOP_QA_DIRECTORY=directory, SHOP_DATA_MODE='api',
                   SHOP_API_URL='http://127.0.0.1:5184', SHOP_PUBLIC_URL='http://sayman-d41-ui.localhost:3110',
                   NEXT_TELEMETRY_DISABLED='1')
environment.pop('SHOP_ENABLE_PREVIEW', None)
(root / 'tmp/phone-d41-review-storefront.json').write_text(json.dumps({
    'directory': directory, 'runtime': str(runtime), 'pid': os.getpid(), 'port': 3110,
    'apiPort': 5184, 'mainChanged': False}, indent=2) + '\n')
os.execvpe('node', ['node', str(runtime / 'server.js')], environment)
