"""Build the phone review in a private directory, without changing live runtimes."""
from pathlib import Path
import json, os, shutil, subprocess, time, uuid

root = Path(__file__).resolve().parent.parent
app = root / 'apps/storefront'
# Recent isolated phone builds occupy under 200 MiB. Keep a 512 MiB
# floor without deleting retained runtimes or other chats' QA artifacts.
if shutil.disk_usage(root).free < 512 * 1024**2:
    raise SystemExit('Needs 512 MiB free space.')
directory = '.next-qa-phones-' + uuid.uuid4().hex
saved = {p: p.read_bytes() if p.exists() else None for p in [app / 'next-env.d.ts', app / 'tsconfig.json']}
environment = os.environ.copy()
environment.update(SHOP_ISOLATED_BUILD='1', SHOP_QA_DIRECTORY=directory,
                   NEXT_TELEMETRY_DISABLED='1', SHOP_DATA_MODE='api',
                   SHOP_API_URL='http://127.0.0.1:5184', SHOP_PUBLIC_URL='http://sayman-d41-ui.localhost:3110')
environment.pop('SHOP_ENABLE_PREVIEW', None)
start = time.time()
try:
    result = subprocess.run(['npm', 'run', 'build', '--workspace', '@sayman/storefront'], cwd=root, env=environment)
    report = {'directory': directory, 'exitCode': result.returncode,
              'elapsedSeconds': round(time.time() - start, 2), 'mainChanged': False,
              'api': 'http://127.0.0.1:5184', 'publicUrl': 'http://sayman-d41-ui.localhost:3110'}
    (root / 'tmp/phone-d41-review-build.json').write_text(json.dumps(report, indent=2) + '\n')
    raise SystemExit(result.returncode)
finally:
    for p, data in saved.items():
        if data is None:
            p.unlink(missing_ok=True)
        else:
            p.write_bytes(data)
