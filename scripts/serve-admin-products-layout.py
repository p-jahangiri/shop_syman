"""Explicit read-only product list/CMS picker component QA, no auth or SQL."""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
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

if sys.argv[1:] != ['--explicit-readonly-fixture']:
    raise SystemExit('Use --explicit-readonly-fixture; this never logs in or writes products/CMS.')
root = Path(__file__).resolve().parent.parent
for port in [3175, 5181]:
    with socket.socket() as probe:
        if probe.connect_ex(('127.0.0.1', port)) == 0:
            raise SystemExit(f'Port {port} is already owned; refusing to replace it.')
control = root/'tmp/admin-products-layout-control.json'
if control.exists():
    raise SystemExit('Prior fixture control exists; inspect its ownership first.')
control.write_text(json.dumps({'fixture':'admin-products-readonly','mode':'normal'}))
calls = []
rows = [{'id':f'p-demo{i:03}','slug':f'product-{i:03}','nameFa':f'کالای نمونه {i}',
         'nameEn':f'Layout product {i}','categoryId':'c0' if i<51 else 'c1','brandId':'b0' if i%2==0 else 'b1',
         'status':['Draft','Published','Hidden'][i%3],'featured':False,'variantCount':3} for i in range(101)]


class Fixture(BaseHTTPRequestHandler):
    def do_GET(self):
        path=urlsplit(self.path);filters=parse_qs(path.query)
        calls.append({'method':'GET','path':self.path,'hasAuthorization':bool(self.headers.get('Authorization')),'hasCookie':bool(self.headers.get('Cookie'))})
        mode=json.loads(control.read_text())['mode'];status=404;data={'title':'layout_fixture_only'}
        if path.path=='/api/admin/products':
            status=503 if mode=='page-error' else 200;selected=rows
            for key in ['status','categoryId','brandId']:
                if filters.get(key,['all'])[0] not in ['all','']:
                    selected=[row for row in selected if row[key]==filters[key][0]]
            query=filters.get('query',[''])[0].strip().casefold()
            if query:
                selected=[row for row in selected if query in (row['nameFa']+' '+row['nameEn']+' SKU-'+row['id'][-3:]).casefold()]
            cursor=filters.get('cursor',['page_0'])[0];match=re.fullmatch(r'page_(\d+)',cursor);offset=int(match[1]) if match else 0
            data={'schemaVersion':1,'pageSize':50,'items':selected[offset:offset+50],'nextCursor':f'page_{offset+50}' if offset+50<len(selected) else None}
            if mode=='page-private':
                data['privateCustomer']='must-not-render'
            if mode=='page-error':
                data={'title':'layout_fixture_unavailable'}
        elif path.path=='/api/admin/catalog/product-lookup':
            status=503 if mode=='lookup-error' else 200;keys=set(filters.get('ids',[]));data=[row for row in rows if row['id'] in keys]
            if status==503:
                data={'title':'layout_lookup_unavailable'}
        raw=json.dumps(data,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(raw)));self.end_headers()
        try:
            self.wfile.write(raw)
        except (BrokenPipeError,ConnectionResetError):
            pass

    def do_POST(self):
        calls.append({'method':'POST','path':self.path,'hasAuthorization':bool(self.headers.get('Authorization')),'hasCookie':bool(self.headers.get('Cookie'))});self.send_error(405)

    do_PUT=do_POST

    def log_message(self,*_):
        pass


def interrupt(*_):
    raise SystemExit(0)


signal.signal(signal.SIGTERM,interrupt);signal.signal(signal.SIGINT,interrupt)
server=ThreadingHTTPServer(('127.0.0.1',5181),Fixture);server.daemon_threads=True
thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();child=None
try:
    with tempfile.TemporaryDirectory(prefix='admin-products-layout-',dir=root/'tmp') as directory:
        directory=Path(directory)
        (directory/'index.html').write_text('<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sayman products read-only layout QA</title><div id="root"></div><script type="module" src="/main.tsx"></script></html>')
        (directory/'main.tsx').write_text("""import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {ProductsPage} from '../../apps/admin/src/pages/catalog/products';
import {ProductPicker} from '../../apps/admin/src/features/catalog/product-picker';
import '../../apps/admin/src/styles/style.css';
const client=new QueryClient();
const data={products:[],attributes:[],categories:[{id:'c0',translations:[{locale:'fa',name:'دستهٔ نخست'}]},{id:'c1',translations:[{locale:'fa',name:'دستهٔ دوم'}]}],brands:[{id:'b0',name:'برند نخست'},{id:'b1',name:'برند دوم'}]};
function Layout(){const [picker,setPicker]=useState(false);const [selected,setSelected]=useState(['p-demo099','missing-product']);return <main style={{padding:16,maxWidth:1200,margin:'auto'}}><p role="note">پیش‌نمایش مستقل مدیریت کالا · دادهٔ نمونه، بدون ورود و SQL</p><div className="row-buttons"><button onClick={()=>setPicker(false)}>فهرست آزمایشی کالاها</button><button onClick={()=>setPicker(true)}>انتخاب آزمایشی بلوک</button></div>{picker?<section className="panel"><h2>انتخاب کالا برای بلوک آزمایشی</h2><ProductPicker value={selected} onChange={setSelected}/><output role="status" aria-label="شناسه‌های انتخاب‌شدهٔ آزمایشی">{JSON.stringify(selected)}</output></section>:<ProductsPage data={data as never} methods={[]} plans={[]} writable={false}/>}</main>}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><Layout/></QueryClientProvider>);
""")
        (directory/'vite.config.mts').write_text("import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';export default defineConfig({root:"+json.dumps(str(directory))+",plugins:[react()],publicDir:false,server:{host:'127.0.0.1',port:3175,strictPort:true,fs:{allow:["+json.dumps(str(root))+"]},proxy:{'/api':{target:'http://127.0.0.1:5181',changeOrigin:true}}}});")
        child=subprocess.Popen(['node',str(root/'node_modules/vite/bin/vite.js'),'--config',str(directory/'vite.config.mts')],cwd=root,start_new_session=True)
        while child.poll() is None:
            time.sleep(.25)
        if child.returncode:
            raise SystemExit(child.returncode)
finally:
    if child is not None and child.poll() is None:
        os.killpg(child.pid,signal.SIGTERM)
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid,signal.SIGKILL);child.wait()
    server.shutdown();server.server_close();thread.join(timeout=5);control.unlink(missing_ok=True)
    (root/'artifacts/checks/admin-products-layout-http.json').write_text(json.dumps({'scope':'actual list/picker components with explicit read-only synthetic fixture; no SQL or real authentication acceptance','calls':calls,'authorizationHeaders':sum(c['hasAuthorization'] for c in calls),'cookieHeaders':sum(c['hasCookie'] for c in calls),'writeRequests':sum(c['method']!='GET' for c in calls),'fullSnapshotReads':sum(urlsplit(c['path']).path=='/api/admin/catalog' for c in calls),'cleanup':'owned child terminal, fixture closed and own control/temp directory removed'},ensure_ascii=False,indent=2)+'\n')
