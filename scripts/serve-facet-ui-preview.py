"""Isolated UI QA on localhost:83 configured storage options, explicit sample data.

Requires the ordinary fixture storefront on port 3000. This starts an owned API-mode
Next process on 3002 and a loopback-only sample upstream; never used by deployment.
Ctrl-C stops both owned services. No identity, payment or mutation is supported.
"""
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import urlsplit,parse_qs
import copy,http.client,json,os,socket,subprocess,threading
root=Path(__file__).resolve().parent.parent
with socket.socket() as probe:
    try:probe.bind(('127.0.0.1',3002))
    except OSError:raise SystemExit('Port 3002 is occupied. No existing process was changed.')
source="""import {storefrontSnapshot} from './apps/storefront/lib/fixtures.ts';import {localizeData} from './apps/storefront/lib/i18n.ts';import {previewFilters} from './apps/storefront/lib/catalog-preview.ts';process.stdout.write(JSON.stringify(Object.fromEntries(['fa','en'].map(locale=>[locale,{snapshot:{...localizeData(storefrontSnapshot,locale),locale},filters:Object.fromEntries(storefrontSnapshot.categories.map(c=>[c.key,previewFilters(locale,c.key)]))}]))));"""
fixtures=json.loads(subprocess.check_output(['node','--experimental-strip-types','--input-type=module','-e',source],cwd=root))
def options(locale,key):
    values=fixtures[locale]['filters']['phones']['attributes'];facet=next(v for v in values if v['key']==key)
    if key!='storage':return copy.deepcopy(facet['values'])
    return [{'value':f'qa-option-{i:02}','label':f'گزینهٔ نمونه {i}' if locale=='fa' else f'Sample option {i}'} for i in range(80)]+copy.deepcopy(facet['values'])
class Preview(BaseHTTPRequestHandler):
    def respond(self,status,value):
        self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(json.dumps(value,ensure_ascii=False).encode())
    def do_GET(self):
        path=urlsplit(self.path);parts=path.path.strip('/').split('/');params=parse_qs(path.query)
        if len(parts)==3 and parts[:2]==['api','storefront'] and parts[2] in fixtures:
            data=copy.deepcopy(fixtures[parts[2]]['snapshot']);data.update({'dataSource':'api','isPreview':True})
            if params.get('metadataOnly')==['true']:data['products']=[]
            return self.respond(200,data)
        if len(parts)==4 and parts[:2]==['api','catalog'] and parts[2] in fixtures and parts[3]=='filters' and params.get('categoryId')==['phones']:
            data=copy.deepcopy(fixtures[parts[2]]['filters']['phones'])
            for facet in data['attributes']:
                all_values=options(parts[2],facet['key']);facet.update({'values':all_values[:20],'truncated':len(all_values)>20,'total':len(all_values)})
            return self.respond(200,data)
        return self.proxy('GET',None)
    def do_POST(self):
        length=int(self.headers.get('Content-Length','0'))
        if length>32768:return self.respond(413,{'title':'too_large'})
        raw=self.rfile.read(length)
        try:data=json.loads(raw)
        except ValueError:return self.respond(400,{'title':'invalid_json'})
        parts=urlsplit(self.path).path.strip('/').split('/')
        if len(parts)==4 and parts[:2]==['api','catalog'] and parts[2] in fixtures and parts[3]=='facet-values':
            locale=parts[2]
            if data.get('categoryId')!='phones' or data.get('key') not in ['storage','ram','display']:return self.respond(400,{'title':'unknown_facet'})
            values=options(locale,data['key']);other=options('en' if locale=='fa' else 'fa',data['key']);labels={v['value']:v['label'] for v in other};term=(data.get('query') or '').casefold();matching=[v for v in values if term in (v['label']+' '+labels[v['value']]).casefold()];size=data.get('pageSize',20);page=data.get('page',1)
            return self.respond(200,{'version':1,'locale':locale,'key':data['key'],'values':matching[(page-1)*size:page*size],'selectedValues':[v for v in values if v['value'] in data.get('selectedValues',[])],'total':len(matching),'page':page,'pageSize':size,'totalPages':(len(matching)+size-1)//size})
        return self.proxy('POST',raw)
    def proxy(self,method,body):
        if not self.path.startswith('/api/catalog/'):return self.respond(503,{'title':'qa_service_unavailable'})
        connection=http.client.HTTPConnection('127.0.0.1',3000,timeout=10)
        try:
            connection.request(method,self.path,body=body,headers={'Content-Type':'application/json'});response=connection.getresponse();result=json.loads(response.read());return self.respond(response.status,result)
        finally:connection.close()
    def log_message(self,*args):pass
upstream=ThreadingHTTPServer(('127.0.0.1',0),Preview)
threading.Thread(target=upstream.serve_forever,daemon=True).start()
env=os.environ.copy();env.update({'HOSTNAME':'127.0.0.1','PORT':'3002','NODE_ENV':'production','SHOP_DATA_MODE':'api','SHOP_API_URL':f'http://127.0.0.1:{upstream.server_port}','SHOP_PUBLIC_URL':'http://127.0.0.1:3002','NEXT_TELEMETRY_DISABLED':'1'})
process=subprocess.Popen(['node',str(root/'apps/storefront/.next/standalone/apps/storefront/server.js')],cwd=root,env=env)
print('Explicit sample facet UI: http://127.0.0.1:3002/fa/catalog?category=phones',flush=True)
try:process.wait()
except KeyboardInterrupt:pass
finally:
    process.terminate()
    try:process.wait(timeout=10)
    except subprocess.TimeoutExpired:process.kill();process.wait()
    upstream.shutdown();upstream.server_close()
