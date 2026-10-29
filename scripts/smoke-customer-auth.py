"""Check the local customer auth boundary without a real credential/session."""
from pathlib import Path
from datetime import datetime,timezone
import json,urllib.request,urllib.error
origin='http://127.0.0.1:3000'
cases=[('refresh','POST',{},401,{}),('logout','POST',{},204,{}),('me','GET',None,401,{}),('mfa/setup','POST',{},404,{}),('password','POST',{'padding':'a'*17000},413,{}),('refresh','POST',{},403,{'Origin':'https://untrusted.example'}),('refresh','POST',{},401,{'X-Sayman-Admin':'1','X-Sayman-Client':'admin','Cookie':'sayman_admin_refresh='+'A'*64})]
checks=[]
for path,method,body,expected,extra in cases:
    headers={'Content-Type':'application/json','Origin':origin};headers.update(extra)
    request=urllib.request.Request(origin+'/api/auth/'+path,data=None if body is None else json.dumps(body).encode(),method=method,headers=headers)
    try:response=urllib.request.urlopen(request,timeout=10)
    except urllib.error.HTTPError as error:response=error
    with response:
        assert response.code==expected,(path,response.code,expected)
        cache=response.headers.get('Cache-Control','');assert 'private' in cache and 'no-store' in cache
        assert all(cookie.startswith('sayman_refresh=') for cookie in response.headers.get_all('Set-Cookie',[]))
        response.read();checks.append({'path':path,'status':response.code,'expected':expected,'privateNoStore':True})
report={'at':datetime.now(timezone.utc).isoformat(),'checks':checks,'realCredentialsUsed':False}
(Path(__file__).resolve().parent.parent/'artifacts/checks/customer-auth-proxy.json').write_text(json.dumps(report,indent=2))
print('7 customer auth boundary checks passed; no real credential used.')
