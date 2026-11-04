"""Test the built Next offline route with an explicitly synthetic public upstream.

No database, identity, payment or main runtime is used. Only the owned QA Next
process group is stopped; occupied QA ports cause an immediate refusal.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
import copy
import http.client
import json
import os
import signal
import socket
import subprocess
import threading
import time

root=Path(__file__).resolve().parent.parent
runtime=root/'apps/storefront/.next-qa/standalone/apps/storefront/server.js'
if not runtime.is_file():raise SystemExit('Build the isolated storefront first.')
for port in [3105,5181]:
    with socket.socket() as probe:
        try:probe.bind(('127.0.0.1',port))
        except OSError:raise SystemExit(f'QA port {port} is occupied; no existing process was changed.')
source="""import {storefrontSnapshot} from './apps/storefront/lib/data/fixtures.ts';import {localizeData} from './apps/storefront/lib/navigation/i18n.ts';import {offlineCatalog} from './apps/storefront/lib/offline/offline-catalog.ts';process.stdout.write(JSON.stringify(Object.fromEntries(['fa','en'].map(locale=>[locale,offlineCatalog(localizeData(storefrontSnapshot,locale),locale)]))));"""
fixtures=json.loads(subprocess.check_output(['node','--experimental-strip-types','--input-type=module','-e',source],cwd=root))
mode='normal'; full_reads=0; forbidden_headers=0; requests=0

class Projection(BaseHTTPRequestHandler):
    def do_GET(self):
        global full_reads,forbidden_headers,requests
        path=urlsplit(self.path);parts=path.path.strip('/').split('/');requests+=1
        if path.path.startswith('/api/storefront/'):full_reads+=1
        if any(self.headers.get(k) for k in ['Cookie','Authorization','Origin','X-Sayman-Admin']):forbidden_headers+=1
        if len(parts)!=4 or parts[:2]!=['api','catalog'] or parts[2] not in fixtures or parts[3]!='offline' or parse_qs(path.query)!={'limit':['200']}:
            self.send_response(503);self.end_headers();return
        data=copy.deepcopy(fixtures[parts[2]])
        # Exercise .NET-compatible offset/fraction formatting and escaped Unicode.
        data['generatedAt']='2026-10-23T00:00:00.1234567+00:00'
        if mode=='price':data['products'][0]['priceRial']='1'
        elif mode=='private':data['site']['contact']={'phone':'must-not-be-published'}
        elif mode=='signed':data['products'][0]['image']='https://private.example/image?signature=must-not-be-published'
        elif mode=='locale':data['locale']='en' if parts[2]=='fa' else 'fa'
        elif mode=='duplicates':data['products'].append(data['products'][0])
        elif mode=='category':data['products'][0]['category']='missing'
        elif mode=='count':data['products']=[dict(data['products'][0],id='p'+str(i),slug='product-'+str(i)) for i in range(201)]
        elif mode=='truncated':data['truncated']=True
        elif mode=='empty':data['products']=[]
        raw=json.dumps(data,ensure_ascii=True).encode()
        if mode in ['stream-large','header-large']:raw=b'x'*(6*1024*1024+1) if mode=='stream-large' else b'{}'
        if mode=='html':raw=b'<p>must-not-be-published</p>'
        self.send_response(503 if mode=='unavailable' else 200)
        self.send_header('Content-Type','text/html' if mode=='html' else 'application/json; charset=utf-8')
        self.send_header('Set-Cookie','upstream-private=must-not-be-forwarded')
        if mode!='stream-large':self.send_header('Content-Length',str(6*1024*1024+1 if mode=='header-large' else len(raw)))
        self.end_headers()
        try:self.wfile.write(raw)
        except (BrokenPipeError,ConnectionResetError):pass
    def log_message(self,*_):pass

upstream=ThreadingHTTPServer(('127.0.0.1',5181),Projection);upstream.daemon_threads=True
thread=threading.Thread(target=upstream.serve_forever,daemon=True);thread.start()
# The runtime wrapper copies assets and explicitly sets the independent origin.
environment=os.environ.copy();environment['SHOP_PWA_ENABLED']='false'
log=(root/'artifacts/checks/offline-projection-next-runtime.log').open('w')
process=None;checks=[]

def read(path,headers=None):
    connection=http.client.HTTPConnection('127.0.0.1',3105,timeout=15)
    try:
        connection.request('GET',path,headers=headers or {});response=connection.getresponse();return response.status,dict((k.lower(),v) for k,v in response.getheaders()),response.read()
    finally:connection.close()

def keys(value):
    if isinstance(value,dict):return set(value).union(*(keys(v) for v in value.values()))
    if isinstance(value,list):return set().union(*(keys(v) for v in value))
    return set()

try:
    process=subprocess.Popen(['python3',str(root/'scripts/serve-storefront-isolated.py'),'api'],cwd=root,env=environment,start_new_session=True,stdout=log,stderr=subprocess.STDOUT)
    for attempt in range(100):
        if process.poll() is not None:raise RuntimeError('Owned QA Next exited before readiness.')
        try:
            with socket.create_connection(('127.0.0.1',3105),timeout=.3):break
        except OSError:time.sleep(.1)
    else:raise RuntimeError('Owned QA Next did not become ready.')
    for locale in ['fa','en']:
        status,headers,raw=read('/pwa/catalog/'+locale+'.json',{'Authorization':'Bearer synthetic-never-forward','Cookie':'synthetic-never-forward=1','X-Sayman-Admin':'1'})
        data=json.loads(raw);assert status==200;assert data['locale']==locale and len(data['products'])==12;assert headers['x-shop-public-resource']=='offline-catalog-v1';assert headers['x-shop-catalog-generated']==data['generatedAt'];assert 'public' in headers['cache-control'];assert 'set-cookie' not in headers
        assert not keys(data).intersection(['priceRial','stock','warranty','purchaseMethods','authSettings','variants','user','contact'])
        checks.append({'check':'anonymous bounded '+locale+' DTO','status':status})
    for selected in ['truncated','empty']:
        mode=selected;status,headers,raw=read('/pwa/catalog/fa.json');data=json.loads(raw);assert status==200
        assert data['truncated'] if selected=='truncated' else data['products']==[]
        checks.append({'check':selected+' public result preserved','status':status})
    for selected in ['price','private','signed','locale','duplicates','category','count','unavailable','html','stream-large','header-large']:
        mode=selected;status,headers,raw=read('/pwa/catalog/fa.json');assert status==503,(selected,status);assert 'no-store' in headers['cache-control'];assert 'x-shop-public-resource' not in headers;assert 'set-cookie' not in headers;assert json.loads(raw)=={'title':'offline_catalog_unavailable'}
        checks.append({'check':selected+' rejected without fallback/cache publication','status':status})
    mode='normal';status,_,_=read('/pwa/catalog/other.json');assert status==404;checks.append({'check':'unsupported locale file','status':status})
    assert full_reads==0 and forbidden_headers==0
finally:
    if process is not None and process.poll() is None:
        try:os.killpg(process.pid,signal.SIGTERM)
        except ProcessLookupError:pass
        try:process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid,signal.SIGKILL);process.wait()
    upstream.shutdown();upstream.server_close();thread.join(timeout=5);log.close()

report={'scope':'built Next HTTP with explicit synthetic public upstream; no SQL or identity success','passed':len(checks),'checks':checks,'fullStorefrontReads':full_reads,'forbiddenUpstreamHeaders':forbidden_headers,'upstreamRequests':requests,'cleanup':'owned process terminal and fixture server closed','sqlAcceptance':'not run; remains pending user disk-space announcement'}
(root/'artifacts/checks/offline-projection-http.json').write_text(json.dumps(report,indent=2)+'\n')
print(f'{len(checks)} offline projection HTTP checks passed; no full snapshots, credential forwarding or SQL execution.')
