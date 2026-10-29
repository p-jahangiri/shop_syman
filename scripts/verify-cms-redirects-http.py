"""Native built-Next redirect checks. Redirect facts are explicit synthetic
fixtures; shared layout metadata is an anonymous read of local main SQL/API.
Only loopback QA processes are owned. No real rule or indexing is activated.
"""
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit,parse_qs
import http.client,json,os,shutil,signal,socket,subprocess,threading,time,urllib.request
root=Path(__file__).resolve().parent.parent;app=root/'apps/storefront';runtime=app/'.next-qa/standalone/apps/storefront'
for port in[3105,5181]:
 with socket.socket()as p:
  try:p.bind(('127.0.0.1',port))
  except OSError:raise SystemExit(f'QA port {port} occupied; no process changed.')
assert(runtime/'server.js').is_file();shutil.copytree(app/'.next-qa/static',runtime/'.next-qa/static',dirs_exist_ok=True);shutil.copytree(app/'public',runtime/'public',dirs_exist_ok=True)
metadata={}
for locale in['fa','en']:
 with urllib.request.urlopen(f'http://127.0.0.1:5080/api/storefront/{locale}?metadataOnly=true',timeout=15)as r:metadata[locale]=r.read(1048577)
mode='normal';reads=[];private=0
rules={'/fa/product/permanent':('/fa/catalog',301,False),'/en/pages/temporary':('/en/support',302,False),'/fa/pages/demo':('/fa/moments',302,True),'/fa/pages/hop-a':('/fa/pages/hop-b',301,False),'/fa/pages/hop-b':('/fa/catalog',302,False)}
class Fixture(BaseHTTPRequestHandler):
 def do_GET(self):
  global private
  u=urlsplit(self.path);status=200;ctype='application/json';data={};raw=None
  if u.path=='/api/content/redirects/resolve':
   source=parse_qs(u.query).get('path',[None])[0];reads.append(source)
   if any(self.headers.get(k)for k in['Authorization','Cookie','Origin','X-Sayman-Admin']):private+=1
   target,code,demo=rules.get(source,(None,None,False));data=dict(version=1,dataSource='api',sourcePath=source,found=target is not None,isDemo=demo,targetPath=target,status=code)
   if mode in['503','404']:status=int(mode)
   elif mode=='external':data.update(targetPath='https://evil.test/')
   elif mode=='cross-locale':data.update(targetPath='/en/catalog')
   elif mode=='private':data.update(actor='synthetic-private')
   elif mode=='wrong-source':data.update(sourcePath='/fa/pages/unrelated')
   elif mode=='invalid-status':data.update(status=307)
   elif mode=='false-with-target':data.update(found=False)
   elif mode=='large':data.update(padding='x'*4097)
   elif mode=='html':ctype='text/html'
   elif mode=='utf8':raw=b'\xc3\x28'
  elif u.path.startswith('/api/storefront/'):
   raw=metadata.get(u.path.split('/')[-1],b'{}')
  elif u.path.startswith('/api/content/pages/'):status=404
  else:status=404
  raw=json.dumps(data).encode()if raw is None else raw;self.send_response(status);self.send_header('Content-Type',ctype);self.send_header('Content-Length',str(len(raw)));self.send_header('Set-Cookie','synthetic-fixture=never-forward');self.end_headers()
  try:self.wfile.write(raw)
  except(BrokenPipeError,ConnectionResetError):pass
 def log_message(self,*a):pass
server=ThreadingHTTPServer(('127.0.0.1',5181),Fixture);server.daemon_threads=True;thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();process=None;checks=[];log=(root/'artifacts/checks/cms-redirects67-native-next-runtime.log').open('w')
def stop():
 global process
 if process is not None and process.poll()is None:
  os.killpg(process.pid,signal.SIGTERM)
  try:process.wait(timeout=5)
  except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait()
 process=None
def start(origin='https://shop.example',preview=False):
 global process
 env=os.environ.copy();env.update(HOSTNAME='127.0.0.1',PORT='3105',SHOP_DATA_MODE='preview'if preview else'api',SHOP_API_URL='http://127.0.0.1:5181',SHOP_PUBLIC_URL=origin,SHOP_ENABLE_INDEXING='false',SHOP_ENABLE_PREVIEW='true',SHOP_PWA_ENABLED='false',NEXT_TELEMETRY_DISABLED='1')
 process=subprocess.Popen(['node',str(runtime/'server.js')],cwd=root,env=env,start_new_session=True,stdout=log,stderr=subprocess.STDOUT)
 for _ in range(100):
  if process.poll()is not None:raise RuntimeError('Owned Next exited')
  try:
   with socket.create_connection(('127.0.0.1',3105),timeout=.2):return
  except OSError:time.sleep(.1)
 raise RuntimeError('Owned Next timeout')
def read(path):
 c=http.client.HTTPConnection('127.0.0.1',3105,timeout=20)
 try:
  c.request('GET',path,headers={'Host':'attacker.example','X-Forwarded-Host':'evil.test','Cookie':'synthetic=private','Authorization':'Bearer synthetic-never-forward','X-Sayman-Admin':'1'});r=c.getresponse();return r.status,{k.lower():v for k,v in r.getheaders()},r.read()
 finally:c.close()
try:
 start()
 for source,(target,status,demo)in rules.items():
  code,headers,body=read(source+'?variant=synthetic');assert code==status,(source,code);assert headers['location']=='https://shop.example'+target;assert headers['cache-control']=='no-store';assert'set-cookie'not in headers;assert('noindex'in headers.get('x-robots-tag',''))==demo;checks.append(dict(path=source,status=code,location=headers['location'],demo=demo))
 for path in['/products/phone-titanium.svg','/api/redirect-private-qa']:
  n=len(reads);status,_,_=read(path);assert len(reads)==n;assert status in[200,404];checks.append(dict(path=path,status=status,noResolverLookup=True))
 status,headers,body=read('/fa/pages/absent-redirect-qa');assert status==404 and 'no-store'in headers['cache-control'],(status,headers);checks.append(dict(path='/fa/pages/absent-redirect-qa',status=404,missingRulePassesToCms404=True))
 for selected in['503','404','external','cross-locale','private','wrong-source','invalid-status','false-with-target','large','html','utf8']:
  mode=selected;status,headers,body=read('/fa/product/permanent');assert status==503,(selected,status);assert'location'not in headers and headers['cache-control']=='no-store'and'noindex'in headers['x-robots-tag'];assert b'synthetic-private'not in body;checks.append(dict(fault=selected,status=503))
 mode='normal';stop();start('https://shop.example/path');status,headers,_=read('/fa/product/permanent');assert status==503 and'location'not in headers;checks.append(dict(fault='invalid-trusted-origin',status=503))
 stop();before=len(reads);start(preview=True);status,_,_=read('/fa/product/iphone-16');assert status==200 and len(reads)==before;checks.append(dict(path='/fa/product/iphone-16',status=200,explicitPreviewNoResolverLookup=True));assert private==0
finally:
 stop();server.shutdown();server.server_close();thread.join(timeout=5);log.close()
report=dict(passed=True,checks=checks,httpChecks=len(checks),redirectFactsSynthetic=True,layoutMetadataReadOnlyLocalApi=True,credentialHeadersForwarded=private,resolverReads=len(reads),mainRulesChanged=False,productionIndexingActivated=False,cleanup='owned process terminal; fixture closed')
(root/'artifacts/checks/cms-redirects67-native-http.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(dict(passed=True,httpChecks=len(checks),resolverReads=len(reads),credentialHeadersForwarded=private)))
