"""Serve only the isolated Next QA artifact on a separate localhost origin.

Use preview explicitly for layout-only QA, or api with a separately owned
loopback QA API on port 5181. Never points at the main API or real owner account.
"""
from pathlib import Path
import os
import shutil
import sys

mode = sys.argv[1] if len(sys.argv) == 2 else ''
if mode not in ['preview', 'api']:
    raise SystemExit('Choose preview or api explicitly.')
root = Path(__file__).resolve().parent.parent
app = root / 'apps/storefront'
runtime = app / '.next-qa/standalone/apps/storefront'
if not (runtime / 'server.js').is_file():
    raise SystemExit('Run scripts/build-storefront-isolated.py first.')
shutil.copytree(app / '.next-qa/static', runtime / '.next-qa/static', dirs_exist_ok=True)
shutil.copytree(app / 'public', runtime / 'public', dirs_exist_ok=True)
environment = os.environ.copy()
environment.update({'HOSTNAME': '127.0.0.1', 'PORT': '3105', 'SHOP_ISOLATED_BUILD': '1',
                    'SHOP_DATA_MODE': mode, 'SHOP_API_URL': 'http://127.0.0.1:5181',
                    'SHOP_PUBLIC_URL': 'http://sayman-orders-ui.localhost:3105',
                    'NEXT_TELEMETRY_DISABLED': '1'})
if mode == 'preview':
    environment['SHOP_ENABLE_PREVIEW'] = 'true'
else:
    environment.pop('SHOP_ENABLE_PREVIEW', None)
os.execvpe('node', ['node', str(runtime / 'server.js')], environment)
