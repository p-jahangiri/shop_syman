"""Explicit standalone finance components: synthetic reads, every mutation fails."""
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import urlsplit,parse_qs
import json,os,re,signal,socket,subprocess,sys,tempfile,threading,time
if sys.argv[1:]!=['--explicit-readonly-fixture']:raise SystemExit('Requires --explicit-readonly-fixture; saves never succeed.')
root=Path(__file__).resolve().parent.parent
for port in [3175,5181]:
 with socket.socket() as s:
  if s.connect_ex(('127.0.0.1',port))==0:raise SystemExit(f'Port {port} already owned.')
control=root/'tmp/finance-layout-control.json'
if control.exists():raise SystemExit('Prior control exists; inspect ownership first.')
control.write_text('{"mode":"normal"}');calls=[]
read=lambda name:json.loads((root/'artifacts/checks/finance-wire'/name).read_text())
method_detail=read('finance-method-detail.json');plan_detail=read('finance-plan-detail.json')
methods=[{'id':f'method{i:03}','nameFa':f'روش نمونه {i}','nameEn':f'Method {i}','kind':['online','cheque','installment'][i%3],'enabled':i%2==0,'requiresApproval':i%3==1,'categoryCount':i%2} for i in range(101)]
plans=[{'id':f'plan{i:03}','nameFa':f'طرح نمونه {i}','nameEn':f'Plan {i}','enabled':i%2==0,'months':6,'intervalMonths':2,'markupBasisPoints':1500,'downPaymentBasisPoints':1000,'roundingUnitRial':10,'categoryCount':i%2} for i in range(101)]
class Fixture(BaseHTTPRequestHandler):
 def respond(self):
  uri=urlsplit(self.path);q=parse_qs(uri.query);body=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))) or '{}');mode=json.loads(control.read_text())['mode'];calls.append({'method':self.command,'path':uri.path,'hasCookie':bool(self.headers.get('Cookie')),'hasAuthorization':bool(self.headers.get('Authorization')),'fields':sorted(body.keys()),'categoryIds':body.get('categoryIds',[]),'moneyFieldsAreStringsOrNull':all(body.get(k) is None or isinstance(body[k],str) for k in ['minAmountRial','maxAmountRial'])})
  status=404;data={'title':'layout_readonly_fixture'}
  if self.command=='GET' and uri.path in ['/api/admin/purchase-methods-page','/api/admin/cheque-plans-page']:
   rows=methods if 'purchase-methods' in uri.path else plans
   if q.get('enabled',['all'])[0]!='all':rows=[r for r in rows if r['enabled']==(q['enabled'][0]=='true')]
   if q.get('kind',['all'])[0]!='all':rows=[r for r in rows if r.get('kind')==q['kind'][0]]
   if q.get('categoryId'):rows=[r for r in rows if r['categoryCount']==0]
   term=q.get('query',[''])[0].strip().casefold()
   if term:rows=[r for r in rows if term in (r['nameFa']+' '+r['nameEn']+' '+r['id']).casefold()]
   match=re.fullmatch(r'page_(\d+)',q.get('cursor',['page_0'])[0]);offset=int(match[1]) if match else 0
   status=503 if mode=='page-error' else 200;data={'schemaVersion':1,'pageSize':50,'items':[dict(row) for row in rows[offset:offset+50]],'nextCursor':f'page_{offset+50}' if offset+50<len(rows) else None}
   if mode=='page-private':data['items'][0]['minAmountRial']='1'
  elif self.command=='GET':
   match=re.fullmatch(r'/api/admin/(purchase-methods|cheque-plans)/(method\d{3}|plan\d{3})',uri.path)
   if match:
    method=match[1]=='purchase-methods';name='method' if method else 'plan';data=json.loads(json.dumps(method_detail if method else plan_detail));data[name]['id']='wrong-resource' if mode=='detail-wrong-id' else match[2]
    if method:data[name]['kind']=methods[int(match[2][-3:])]['kind'];data[name]['requiresApproval']=data[name]['kind']=='cheque'
    status=503 if mode=='detail-error' else 200
  elif self.command in ['POST','PUT']:
   status=409 if mode=='conflict' else 503;data={'title':'version_conflict' if status==409 else 'layout_saves_disabled'}
  raw=json.dumps(data,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
 do_GET=respond
 do_POST=respond
 do_PUT=respond
 def log_message(self,*_):pass
signal.signal(signal.SIGTERM,lambda *_:sys.exit(0));signal.signal(signal.SIGINT,lambda *_:sys.exit(0))
server=ThreadingHTTPServer(('127.0.0.1',5181),Fixture);server.daemon_threads=True;thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();child=None
try:
 with tempfile.TemporaryDirectory(prefix='finance-layout-',dir=root/'tmp') as folder:
  d=Path(folder);(d/'index.html').write_text('<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sayman finance component QA</title><div id="root"></div><script type="module" src="/main.tsx"></script></html>')
  (d/'main.tsx').write_text("""import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {FinancePage} from '../../apps/admin/src/pages/finance/finance';import '../../apps/admin/src/styles/style.css';const q=new URLSearchParams(location.search);const catalog=q.has('nocatalog')?undefined:{categories:[{id:'cat-a',translations:[{locale:'fa',name:'دستهٔ نمونه'}]}],brands:[],attributes:[],products:[]};createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient()}><main style={{padding:16,maxWidth:1250,margin:'auto'}}><p role="note">آزمون مستقل شرایط خرید · فقط دادهٔ نمونه، بدون حساب یا SQL · تمام ذخیره‌ها رد می‌شوند.</p><FinancePage catalog={catalog as any} writable={!q.has('readonly')}/></main></QueryClientProvider>);""")
  (d/'vite.config.mts').write_text("import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';export default defineConfig({root:"+json.dumps(str(d))+",plugins:[react()],publicDir:false,server:{host:'127.0.0.1',port:3175,strictPort:true,fs:{allow:["+json.dumps(str(root))+"]},proxy:{'/api':{target:'http://127.0.0.1:5181',changeOrigin:true,configure(proxy){proxy.on('proxyReq',request=>{request.removeHeader('cookie');request.removeHeader('authorization');});}}}}});")
  child=subprocess.Popen(['node',str(root/'node_modules/vite/bin/vite.js'),'--config',str(d/'vite.config.mts')],cwd=root,start_new_session=True)
  (root/'artifacts/checks/finance-layout-process.json').write_text(json.dumps({'parent':os.getpid(),'child':child.pid,'ports':[3175,5181],'scope':'standalone-readonly-finance'}))
  while child.poll() is None:time.sleep(.25)
finally:
 if child is not None and child.poll() is None:
  os.killpg(child.pid,signal.SIGTERM)
  try:child.wait(timeout=5)
  except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait()
 server.shutdown();server.server_close();thread.join(timeout=5);control.unlink(missing_ok=True)
 (root/'artifacts/checks/finance-layout-http.json').write_text(json.dumps({'scope':'standalone finance UI with synthetic reads, all saves rejected, no auth/SQL','calls':calls,'successfulMutations':0,'requestValuesLogged':'only synthetic category identifiers and structural field names; no names, money values, headers or descriptions','cleanup':'owned child terminal, ports closed, own control/temp removed'},indent=2)+'\n')
