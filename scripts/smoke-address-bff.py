"""Native built Next boundary checks against explicit no-auth/no-SQL metadata fixture."""
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError
import json
root=Path(__file__).resolve().parent.parent
base='http://127.0.0.1:3105';origin='http://sayman-orders-ui.localhost:3105'
def call(url,method='GET',body=None,headers=None):
    req=Request(url,data=None if body is None else json.dumps(body).encode(),method=method,headers=headers or {})
    try:r=urlopen(req,timeout=15)
    except HTTPError as e:r=e
    with r:return r.status,r.headers,r.read()
_,marker,_=call('http://127.0.0.1:5181/health/live')
if marker.get('X-Sayman-QA')!='logged-out-layout-fixture':raise SystemExit('Owned no-auth fixture required.')
checks=[]
def check(label,path,expected,method='GET',body=None,headers=None):
    status,h,raw=call(base+path,method,body,headers);assert status==expected,(label,status,expected);assert 'no-store' in h.get('Cache-Control',''),label;assert 'noindex' in h.get('X-Robots-Tag',''),label;assert h.get('Set-Cookie') is None,label;checks.append({'check':label,'status':status,'privateNoStore':True})
id='a'*32;path='/api/addresses/'+id
headers={'Origin':origin,'Authorization':'Bearer invalid-test-only-boundary-token','Content-Type':'application/json'}
body={'label':'Sample','contactName':'Synthetic recipient','contactPhone':'09121234567','delivery':{'countryCode':'IR','province':'Sample','city':'Sample','address':'Synthetic test delivery address','postalCode':'1234567890'},'makeDefault':False,'version':None}
check('read requires bearer','/api/addresses',401)
check('unknown owner query rejected','/api/addresses?ownerId=other',400)
check('write requires exact origin',path,403,'PUT',body,{'Origin':'https://untrusted.example'})
check('write requires bearer',path,401,'PUT',body,{'Origin':origin})
check('forged owner rejected',path,400,'PUT',{**body,'ownerId':'other'},headers)
check('explicit default required',path,400,'PUT',{k:v for k,v in body.items() if k!='makeDefault'},headers)
check('oversized input bounded',path,413,'PUT',{**body,'label':'x'*17000},headers)
check('delete current version required',path,400,'DELETE',{},headers)
check('invalid resource rejected','/api/addresses/not-an-id',404,'DELETE',{},headers)
check('unavailable upstream stays unavailable','/api/addresses',503,headers=headers)
for locale in ['fa','en']:
    status,h,raw=call(base+'/'+locale+'/addresses');assert status==200,(locale,status);assert b'noindex, nofollow' in raw,locale;assert b'dataSource' in raw or b'My addresses' in raw or 'نشانی'.encode() in raw,locale;checks.append({'check':locale+' address page renders with noindex','status':status,'cacheControl':h.get('Cache-Control')})
report={'scope':'native built Next HTTP boundary with explicit metadata fixture; no successful authentication, addresses, orders, SQL or providers','passed':len(checks),'checks':checks}
(root/'artifacts/checks/address-next-http.json').write_text(json.dumps(report,indent=2)+'\n');print(str(len(checks))+' native Next address HTTP checks passed.')
