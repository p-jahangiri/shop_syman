"""Built-Next sitemap checks with explicit synthetic public metadata/URL keys.

The trusted HTTPS origin is fixture configuration only; all requests stay on
loopback. No search engine submission, database or successful identity is used.
Only owned QA process groups are started/stopped; occupied ports are refused.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
import http.client
import json
import os
import shutil
import signal
import socket
import subprocess
import threading
import time
import xml.etree.ElementTree as ET

root=Path(__file__).resolve().parent.parent;app=root/'apps/storefront';runtime=app/'.next-qa/standalone/apps/storefront'
if not (runtime/'server.js').is_file():raise SystemExit('Build the isolated storefront first.')
for port in [3105,5181]:
    with socket.socket() as probe:
        try:probe.bind(('127.0.0.1',port))
        except OSError:raise SystemExit(f'QA port {port} occupied; no process was changed.')
shutil.copytree(app/'.next-qa/static',runtime/'.next-qa/static',dirs_exist_ok=True);shutil.copytree(app/'public',runtime/'public',dirs_exist_ok=True)
mode='normal';full_snapshots=0;private_headers=0;request_count=0

class PublicKeys(BaseHTTPRequestHandler):
    def cms(self,url,parts):
        if len(parts) not in [4,5] or parts[:3]!=['api','content','page-sitemap'] or parts[3] not in ['fa','en']:return False
        locale=parts[3];status=200;content_type='application/json'
        if len(parts)==4:
            data={'version':1,'dataSource':'api','locale':locale,'isPreview':False,'allowIndexing':True,'pageSize':1000,'pageCount':'1001' if mode.startswith('cms-') else '0'}
            if mode=='cms-preview':data['isPreview']=True
            elif mode=='cms-single-language' and locale=='en':data['allowIndexing']=False
            elif mode=='cms-meta-failure':status=503;data={'title':'synthetic_cms_unavailable'}
            elif mode=='cms-private-meta':data['draftJson']='must-not-be-published'
            elif mode=='cms-wrong-locale':data['locale']='fa'
            elif mode=='cms-numeric-count':data['pageCount']=1001
            elif mode=='cms-index-capacity':data['pageCount']='50000000'
        elif parts[4]=='entries':
            page=int(parse_qs(url.query).get('page',['0'])[0]);start=(page-1)*1000
            items=[{'key':f'cms-guide-{i}','fa':True,'en':True,'lastModified':'2026-10-27T16:00:00.1234567+00:00'}for i in range(start,min(start+1000,1001))]
            data={'version':1,'locale':locale,'kind':'pages','page':page,'pageSize':1000,'items':items}
            if mode=='cms-private-page':data['items'][0]['ownerId']='must-not-be-published'
            elif mode=='cms-wrong-page':data['page']=page+1
            elif mode=='cms-bad-lastmod':data['items'][0]['lastModified']='2026-10-27T16:00:00+03:30'
            elif mode=='cms-duplicate-key':data['items'][1]['key']=data['items'][0]['key']
            elif mode=='cms-large-page':data['padding']='x'*525000
            elif mode=='cms-empty-page':data['items']=[]
        else:return False
        raw=b'\xc3\x28'if mode=='cms-bad-utf8'and len(parts)==5 else json.dumps(data).encode();self.send_response(status);self.send_header('Content-Type',content_type);self.send_header('Content-Length',str(len(raw)));self.send_header('Set-Cookie','synthetic-cms-cookie=must-not-forward');self.end_headers()
        try:self.wfile.write(raw)
        except (BrokenPipeError,ConnectionResetError):pass
        return True
    def do_GET(self):
        global full_snapshots,private_headers,request_count
        request_count+=1;url=urlsplit(self.path);parts=url.path.strip('/').split('/')
        if url.path.startswith('/api/storefront/'):full_snapshots+=1
        if any(self.headers.get(key) for key in ['Cookie','Authorization','Origin','X-Sayman-Admin']):private_headers+=1
        if self.cms(url,parts):return
        if len(parts) not in [4,5] or parts[:2]!=['api','catalog'] or parts[2] not in ['fa','en'] or parts[3]!='sitemap':
            self.send_response(503);self.end_headers();return
        locale=parts[2];status=200;content_type='application/json'
        if len(parts)==4:
            data={'version':1,'dataSource':'api','locale':locale,'isPreview':False,'allowIndexing':True,'pageSize':1000,'productCount':'1001' if locale=='fa' else '1000','categoryCount':'1'}
            if mode=='preview':data['isPreview']=True
            elif mode=='single-language' and locale=='en':data['allowIndexing']=False
            elif mode=='meta-failure' and locale=='fa':status=503;data={'private':'must-not-be-published'}
            elif mode=='wrong-locale':data['locale']='fa'
            elif mode=='numeric-count':data['productCount']=1001
            elif mode=='index-capacity':data['productCount']='50000000';data['categoryCount']='0'
            elif mode=='private-meta':data['contact']={'token':'must-not-be-published'}
            elif mode=='large-meta':data['padding']='x'*9000
        else:
            kind=parts[4];page=int(parse_qs(url.query).get('page',['0'])[0])
            items=[{'key':f'product-{i}','fa':True,'en':True} for i in range(1000)] if kind=='products' and page==1 else [{'key':'persian-only','fa':True,'en':False}] if kind=='products' else [{'key':'phones','fa':True,'en':True}]
            data={'version':1,'locale':locale,'kind':kind,'page':page,'pageSize':1000,'items':items}
            if mode=='private-page':data['items'][0]['priceRial']='1'
            elif mode=='unsafe-key':data['items'][0]['key']='../account'
            elif mode=='wrong-page':data['page']=page+1
            elif mode=='wrong-kind':data['kind']='categories' if kind=='products' else 'products'
            elif mode=='missing-self':data['items'][0][locale]=False
            elif mode=='oversize-page':data['items'].append({'key':'extra','fa':True,'en':True})
            elif mode=='page-html':content_type='text/html'
        raw=json.dumps(data).encode();self.send_response(status);self.send_header('Content-Type',content_type);self.send_header('Content-Length',str(len(raw)));self.send_header('Set-Cookie','private-upstream=must-not-forward');self.end_headers()
        try:self.wfile.write(raw)
        except (BrokenPipeError,ConnectionResetError):pass
    def log_message(self,*_):pass

server=ThreadingHTTPServer(('127.0.0.1',5181),PublicKeys);server.daemon_threads=True
thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
process=None;checks=[];log=(root/'artifacts/checks/cms-page-sitemap-next-runtime.log').open('w')
ns={'s':'http://www.sitemaps.org/schemas/sitemap/0.9','x':'http://www.w3.org/1999/xhtml'}

def start(enabled):
    environment=os.environ.copy();environment.update({'HOSTNAME':'127.0.0.1','PORT':'3105','SHOP_DATA_MODE':'api','SHOP_API_URL':'http://127.0.0.1:5181','SHOP_PUBLIC_URL':'https://shop.example','SHOP_ENABLE_INDEXING':'true' if enabled else 'false','SHOP_PWA_ENABLED':'false','NEXT_TELEMETRY_DISABLED':'1'})
    child=subprocess.Popen(['node',str(runtime/'server.js')],cwd=root,env=environment,start_new_session=True,stdout=log,stderr=subprocess.STDOUT)
    try:
        for _ in range(100):
            if child.poll() is not None:raise RuntimeError('Owned QA Next exited early.')
            try:
                with socket.create_connection(('127.0.0.1',3105),timeout=.3):return child
            except OSError:time.sleep(.1)
        raise RuntimeError('Owned QA Next readiness timeout.')
    except BaseException:
        stop(child);raise

def stop(child):
    if child is not None and child.poll() is None:
        try:os.killpg(child.pid,signal.SIGTERM)
        except ProcessLookupError:pass
        try:child.wait(timeout=5)
        except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait()

def read(path):
    connection=http.client.HTTPConnection('127.0.0.1',3105,timeout=15)
    try:
        connection.request('GET',path,headers={'Host':'untrusted.example','Authorization':'Bearer synthetic-never-forward','Cookie':'synthetic-never-forward=1','X-Sayman-Admin':'1'})
        response=connection.getresponse();return response.status,{k.lower():v for k,v in response.getheaders()},response.read()
    finally:connection.close()

try:
    process=start(True)
    status,headers,raw=read('/sitemap.xml');assert status==200;index=ET.fromstring(raw);locations=[e.text for e in index.findall('s:sitemap/s:loc',ns)];assert len(locations)==7;assert all(p.startswith('https://shop.example/sitemap-') and p.count('/')==3 for p in locations);assert 'https://shop.example/sitemap-fa-products-2.xml' in locations;assert 'untrusted.example' not in raw.decode();assert 'set-cookie' not in headers;checks.append('trusted-origin paginated index with no credential forwarding')
    for path,count in [('/sitemap-fa-products-1.xml',1000),('/sitemap-fa-products-2.xml',1),('/sitemap-en-products-1.xml',1000),('/sitemap-fa-categories-1.xml',1),('/sitemap-fa-site.xml',2)]:
        status,headers,raw=read(path);assert status==200,(path,status);document=ET.fromstring(raw);urls=document.findall('s:url',ns);assert len(urls)==count;assert 'no-store' in headers['cache-control'];assert 'application/xml' in headers['content-type'];assert not document.findall('.//s:lastmod',ns)
        for node in urls:assert node.find('s:loc',ns).text in [link.attrib['href'] for link in node.findall('x:link',ns)]
        if path.endswith('products-2.xml'):assert all(link.attrib['hreflang']=='fa' for link in urls[0].findall('x:link',ns))
        checks.append(path+' rows/self-alternates and direct XML route')
    status,_,raw=read('/robots.txt');assert status==200;assert b'Sitemap: https://shop.example/sitemap.xml' in raw and b'/fa/orders' in raw;checks.append('robots uses the trusted index and excludes private pages')
    for path in ['/sitemap-fa-products-0.xml','/sitemap-fa-products-01.xml','/sitemap-fa-products-50001.xml','/sitemap-fa-private.xml','/sitemap-de-site.xml','/sitemap-en-products-2.xml']:
        assert read(path)[0]==404,path;checks.append(path+' rejected')
    mode='single-language';status,_,raw=read('/sitemap.xml');assert status==200 and b'/sitemap-en-' not in raw
    status,_,raw=read('/sitemap-fa-products-1.xml');assert status==200 and b'hreflang="en"' not in raw;checks.append('disabled English is absent from index and alternates')
    mode='preview';status,_,raw=read('/sitemap.xml');assert status==200 and not ET.fromstring(raw).findall('s:url',ns);assert read('/sitemap-fa-site.xml')[0]==404;checks.append('API preview never publishes URL entries')
    for selected in ['meta-failure','wrong-locale','numeric-count','index-capacity','private-meta','large-meta','private-page','unsafe-key','wrong-page','wrong-kind','missing-self','oversize-page','page-html']:
        mode=selected;path='/sitemap.xml' if selected in ['meta-failure','wrong-locale','numeric-count','index-capacity','private-meta','large-meta'] else '/sitemap-fa-products-1.xml'
        status,headers,raw=read(path);assert status==503,(selected,status);assert headers['cache-control']=='no-store';assert headers['retry-after']=='60';assert json.loads(raw)=={'title':'sitemap_unavailable'};checks.append(selected+' fails retryably without partial output')
    mode='cms-normal';status,headers,raw=read('/sitemap.xml');assert status==200;locations=[x.text for x in ET.fromstring(raw).findall('s:sitemap/s:loc',ns)];assert len(locations)==11 and 'https://shop.example/sitemap-fa-pages-2.xml'in locations and 'https://shop.example/sitemap-en-pages-2.xml'in locations;assert b'untrusted.example'not in raw and 'set-cookie'not in headers;checks.append('CMS and catalogue share one trusted root index with all 1000-row partitions')
    for path,count in[('/sitemap-fa-pages-1.xml',1000),('/sitemap-en-pages-2.xml',1)]:
        status,headers,raw=read(path);assert status==200;rows=ET.fromstring(raw).findall('s:url',ns);assert len(rows)==count and'no-store'in headers['cache-control']and'set-cookie'not in headers
        for row in rows:
            assert row.find('s:lastmod',ns).text=='2026-10-27T16:00:00.1234567+00:00';assert len(row.findall('x:link',ns))==2;assert row.find('s:loc',ns).text in[x.attrib['href']for x in row.findall('x:link',ns)]
        checks.append(path+' exact UTC lastmod and reciprocal self alternatives')
    for path in['/sitemap-fa-pages-0.xml','/sitemap-fa-pages-01.xml','/sitemap-fa-pages-50001.xml','/sitemap-fa-pages-3.xml']:
        assert read(path)[0]==404,path;checks.append(path+' rejected')
    mode='cms-single-language';status,_,raw=read('/sitemap.xml');assert status==200 and b'sitemap-en-pages-'not in raw and b'sitemap-en-products-'in raw;status,_,raw=read('/sitemap-fa-pages-1.xml');assert status==200 and b'hreflang="en"'not in raw;checks.append('CMS locale opt-out removes only its partition and alternates')
    mode='cms-preview';status,_,raw=read('/sitemap.xml');assert status==200 and b'-pages-'not in raw;assert read('/sitemap-fa-pages-1.xml')[0]==404;checks.append('CMS preview never authorizes indexing even when catalogue is eligible')
    for selected in['cms-meta-failure','cms-private-meta','cms-numeric-count','cms-index-capacity','cms-wrong-locale','cms-private-page','cms-wrong-page','cms-bad-lastmod','cms-duplicate-key','cms-bad-utf8','cms-large-page']:
        mode=selected;path='/sitemap.xml'if selected in['cms-meta-failure','cms-private-meta','cms-numeric-count','cms-index-capacity','cms-wrong-locale']else'/sitemap-fa-pages-1.xml';status,headers,raw=read(path);assert status==503,(selected,status);assert headers['cache-control']=='no-store'and headers['retry-after']=='60'and json.loads(raw)=={'title':'sitemap_unavailable'};checks.append(selected+' rejected without a partial index or page')
    mode='cms-meta-failure';assert read('/sitemap-fa-products-1.xml')[0]==200;checks.append('catalogue XML remains independent of a CMS source outage')
    mode='cms-empty-page';assert read('/sitemap-fa-pages-1.xml')[0]==404;checks.append('publication changes leaving an empty partition produce404')
    stop(process);process=None;mode='meta-failure';before=request_count;process=start(False);status,_,raw=read('/sitemap.xml');assert status==200 and not ET.fromstring(raw).findall('s:url',ns);assert request_count==before;checks.append('deployment indexing off performs zero API reads')
    assert full_snapshots==0 and private_headers==0
finally:
    stop(process);server.shutdown();server.server_close();thread.join(timeout=5);log.close()

report={'scope':'built Next CMS+catalogue XML with explicit synthetic public key/count/UTC upstream; no SQL/identity or production indexing activation','passed':len(checks),'checks':checks,'fullStorefrontReads':full_snapshots,'credentialHeadersForwarded':private_headers,'upstreamRequests':request_count,'cleanup':'owned QA processes terminal and fixture closed','sqlAcceptance':'separate real SQL projection tests; this native exporter upstream is explicitly synthetic only','productionIndexingActivated':False,'cmsUtcTimesAreSyntheticExporterFixtures':True}
(root/'artifacts/checks/cms-page-sitemap-native-http.json').write_text(json.dumps(report,indent=2)+'\n');print(f'{len(checks)} sitemap HTTP checks passed; no full storefront reads or credential forwarding.')
