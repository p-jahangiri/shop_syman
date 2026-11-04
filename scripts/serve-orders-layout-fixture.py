"""Explicit, loopback-only public metadata fixture for logged-out orders UI QA.

This never authenticates a user, accepts an order, sends payment, or accesses SQL.
It cannot validate the connected order workflow. Run only with
--explicit-layout-fixture; use the real SQL harness for authenticated acceptance.
The control file can select auth=guest or unavailable to exercise error recovery.
"""
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
import copy
import json
import signal
import subprocess
import sys
import threading

if sys.argv[1:] != ['--explicit-layout-fixture']:
    raise SystemExit('Requires --explicit-layout-fixture. No authentication or order success is provided.')
root = Path(__file__).resolve().parent.parent
qa = root / 'tmp/orders-layout-qa'
qa.mkdir(exist_ok=True)
control = qa / 'control.json'
control.write_text('{"auth":"guest"}\n')
source = """import {storefrontSnapshot} from './apps/storefront/lib/data/fixtures.ts';
import {localizeData} from './apps/storefront/lib/navigation/i18n.ts';
process.stdout.write(JSON.stringify(Object.fromEntries(['fa','en'].map(locale=>[locale,localizeData(storefrontSnapshot,locale)]))));"""
snapshots = json.loads(subprocess.check_output(['node', '--experimental-strip-types', '--input-type=module', '-e', source], cwd=root))
counts = Counter()
guard = threading.Lock()
stopping = threading.Event()

class LayoutFixture(BaseHTTPRequestHandler):
    def respond(self, status, value):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'private, no-store')
        self.send_header('X-Sayman-QA', 'logged-out-layout-fixture')
        self.end_headers()
        self.wfile.write(json.dumps(value, ensure_ascii=False).encode())

    def handle_api(self):
        path = urlsplit(self.path)
        with guard:
            counts[self.command + ' ' + path.path] += 1
        parts = path.path.strip('/').split('/')
        if self.command == 'GET' and len(parts) == 3 and parts[:2] == ['api', 'storefront'] and parts[2] in snapshots:
            data = copy.deepcopy(snapshots[parts[2]])
            data.update({'locale': parts[2], 'dataSource': 'api', 'isPreview': True, 'products': []})
            fa = parts[2] == 'fa'
            data['site']['name'] = 'سایمان · آزمون رابط' if fa else 'Sayman · Layout QA'
            data['site']['announcement'] = 'آزمون رابط با دادهٔ عمومی نمونه؛ ورود و ثبت سفارش موفق ندارد' if fa else 'Public sample layout QA — no successful sign-in or orders'
            data['authSettings'] = {'mobileOtp': False, 'emailPassword': True, 'usernamePassword': True, 'registration': False, 'passwordReset': False}
            return self.respond(200, data)
        if path.path == '/api/auth/refresh' and self.command == 'POST':
            try:
                mode = json.loads(control.read_text()).get('auth')
            except (OSError, ValueError):
                mode = 'unavailable'
            return self.respond(401 if mode == 'guest' else 503, {'title': 'invalid_credentials' if mode == 'guest' else 'unavailable'})
        if path.path.startswith('/api/auth/'):
            return self.respond(401, {'title': 'invalid_credentials'})
        if self.command == 'GET' and path.path in ['/api/cart/fa', '/api/cart/en']:
            return self.respond(200, {'schemaVersion': 1, 'locale': parts[-1], 'version': None, 'lines': [], 'subtotalRial': '0', 'hasIssues': False})
        return self.respond(503, {'title': 'layout_fixture_operation_unavailable'})

    do_GET = handle_api
    do_POST = handle_api

    def log_message(self, *_):
        pass  # Never log input, cookies, bearer headers or contact details.

server = ThreadingHTTPServer(('127.0.0.1', 5181), LayoutFixture)
server.timeout = .5
signal.signal(signal.SIGTERM, lambda *_: stopping.set())
signal.signal(signal.SIGINT, lambda *_: stopping.set())
print('Explicit logged-out layout fixture: http://127.0.0.1:5181; no SQL or successful authentication.', flush=True)
try:
    while not stopping.is_set():
        server.handle_request()
finally:
    server.server_close()
    with guard:
        (qa / 'requests.json').write_text(json.dumps(dict(counts), indent=2) + '\n')
    print('Layout fixture stopped; only method/path request counts were saved.', flush=True)
