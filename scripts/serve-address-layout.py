"""Standalone address components with synthetic data. All writes fail; no auth/SQL."""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
import json, os, signal, socket, subprocess, sys, tempfile, threading, time
if sys.argv[1:]!=['--explicit-readonly-fixture']:
    raise SystemExit('Requires --explicit-readonly-fixture. Every save/removal fails.')
root=Path(__file__).resolve().parent.parent
for port in [3175,5181]:
    with socket.socket() as probe:
        if probe.connect_ex(('127.0.0.1',port))==0: raise SystemExit(f'Port {port} already owned.')
control=root/'tmp/address-layout-control.json'
if control.exists(): raise SystemExit('Prior control exists; inspect ownership first.')
control.write_text(json.dumps({'mode':'normal'}));calls=[];previous=None
book=json.loads((root/'artifacts/checks/address-wire/address-book.json').read_text())
class Fixture(BaseHTTPRequestHandler):
    def respond(self):
        global previous
        body=self.rfile.read(int(self.headers.get('Content-Length','0')));mode=json.loads(control.read_text())['mode'];uri=urlsplit(self.path)
        calls.append({'method':self.command,'path':uri.path,'hasCookie':bool(self.headers.get('Cookie')),'hasAuthorization':bool(self.headers.get('Authorization')),'sameWriteAsPrevious':bool(body and previous==(self.command,uri.path,body))})
        if body: previous=(self.command,uri.path,body)
        status=503;data={'title':'layout_writes_disabled'}
        if self.command=='GET' and uri.path=='/api/addresses':
            status=503 if mode=='read-error' else 200;data=json.loads(json.dumps(book))
            if mode=='empty':data['items']=[]
            if mode=='corrupt':data['items'][0]['protectedData']='synthetic-must-not-render'
        elif mode=='conflict':status=409;data={'title':'address_version_conflict'}
        raw=json.dumps(data,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
    do_GET=respond
    do_PUT=respond
    do_DELETE=respond
    def log_message(self,*_):pass
signal.signal(signal.SIGTERM,lambda *_:sys.exit(0));signal.signal(signal.SIGINT,lambda *_:sys.exit(0))
server=ThreadingHTTPServer(('127.0.0.1',5181),Fixture);server.daemon_threads=True;thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();child=None
try:
    with tempfile.TemporaryDirectory(prefix='address-layout-',dir=root/'tmp') as directory:
        d=Path(directory)
        (d/'index.html').write_text('<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sayman address component QA</title><div id="root"></div><script type="module" src="/main.tsx"></script></html>')
        (d/'locale.ts').write_text("export const locale=new URLSearchParams(location.search).get('lang')==='en'?'en':'fa';export const useI18n=()=>({locale,t:(v:unknown)=>v,digits:(v:number)=>String(v)});export const useStorefront=()=>({dataSource:'preview'});")
        (d/'auth.ts').write_text("export const useCustomerSession=()=>({status:'guest',session:null});")
        (d/'link.tsx').write_text("import React from 'react';export default function Link(props:any){return <a {...props}/>;}export const useRouter=()=>({});")
        (d/'main.tsx').write_text("""import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {AddressBookPanel} from '../../apps/storefront/components/customer-addresses';import {AddressPickerPanel} from '../../apps/storefront/components/saved-address-picker';import {addressOrderFields} from '../../apps/storefront/lib/address-contract';import {locale} from './locale';import '@fontsource/vazirmatn/400.css';import '@fontsource/vazirmatn/600.css';import '@sayman/design-tokens/tokens.css';import '../../apps/storefront/app/globals.css';
document.documentElement.lang=locale;document.documentElement.dir=locale==='fa'?'rtl':'ltr';const transport=(path:string,init?:RequestInit)=>fetch(path,{...init,credentials:'omit',cache:'no-store'});
function Example(){const [copied,setCopied]=useState(''),[disabled,setDisabled]=useState(false);return <><p role="note" style={{padding:16}}>آزمون مستقل نشانی · دادهٔ کاملاً نمونه، بدون حساب یا SQL · ذخیره و حذف همیشه رد می‌شوند.</p><AddressBookPanel locale={locale} fetcher={transport}/><section className="container card-panel" style={{marginBottom:50}}><h2>Checkout picker component fixture</h2><label><input type="checkbox" checked={disabled} onChange={e=>setDisabled(e.target.checked)}/>Freeze picker</label><AddressPickerPanel locale={locale} fetcher={transport} disabled={disabled} onUse={a=>setCopied(JSON.stringify(addressOrderFields(a)))}/><output style={{display:'block',overflowWrap:'anywhere'}} aria-label="Copied fields">{copied}</output></section></>;};createRoot(document.getElementById('root')!).render(<Example/>);""")
        aliases=[{'find':'@','replacement':str(root/'apps/storefront')}]
        config="import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';import tailwind from '@tailwindcss/postcss';export default defineConfig({root:"+json.dumps(str(d))+",plugins:[react()],publicDir:false,css:{postcss:{plugins:[tailwind()]}},resolve:{alias:[{find:/^(?:.*\\/)?locale-provider$/,replacement:"+json.dumps(str(d/'locale.ts'))+"},{find:/^(?:.*\\/)?auth-provider$/,replacement:"+json.dumps(str(d/'auth.ts'))+"},{find:/^(?:.*\\/)?localized-link$/,replacement:"+json.dumps(str(d/'link.tsx'))+"},..."+json.dumps(aliases)+"]},server:{host:'127.0.0.1',port:3175,strictPort:true,fs:{allow:["+json.dumps(str(root))+"]},proxy:{'/api':{target:'http://127.0.0.1:5181',changeOrigin:true,configure(proxy){proxy.on('proxyReq',request=>{request.removeHeader('cookie');request.removeHeader('authorization');});}}}}});"
        (d/'vite.config.mts').write_text(config)
        child=subprocess.Popen(['node',str(root/'node_modules/vite/bin/vite.js'),'--config',str(d/'vite.config.mts')],cwd=root,start_new_session=True)
        (root/'artifacts/checks/address-layout-process.json').write_text(json.dumps({'parent':os.getpid(),'child':child.pid,'fixture':'addresses-readonly','ports':[3175,5181]}))
        while child.poll() is None:time.sleep(.25)
finally:
    if child is not None and child.poll() is None:
        os.killpg(child.pid,signal.SIGTERM)
        try:child.wait(timeout=5)
        except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait()
    server.shutdown();server.server_close();thread.join(timeout=5);control.unlink(missing_ok=True)
    (root/'artifacts/checks/address-layout-http.json').write_text(json.dumps({'scope':'synthetic component UI, all writes fail, no auth or SQL','calls':calls,'successfulMutations':0,'requestValuesLogged':False,'cleanup':'owned child terminal, server closed, control/temp removed'},indent=2)+'\n')
