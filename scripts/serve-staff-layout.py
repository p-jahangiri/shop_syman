"""Explicit standalone staff components. Grants/updates always fail; no auth or SQL."""
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

if sys.argv[1:]!=['--explicit-readonly-fixture']:
    raise SystemExit('Use --explicit-readonly-fixture; staff grants and changes never succeed.')
root=Path(__file__).resolve().parent.parent
for port in [3175,5181]:
    with socket.socket() as probe:
        if probe.connect_ex(('127.0.0.1',port))==0:
            raise SystemExit(f'Port {port} already owned; refusing to replace it.')
control=root/'tmp/staff-layout-control.json'
if control.exists():
    raise SystemExit('Prior control exists; inspect ownership first.')
roles=json.loads((root/'artifacts/checks/admin-wire-staff/staff-roles.json').read_text())
control.write_text(json.dumps({'fixture':'staff-readonly','mode':'normal'}))
rows=[{'id':f'employee{i:03}','userName':f'employee{i:03}','displayName':f'کارمند نمونه {i}','isActive':i%2==0,'twoFactorEnabled':i%3==0 and (i==0 or i%7!=0),'mfaRecoveryPending':i>0 and i%7==0,'createdAt':'2026-10-23T00:00:00+00:00','version':f'layout-version-{i}','roles':['Administrator'] if i==0 else ['ContentManager' if i%2 else 'InventoryManager']} for i in range(101)]
calls=[]

class Fixture(BaseHTTPRequestHandler):
    def handle_request(self):
        uri=urlsplit(self.path);params=parse_qs(uri.query);size=int(self.headers.get('Content-Length','0'));body=json.loads(self.rfile.read(size)) if size else {};mode=json.loads(control.read_text())['mode']
        calls.append({'method':self.command,'path':self.path,'hasAuthorization':bool(self.headers.get('Authorization')),'hasCookie':bool(self.headers.get('Cookie')),'fields':sorted(body.keys()),'roleCount':len(body.get('roles',[]))})
        status=404;data={'title':'layout_fixture_only'}
        if self.command=='GET':
            if uri.path=='/api/admin/staff-role-catalog':
                status=200;data=roles
            elif uri.path=='/api/admin/staff':
                selected=rows
                if params.get('active',['all'])[0]!='all':
                    selected=[row for row in selected if row['isActive']==(params['active'][0]=='true')]
                if params.get('role',['all'])[0]!='all':
                    selected=[row for row in selected if params['role'][0] in row['roles']]
                query=params.get('query',[''])[0].strip().casefold()
                if query:
                    selected=[row for row in selected if query in (row['userName']+' '+row['displayName']).casefold()]
                match=re.fullmatch('page_(\d+)',params.get('cursor',['page_0'])[0]);offset=int(match[1]) if match else 0
                status=503 if mode=='page-error' else 200;data={'schemaVersion':1,'pageSize':50,'items':selected[offset:offset+50],'nextCursor':f'page_{offset+50}' if offset+50<len(selected) else None}
                if mode=='page-private':
                    data['securityStamp']='synthetic-must-not-render'
            else:
                match=re.fullmatch('/api/admin/staff/(employee\d{3})(/history)?',uri.path)
                if match:
                    row=next((row for row in rows if row['id']==match[1]),None)
                    if row and match[2]:
                        history=[{'id':str(9007199254740993-i),'action':'STAFF_ROLE_ADDED:ContentManager','actorId':'employee000','actorName':'مدیر نمونه','at':'2026-10-23T00:00:00+00:00','traceId':f'layout-{i}'} for i in range(121)]
                        page=re.fullmatch('history_(\d+)',params.get('cursor',['history_0'])[0]);offset=int(page[1]) if page else 0
                        status=200;data={'schemaVersion':1,'pageSize':50,'items':history[offset:offset+50],'nextCursor':f'history_{offset+50}' if offset+50<len(history) else None}
                    elif row:
                        status=503 if mode=='detail-error' else 200;data={'schemaVersion':1,'staff':rows[1] if mode=='detail-wrong-id' else row}
        elif self.command=='POST' and uri.path=='/api/admin/staff-candidate':
            identifier=body.get('identifier','');status=200
            data={'schemaVersion':1,'id':'candidate1','userName':'حساب نمونه','displayName':'حساب کاملاً آزمایشی','isActive':identifier!='inactive','contactVerified':identifier!='unverified','hasPassword':identifier!='no-password','alreadyStaff':identifier=='existing','mfaRecoveryPending':False,'version':'layout-candidate-version'}
        elif self.command in ['POST','PUT']:
            status=409 if mode=='conflict' else 503;data={'title':'version_conflict' if status==409 else 'layout_writes_disabled'}
        raw=json.dumps(data,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
    do_GET=handle_request
    do_POST=handle_request
    do_PUT=handle_request
    def log_message(self,*_):
        pass

def interrupt(*_):
    raise SystemExit(0)

signal.signal(signal.SIGTERM,interrupt);signal.signal(signal.SIGINT,interrupt)
server=ThreadingHTTPServer(('127.0.0.1',5181),Fixture);server.daemon_threads=True;thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();child=None
try:
    with tempfile.TemporaryDirectory(prefix='staff-layout-',dir=root/'tmp') as directory:
        directory=Path(directory)
        (directory/'index.html').write_text('<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sayman staff read-only component QA</title><div id="root"></div><script type="module" src="/main.tsx"></script></html>')
        (directory/'main.tsx').write_text("""import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {StaffPage} from '../../apps/admin/src/pages/staff/staff';import '../../apps/admin/src/styles/style.css';
const client=new QueryClient();createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><main style={{padding:16,maxWidth:1200,margin:'auto'}}><p role="note">آزمون مستقل کارکنان · فقط دادهٔ نمونه، بدون حساب یا SQL · تمام افزودن‌ها و تغییرهای دسترسی رد می‌شوند.</p><StaffPage viewerId="employee000" writable={true}/></main></QueryClientProvider>);""")
        (directory/'vite.config.mts').write_text("import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';export default defineConfig({root:"+json.dumps(str(directory))+",plugins:[react()],publicDir:false,server:{host:'127.0.0.1',port:3175,strictPort:true,fs:{allow:["+json.dumps(str(root))+"]},proxy:{'/api':{target:'http://127.0.0.1:5181',changeOrigin:true,configure(proxy){proxy.on('proxyReq',request=>{request.removeHeader('cookie');request.removeHeader('authorization');});}}}}});")
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
    (root/'artifacts/checks/staff-layout-http.json').write_text(json.dumps({'scope':'real staff component with explicit synthetic metadata; no authentication, grants, state changes or SQL acceptance','calls':calls,'successfulMutations':0,'authorizationHeadersAtFixture':sum(c['hasAuthorization'] for c in calls),'cookieHeadersAtFixture':sum(c['hasCookie'] for c in calls),'requestValuesLogged':False,'cleanup':'owned child terminal, fixture closed, own control/temp removed'},ensure_ascii=False,indent=2)+'\n')
