"""Owned API-mode standalone process: an unavailable upstream must never expose fixtures."""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import http.client,json,os,socket,subprocess,threading,time
root=Path(__file__).resolve().parent.parent
seen=[]
class Unavailable(BaseHTTPRequestHandler):
    def reply(self):
        seen.append({'path':self.path,'cookie':self.headers.get('Cookie'),'authorization':self.headers.get('Authorization')})
        if self.command=='POST':self.rfile.read(int(self.headers.get('Content-Length','0')))
        self.send_response(503);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(b'{"title":"test upstream unavailable"}')
    do_GET=reply;do_POST=reply
    def log_message(self,*args):pass
with socket.socket() as probe:
    try:probe.bind(('127.0.0.1',3002))
    except OSError:raise SystemExit('Port 3002 is in use; no process was changed.')
upstream=ThreadingHTTPServer(('127.0.0.1',0),Unavailable)
threading.Thread(target=upstream.serve_forever,daemon=True).start()
env=os.environ.copy();env.update({'HOSTNAME':'127.0.0.1','PORT':'3002','NODE_ENV':'production','SHOP_DATA_MODE':'api','SHOP_API_URL':f'http://127.0.0.1:{upstream.server_port}','SHOP_PUBLIC_URL':'http://127.0.0.1:3002','NEXT_TELEMETRY_DISABLED':'1'})
log=root/'artifacts/checks/catalog-failure-server.log'
with log.open('w') as output:
    process=subprocess.Popen(['node',str(root/'apps/storefront/.next/standalone/apps/storefront/server.js')],cwd=root,env=env,stdout=output,stderr=subprocess.STDOUT)
    try:
        for _ in range(50):
            if process.poll() is not None:raise SystemExit('Owned API-mode process exited early.')
            try:
                with socket.create_connection(('127.0.0.1',3002),timeout=.2):break
            except OSError:time.sleep(.1)
        else:raise SystemExit('Owned API-mode process did not start.')
        checks=[]
        for locale,action,body in [('fa','search',{'pageSize':2}),('en','lookup',{'productIds':['p1']}),('fa','filters',None),('en','facet-values',{'categoryId':'phones','key':'storage'})]:
            path=f'/api/catalog/{locale}/{action}';c=http.client.HTTPConnection('127.0.0.1',3002,timeout=10)
            c.request('GET' if body is None else 'POST',path,body=None if body is None else json.dumps(body),headers={'Origin':'http://127.0.0.1:3002','Content-Type':'application/json','Cookie':'private-test=must-not-forward','Authorization':'Bearer test-only-must-not-forward'})
            r=c.getresponse();data=r.read();assert r.status==503,(path,r.status);assert 'no-store' in r.getheader('Cache-Control','');payload=json.loads(data);assert 'products' not in payload and b'iphone' not in data.lower();c.close();checks.append({'path':path,'status':503})
        assert len(seen)==4 and all(not r['cookie'] and not r['authorization'] for r in seen),seen
        report={'mode':'api','unavailableUpstream':True,'count':len(checks),'passed':checks,'upstreamReceivedCredentials':False}
        (root/'artifacts/checks/catalog-failure-smoke.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
    finally:
        process.terminate()
        try:process.wait(timeout=10)
        except subprocess.TimeoutExpired:process.kill();process.wait()
        upstream.shutdown();upstream.server_close()
