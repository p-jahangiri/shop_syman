"""Check the production Next media boundary against an explicit synthetic upstream.

No real scanner/S3/SQL acceptance is implied. The owned process and upstream are
stopped on exit, and credentials from the client must never reach that upstream.
"""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hashlib,http.client,json,os,socket,subprocess,threading,time

root=Path(__file__).resolve().parent.parent
image=subprocess.check_output(['node','--input-type=module','-e',"import sharp from 'sharp'; process.stdout.write(await sharp({create:{width:32,height:24,channels:3,background:'#437b74'}}).webp().toBuffer());"],cwd=root)
digest=hashlib.sha256(image).hexdigest();state={'mode':'valid'};seen=[];checks=[]
class Synthetic(BaseHTTPRequestHandler):
    def do_GET(self):
        seen.append({'path':self.path,'cookie':self.headers.get('Cookie'),'authorization':self.headers.get('Authorization'),'range':self.headers.get('Range')})
        mode=state['mode'];status=404 if mode=='missing' else 302 if mode=='redirect' else 503 if mode=='unavailable' else 200
        self.send_response(status)
        headers={'Content-Type':'image/webp','Content-Length':str(len(image)),'ETag':'"'+digest+'"','Cache-Control':'public, max-age=31536000, immutable','X-Shop-Public-Resource':'catalog-image-v1'}
        if mode=='marker':headers.pop('X-Shop-Public-Resource')
        if mode=='mime':headers['Content-Type']='image/svg+xml'
        if mode=='private':headers['Cache-Control']='private, no-store'
        if mode=='cookie':headers['Set-Cookie']='private_test=must-not-forward'
        if mode=='vary':headers['Vary']='Accept-Encoding, Cookie'
        if mode=='hash':headers['ETag']='"'+'0'*64+'"'
        if mode=='oversized':headers['Content-Length']=str(8*1024*1024+1)
        if mode=='redirect':headers['Location']='http://127.0.0.1:1/private'
        for key,value in headers.items():self.send_header(key,value)
        self.end_headers()
        try:self.wfile.write(image)
        except (BrokenPipeError,ConnectionResetError):pass
    def log_message(self,*args):pass
with socket.socket() as probe:
    try:probe.bind(('127.0.0.1',3002))
    except OSError:raise SystemExit('Port 3002 is occupied; nothing was stopped.')
upstream=ThreadingHTTPServer(('127.0.0.1',0),Synthetic);threading.Thread(target=upstream.serve_forever,daemon=True).start()
env=os.environ.copy();env.update({'HOSTNAME':'127.0.0.1','PORT':'3002','NODE_ENV':'production','SHOP_DATA_MODE':'api','SHOP_API_URL':f'http://127.0.0.1:{upstream.server_port}','SHOP_PUBLIC_URL':'http://127.0.0.1:3002','NEXT_TELEMETRY_DISABLED':'1'})
def request(path,expected):
    c=http.client.HTTPConnection('127.0.0.1',3002,timeout=15);c.request('GET',path,headers={'Cookie':'private-test=must-not-forward','Authorization':'Bearer must-not-forward','Range':'bytes=0-10'})
    response=c.getresponse();body=response.read();headers=dict((k.lower(),v) for k,v in response.getheaders());c.close();assert response.status==expected,(state['mode'],path,response.status)
    assert 'set-cookie' not in headers
    if expected==200:
        assert body==image and headers['content-type']=='image/webp' and headers['etag']=='"'+digest+'"'
        assert headers['x-shop-public-resource']=='catalog-image-v1' and 'immutable' in headers['cache-control']
    else:assert 'no-store' in headers.get('cache-control','') and body==b''
    checks.append({'case':state['mode'],'path':path,'status':response.status})
with (root/'artifacts/checks/media-gateway-server.log').open('w') as log:
    process=subprocess.Popen(['node',str(root/'apps/storefront/.next/standalone/apps/storefront/server.js')],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
    try:
        for _ in range(60):
            if process.poll() is not None:raise RuntimeError('Owned Next process exited early.')
            try:
                with socket.create_connection(('127.0.0.1',3002),timeout=.2):break
            except OSError:time.sleep(.1)
        else:raise RuntimeError('Next process did not start.')
        path='/media/catalog/'+'a'*32+'/card.webp'
        request(path,200)
        for mode in ['marker','mime','private','cookie','vary','hash','oversized','redirect','unavailable','missing']:
            state['mode']=mode;request(path,404 if mode=='missing' else 503)
        calls=len(seen);state['mode']='invalid-path'
        for path in ['/media/catalog/'+'A'*32+'/card.webp','/media/catalog/'+'a'*32+'/original.png','/media/catalog/invalid/card.webp']:request(path,404)
        assert len(seen)==calls and all(not row['cookie'] and not row['authorization'] and not row['range'] for row in seen)
        assert all(row['path']=='/api/media/catalog/'+'a'*32+'/card.webp' for row in seen)
        report={'syntheticUpstream':True,'scannerOrS3Acceptance':False,'count':len(checks),'passed':checks,'upstreamReceivedCredentials':False}
        (root/'artifacts/checks/media-gateway-smoke.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'passed':len(checks),'upstreamReceivedCredentials':False}))
    finally:
        process.terminate()
        try:process.wait(timeout=10)
        except subprocess.TimeoutExpired:process.kill();process.wait()
        upstream.shutdown();upstream.server_close()
