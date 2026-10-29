"""Build the current Next source into .next-qa without replacing the live .next.

No SQL migration, data mutation, Docker or deployment is performed. API mode
allows public reads from the explicit API origin with preview disabled. The
generated Next TypeScript setup files are restored after this isolated build.
Only this script's process group is stopped if host free space falls below 1 GiB.
"""
from pathlib import Path
import argparse
import os
import shutil
import signal
import subprocess
import time
from urllib.parse import urlsplit

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--mode',choices=['preview','api'],default='preview')
parser.add_argument('--api-url',default='http://127.0.0.1:5080')
arguments=parser.parse_args()
if arguments.mode=='api':
    origin=urlsplit(arguments.api_url)
    if origin.scheme not in ['http','https'] or not origin.hostname or origin.username or origin.password or origin.query or origin.fragment or origin.path not in ['', '/']:
        parser.error('--api-url must be an HTTP(S) API origin without credentials, path or query.')

root = Path(__file__).resolve().parent.parent
app = root / 'apps/storefront'
gib = 1024 ** 3
if shutil.disk_usage(root).free < 2 * gib:
    raise SystemExit('Isolated Next build needs at least 2 GiB of free host space.')

generated = {p: p.read_bytes() if p.exists() else None for p in
             [app / 'next-env.d.ts', app / 'tsconfig.json']}
environment = os.environ.copy()
environment.update({'SHOP_ISOLATED_BUILD': '1', 'NEXT_TELEMETRY_DISABLED': '1',
                    'SHOP_DATA_MODE': arguments.mode})
if arguments.mode=='api':
    environment['SHOP_API_URL']=arguments.api_url.rstrip('/')
    environment.pop('SHOP_ENABLE_PREVIEW',None)
else:
    environment['SHOP_ENABLE_PREVIEW']='true'
process = None
def interrupted(_signal, _frame):
    raise SystemExit(130)
signal.signal(signal.SIGTERM, interrupted)
signal.signal(signal.SIGINT, interrupted)
try:
    process = subprocess.Popen(['npm', 'run', 'build', '--workspace', '@sayman/storefront'],
                               cwd=root, env=environment, start_new_session=True)
    while process.poll() is None:
        if shutil.disk_usage(root).free < gib:
            print('Stopping this isolated Next build: host free space fell below 1 GiB.', flush=True)
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            raise SystemExit(3)
        time.sleep(1)
    raise SystemExit(process.returncode)
finally:
    if process is not None and process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
    for path, contents in generated.items():
        if contents is None:
            path.unlink(missing_ok=True)
        else:
            path.write_bytes(contents)
