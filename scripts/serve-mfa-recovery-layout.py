"""Standalone MFA components; all authentication/generation/recovery requests fail."""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
import json
import os
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time

if sys.argv[1:] != ['--explicit-failing-fixture']:
    raise SystemExit('Use --explicit-failing-fixture; no login, MFA key or backup code is produced.')
root=Path(__file__).resolve().parent.parent
for port in [3175,5181]:
    with socket.socket() as probe:
        if probe.connect_ex(('127.0.0.1',port))==0:
            raise SystemExit(f'Port {port} is already owned; refusing to replace it.')
control=root/'tmp/mfa-recovery-layout-control.json'
if control.exists():
    raise SystemExit('Prior fixture control exists; inspect ownership first.')
control.write_text(json.dumps({'fixture':'mfa-recovery-failing','mode':'unavailable'}))
calls=[]

class Fixture(BaseHTTPRequestHandler):
    def run_request(self):
        path=urlsplit(self.path).path;mode=json.loads(control.read_text())['mode'];size=int(self.headers.get('Content-Length','0'))
        body=json.loads(self.rfile.read(size)) if size else {}
        calls.append({'method':self.command,'path':path,'hasAuthorization':bool(self.headers.get('Authorization')),'hasCookie':bool(self.headers.get('Cookie')),'fieldLengths':{k:len(v) for k,v in body.items() if isinstance(v,str)}})
        status=401 if mode=='invalid' else 503
        data={'title':'invalid_credentials' if status==401 else 'layout_fixture_unavailable'}
        if self.command=='GET' and mode=='bad-status':
            status=200;data={'schemaVersion':1,'remainingCodes':'10'}
        raw=json.dumps(data).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
    do_GET=run_request
    do_POST=run_request
    def log_message(self,*_):
        pass

def interrupt(*_):
    raise SystemExit(0)

signal.signal(signal.SIGTERM,interrupt);signal.signal(signal.SIGINT,interrupt)
server=ThreadingHTTPServer(('127.0.0.1',5181),Fixture);server.daemon_threads=True
thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();child=None
try:
    with tempfile.TemporaryDirectory(prefix='mfa-recovery-layout-',dir=root/'tmp') as directory:
        directory=Path(directory)
        (directory/'index.html').write_text('<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>MFA components failing QA fixture</title><div id="root"></div><script type="module" src="/main.tsx"></script></html>')
        (directory/'main.tsx').write_text("""import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {SecurityPage} from '../../apps/admin/src/mfa-recovery';import {RecoverMfaForm} from '../../apps/admin/src/recover-mfa-form';import {Login} from '../../apps/admin/src/login';import '../../apps/admin/src/style.css';
const client=new QueryClient();function reject(){throw Error('This fixture never authenticates.');}
function Layout(){const [page,setPage]=useState('security');const [back,setBack]=useState(false);return <><header style={{padding:16}}><p role="note">آزمون مستقل رابط امنیت · بدون حساب، SQL یا ورود موفق · تمام درخواست‌های ورود، تولید کد و بازیابی رد می‌شوند.</p><div className="row-buttons"><button onClick={()=>setPage('security')}>امنیت آزمایشی</button><button onClick={()=>{setPage('recover');setBack(false);}}>بازیابی آزمایشی</button><button onClick={()=>setPage('login')}>ورود آزمایشی</button></div></header>{page==='login'?<Login onSession={reject}/>:<main style={{padding:16,maxWidth:1000,margin:'auto'}}>{page==='security'?<SecurityPage/>:<section className="panel"><h2>فرم مستقل بازیابی</h2>{back?<p role="status">بازگشت آزمایشی انجام شد.</p>:<RecoverMfaForm onRecovered={reject} onBack={()=>setBack(true)}/>}</section>}</main>}</>}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><Layout/></QueryClientProvider>);
""")
        config="import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';export default defineConfig({root:"+json.dumps(str(directory))+",plugins:[react()],publicDir:false,server:{host:'127.0.0.1',port:3175,strictPort:true,fs:{allow:["+json.dumps(str(root))+"]},proxy:{'/api':{target:'http://127.0.0.1:5181',changeOrigin:true,configure(proxy){proxy.on('proxyReq',request=>{request.removeHeader('cookie');request.removeHeader('authorization');});}}}}});"
        (directory/'vite.config.mts').write_text(config)
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
    (root/'artifacts/checks/mfa-recovery-layout-http.json').write_text(json.dumps({'scope':'standalone actual components; all login/generation/recovery requests rejected; no SQL or real MFA acceptance','calls':calls,'successfulAuthentication':False,'credentialsLogged':False,'authorizationHeaders':sum(c['hasAuthorization'] for c in calls),'cookieHeaders':sum(c['hasCookie'] for c in calls),'cleanup':'owned child terminal, fixture closed and control/temp removed'},ensure_ascii=False,indent=2)+'\n')
