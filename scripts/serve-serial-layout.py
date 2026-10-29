"""Opt-in isolated inventory UI fixture. Synthetic data/mutations only; no account or SQL."""
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import urlsplit,parse_qs
import copy,hashlib,json,os,re,signal,socket,subprocess,sys,tempfile,threading,time

if sys.argv[1:]!=['--explicit-serial-fixture']:raise SystemExit('Requires --explicit-serial-fixture; no real account or SQL.')
root=Path(__file__).resolve().parent.parent
for port in [3175,5181]:
 with socket.socket() as s:
  if s.connect_ex(('127.0.0.1',port))==0:raise SystemExit(f'Port {port} already owned.')
control=root/'tmp/serial-layout-control.json'
if control.exists():raise SystemExit('Prior control exists; inspect ownership first.')
control.write_text('{"mode":"normal"}');calls=[];scenario=None;stock=None;units=[];completed={};successes=0
variant='fixture-variant';at='2026-10-23T12:00:00Z';v1='AAAAAAAAAAE=';v2='AAAAAAAAAAI='
def row(i):return {'id':f'{i+1:032x}','variantId':variant,'serial':f'SYNTHETIC-{i:03}','imei1':None,'imei2':None,'state':'available','orderId':None,'reservationId':None,'warrantyUntil':None,'createdAt':at,'changedAt':at,'version':v1}
def reset(mode):
 global scenario,stock,units,completed
 scenario=mode;empty=mode in ['empty','missing','imei','mode-success'];stock={'variantId':variant,'mode':'imei' if mode=='imei' else 'none' if empty else 'serial','onHand':0 if empty else 53,'reserved':0 if empty else 1,'version':None if mode=='missing' else v1};units=[] if empty else [row(i) for i in range(53)];completed={}
class Fixture(BaseHTTPRequestHandler):
 def respond(self):
  global stock,units,successes
  uri=urlsplit(self.path);q=parse_qs(uri.query);raw=self.rfile.read(int(self.headers.get('Content-Length','0')));body=json.loads(raw or '{}');mode=json.loads(control.read_text())['mode']
  if scenario!=mode:reset(mode)
  digest=hashlib.sha256(json.dumps(body,sort_keys=True,separators=(',',':')).encode()).hexdigest();calls.append({'method':self.command,'path':uri.path,'hasCookie':bool(self.headers.get('Cookie')),'hasAuthorization':bool(self.headers.get('Authorization')),'fields':sorted(body),'bodyHash':digest if raw else None})
  status=404;data={'title':'serial_synthetic_fixture'};base='/api/admin/inventory/variants/'+variant
  if self.command=='GET' and uri.path=='/api/admin/inventory/variants':
   data={'version':1,'pageSize':50,'items':[{'variantId':variant,'productId':'fixture-product','sku':'SYNTHETIC-SERIAL','nameFa':'کالای نمونهٔ سریال','nameEn':'Synthetic serial item','isActive':True,'productStatus':'Published','onHand':stock['onHand'],'reserved':stock['reserved'],'available':stock['onHand']-stock['reserved'],'version':stock['version']}],'nextCursor':None};status=200
  elif self.command=='GET' and uri.path=='/api/admin/inventory/movements':data={'version':1,'pageSize':50,'items':[],'nextCursor':None};status=200
  elif self.command=='GET' and uri.path==base+'/serials':
   state=q.get('state',['all'])[0];term=q.get('query',[''])[0];rows=[copy.deepcopy(u) for u in units if (state=='all' or u['state']==state) and (not term or any(v and v.startswith(term) for v in [u['serial'],u['imei1'],u['imei2']]))];match=re.fullmatch(r'page_(\d+)',q.get('cursor',['page_0'])[0]);offset=int(match[1]) if match else 0
   data={'schemaVersion':1,'pageSize':50,'stock':copy.deepcopy(stock),'items':rows[offset:offset+50],'nextCursor':f'page_{offset+50}' if offset+50<len(rows) else None};status=503 if mode=='page-error' else 200
   if mode=='page-wrong':data['stock']['variantId']='wrong'
   if mode=='page-private' and data['items']:data['items'][0]['priceRial']='1'
  elif self.command=='GET' and re.fullmatch(re.escape(base)+r'/serials/[0-9a-f]{32}/history',uri.path):
   unit=uri.path.split('/')[-2];limit=int(q.get('before',[str(9223372036854775808)])[0]);rows=[{'id':str(9223372036854775807-i),'unitId':unit if mode!='history-wrong' else 'f'*32,'state':'available','actorId':'fixture-staff','reason':f'رویداد نمونهٔ {i}','orderId':None,'at':at} for i in range(53) if 9223372036854775807-i<limit];data={'schemaVersion':1,'pageSize':50,'items':rows[:50],'nextBefore':rows[49]['id'] if len(rows)>50 else None};status=503 if mode=='history-error' else 200
  elif self.command in ['POST','PUT']:
   status=409 if mode=='conflict' else 503;data={'title':'version_conflict' if status==409 else 'synthetic_save_unavailable'}
   if mode=='invalid-success':status=200;data={'schemaVersion':1,'stock':copy.deepcopy(stock),'units':[]}
   if mode in ['success-receipt','success-retire','mode-success']:
    key=(self.command,uri.path,body.get('requestId'));previous=completed.get(key)
    if previous:
     status,data=(200,copy.deepcopy(previous[1])) if previous[0]==digest else (409,{'title':'idempotency_conflict'})
    else:
     result=[]
     if uri.path.endswith('/serial-mode') and mode=='mode-success':stock['mode']=body['mode'];status=200
     elif uri.path==base+'/serials' and mode=='success-receipt':
      for value in body.get('units',[]):
       unit=row(len(units));unit.update(value);unit['version']=v2;units.append(unit);result.append(copy.deepcopy(unit))
      stock['onHand']+=len(result);status=200
     elif uri.path.endswith('/retire') and mode=='success-retire':
      unit=next(u for u in units if u['id']==uri.path.split('/')[-2]);unit.update(state='retired',version=v2);result=[copy.deepcopy(unit)];stock['onHand']-=1;status=200
     if status==200:
      stock['version']=v2;data={'schemaVersion':1,'stock':copy.deepcopy(stock),'units':result};completed[key]=(digest,copy.deepcopy(data));successes+=1
  raw=json.dumps(data,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(raw)));self.end_headers()
  try:self.wfile.write(raw)
  except BrokenPipeError:pass
 do_GET=respond
 do_POST=respond
 do_PUT=respond
 def log_message(self,*_):pass
server=ThreadingHTTPServer(('127.0.0.1',5181),Fixture);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();child=None
def stop(*_):raise KeyboardInterrupt()
signal.signal(signal.SIGTERM,stop)
try:
 with tempfile.TemporaryDirectory(prefix='serial-ui-',dir=root/'tmp') as folder:
  d=Path(folder);(d/'index.html').write_text('<html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/main.tsx"></script></html>')
  (d/'main.tsx').write_text("""import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {InventoryPage} from '../../apps/admin/src/inventory';import '../../apps/admin/src/style.css';createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient()}><main style={{padding:16,maxWidth:1250,margin:'auto'}}><p role="note">آزمون مستقل سریال · داده و ثبت نمونه فقط در حافظه · بدون حساب، SQL یا تغییر واقعی موجودی</p><InventoryPage writable={!new URLSearchParams(location.search).has('readonly')}/></main></QueryClientProvider>);""")
  (d/'vite.config.mts').write_text("import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';export default defineConfig({root:"+json.dumps(str(d))+",plugins:[react()],publicDir:false,server:{host:'127.0.0.1',port:3175,strictPort:true,fs:{allow:["+json.dumps(str(root))+"]},proxy:{'/api':{target:'http://127.0.0.1:5181',changeOrigin:true,configure(proxy){proxy.on('proxyReq',request=>{request.removeHeader('cookie');request.removeHeader('authorization');});}}}}});")
  child=subprocess.Popen(['node',str(root/'node_modules/vite/bin/vite.js'),'--config',str(d/'vite.config.mts')],cwd=root,start_new_session=True)
  (root/'artifacts/checks/serial-layout-process.json').write_text(json.dumps({'parent':os.getpid(),'child':child.pid,'ports':[3175,5181],'scope':'standalone synthetic serial inventory UI'}))
  while child.poll() is None:time.sleep(.25)
except KeyboardInterrupt:pass
finally:
 if child is not None and child.poll() is None:
  os.killpg(child.pid,signal.SIGTERM)
  try:child.wait(timeout=5)
  except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait()
 server.shutdown();server.server_close();thread.join(timeout=5);control.unlink(missing_ok=True)
 (root/'artifacts/checks/serial-layout-http.json').write_text(json.dumps({'scope':'standalone inventory UI; synthetic reads and opt-in in-memory mutation scenarios only; no account/SQL','calls':calls,'successfulSyntheticMutations':successes,'realMutations':0,'requestValuesLogged':'field names and body hashes only; no header, identifier or reason values','cleanup':'owned child terminal, own control/temp removed'},indent=2)+'\n')
