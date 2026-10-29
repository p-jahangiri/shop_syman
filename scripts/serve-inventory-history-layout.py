"""Explicit read-only component layout QA; never authenticates or touches SQL.

The standalone page mounts the actual admin InventoryHistory component with
synthetic public-looking rows. This is not an authenticated admin integration.
Only owned loopback listeners and the created temporary directory are cleaned.
"""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from datetime import datetime, timezone, timedelta
from urllib.parse import urlsplit, parse_qs
import json
import os
import re
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time

stock_surface = sys.argv[1:] == ['--explicit-stock-page-fixture']
if sys.argv[1:] not in [['--explicit-readonly-fixture'], ['--explicit-stock-page-fixture']]:
    raise SystemExit('Use --explicit-readonly-fixture for isolated layout QA only.')
root = Path(__file__).resolve().parent.parent
for port in [3175, 5181]:
    with socket.socket() as probe:
        if probe.connect_ex(('127.0.0.1', port)) == 0:
            raise SystemExit(f'QA port {port} is already owned; refusing to replace it.')
control = root / 'tmp/inventory-history-layout-control.json'
if control.exists():
    raise SystemExit('A prior layout control file exists; inspect its ownership first.')
control.write_text(json.dumps({'fixture': 'inventory-history-readonly', 'surface':'stock' if stock_surface else 'history', 'mode': 'normal'}))
calls = []
sample_time = datetime(2026, 10, 23, 12, tzinfo=timezone.utc)
rows = [{'id': str(9007199254741100-i), 'variantId': 'variant-demo', 'delta': 1 if i % 2 == 0 else -1,
         'balance': 200-i, 'reason': 'رسید نمونهٔ انبار' if i % 2 == 0 else 'خروج نمونه برای بررسی تاریخچه',
         'actorId': 'layout-staff', 'requestId': f'layout-request-{i}',
         'at': (sample_time-timedelta(minutes=i)).isoformat()} for i in range(121)]

stock_rows = [{'variantId': f'v-demo{i:03}', 'productId': 'p-demo', 'sku': f'SKU-{i:03}', 'nameFa': f'کالای نمونه {i}', 'nameEn': f'Layout product {i}', 'isActive': i < 100, 'productStatus': 'Draft' if i == 0 else 'Published', 'onHand': 0 if i == 0 else 7, 'reserved': 0 if i == 0 else 2, 'available': 0 if i == 0 else 5, 'version': None if i == 0 else 'AAAAAAAAAAE='} for i in range(101)]

class Fixture(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlsplit(self.path)
        calls.append({'method': 'GET', 'path': self.path, 'hasAuthorization': bool(self.headers.get('Authorization'))})
        mode = json.loads(control.read_text()).get('mode')
        status, data = 404, {'title': 'layout_fixture_only'}
        if path.path == '/api/admin/inventory/movements':
            status = 503 if mode == 'error' else 200
            filters = parse_qs(path.query)
            selected = rows
            if filters.get('variantId', [''])[0] not in ['', 'variant-demo'] or mode == 'empty':
                selected = []
            direction = filters.get('direction', ['all'])[0]
            if direction != 'all':
                selected = [row for row in selected if (row['delta'] > 0) == (direction == 'in')]
            for key, after in [('fromAt', True), ('toAt', False)]:
                if filters.get(key):
                    bound = datetime.fromisoformat(filters[key][0].replace('Z', '+00:00'))
                    selected = [row for row in selected if (datetime.fromisoformat(row['at']) >= bound if after else datetime.fromisoformat(row['at']) < bound)]
            cursor = filters.get('cursor', ['page_0'])[0]
            match = re.fullmatch(r'page_(\d+)', cursor)
            offset = int(match[1]) if match else 0
            data = {'version': 1, 'pageSize': 50, 'items': selected[offset:offset+50],
                    'nextCursor': f'page_{offset+50}' if offset+50 < len(selected) else None}
            if mode == 'schema':
                data['privateCustomer'] = 'must-not-render'
            if mode == 'error':
                data = {'title': 'layout_fixture_unavailable'}
        if stock_surface and path.path == '/api/admin/inventory/variants':
            filters = parse_qs(path.query)
            selected = stock_rows
            term = filters.get('query', [''])[0].strip().casefold()
            if term:
                selected = [row for row in selected if term in (row['sku']+' '+row['nameFa']+' '+row['nameEn']).casefold()]
            active = filters.get('active', ['all'])[0]
            if active != 'all':
                selected = [row for row in selected if row['isActive'] == (active == 'true')]
            cursor = filters.get('cursor', ['stock_0'])[0]
            match = re.fullmatch(r'stock_(\d+)', cursor)
            offset = int(match[1]) if match else 0
            status = 503 if mode == 'stock-error' else 200
            data = {'version':1,'pageSize':50,'items':selected[offset:offset+50], 'nextCursor':f'stock_{offset+50}' if offset+50 < len(selected) else None}
            if mode == 'stock-schema':
                data['privateCustomer'] = 'must-not-render'
            if mode == 'stock-error':
                data = {'title':'layout_fixture_unavailable'}
        raw = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        try:
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_POST(self):
        self.send_error(405)

    def log_message(self, *_):
        pass


def interrupt(*_):
    raise SystemExit(0)


signal.signal(signal.SIGTERM, interrupt)
signal.signal(signal.SIGINT, interrupt)
server = ThreadingHTTPServer(('127.0.0.1', 5181), Fixture)
server.daemon_threads = True
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
child = None
try:
    with tempfile.TemporaryDirectory(prefix='inventory-history-layout-', dir=root/'tmp') as directory:
        directory = Path(directory)
        (directory/'index.html').write_text('<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sayman inventory read-only layout QA</title><div id="root"></div><script type="module" src="/main.tsx"></script></html>')
        (directory/'main.tsx').write_text("""import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {InventoryHistory} from '../../apps/admin/src/inventory-history';
import '../../apps/admin/src/style.css';
const client=new QueryClient();
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><main style={{padding:16,maxWidth:1200,margin:'auto'}}><p role="note">پیش‌نمایش مستقل تاریخچهٔ انبار · دادهٔ نمونه، بدون ورود و SQL</p><InventoryHistory/></main></QueryClientProvider>);
""")
        if stock_surface:
            entry = (directory/'main.tsx').read_text().replace("import {InventoryHistory} from '../../apps/admin/src/inventory-history';", "import {InventoryPage} from '../../apps/admin/src/inventory';").replace('<InventoryHistory/>','<InventoryPage writable={false}/>')
            (directory/'main.tsx').write_text(entry)
        config = "import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';export default defineConfig({root:" + json.dumps(str(directory)) + ",plugins:[react()],publicDir:false,server:{host:'127.0.0.1',port:3175,strictPort:true,fs:{allow:[" + json.dumps(str(root)) + "]},proxy:{'/api':{target:'http://127.0.0.1:5181',changeOrigin:true}}}});"
        (directory/'vite.config.mts').write_text(config)
        child = subprocess.Popen(['node', str(root/'node_modules/vite/bin/vite.js'), '--config', str(directory/'vite.config.mts')], cwd=root, start_new_session=True)
        while child.poll() is None:
            time.sleep(.25)
        if child.returncode:
            raise SystemExit(child.returncode)
finally:
    if child is not None and child.poll() is None:
        os.killpg(child.pid, signal.SIGTERM)
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)
    control.unlink(missing_ok=True)
    (root/('artifacts/checks/inventory-page-layout-http.json' if stock_surface else 'artifacts/checks/inventory-history-layout-http.json')).write_text(json.dumps({'scope': 'explicit read-only component layout fixture; no authentication or SQL acceptance', 'calls': calls,
        'credentialHeaders': sum(call['hasAuthorization'] for call in calls), 'cleanup': 'owned child terminal, fixture closed and private-free control removed'}, ensure_ascii=False, indent=2)+'\n')
