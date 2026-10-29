"""HTTP contract checks for the explicitly enabled standalone fixture preview."""
import http.client,json
from html.parser import HTMLParser
from pathlib import Path
checks=[]
def request(path,body=None,expected=200,origin='http://127.0.0.1:3000',raw=None):
    c=http.client.HTTPConnection('127.0.0.1',3000,timeout=10)
    headers={'Content-Type':'application/json',**({'Origin':origin} if origin else {})}
    c.request('POST' if body is not None or raw is not None else 'GET',path,body=raw if raw is not None else json.dumps(body) if body is not None else None,headers=headers)
    r=c.getresponse();data=r.read();assert r.status==expected,(path,r.status,data[:300]);assert 'no-store' in r.getheader('Cache-Control','');c.close()
    checks.append({'path':path,'status':r.status});return json.loads(data) if data else None
for locale in ['fa','en']:
    first=request(f'/api/catalog/{locale}/search',{'pageSize':2,'page':1});second=request(f'/api/catalog/{locale}/search',{'pageSize':2,'page':2})
    assert first['locale']==locale and len(first['products'])==2 and first['total']>=4
    assert not set(p['id'] for p in first['products'])&set(p['id'] for p in second['products'])
    for p in first['products']:assert any(v['id']==first['matchingVariantIds'][p['id']] for v in p['variants'])
    filters=request(f'/api/catalog/{locale}/filters?categoryId=phones');assert filters['attributes'] and filters['brands']
    p=first['products'][0];lookup=request(f'/api/catalog/{locale}/lookup',{'variantIds':[p['variants'][0]['id']]});assert lookup['products'][0]['id']==p['id']
for locale in ['fa','en']:
    facet=request(f'/api/catalog/{locale}/filters?categoryId=phones')['attributes'][0]
    selected=facet['values'][-1];body={'categoryId':'phones','key':facet['key'],'pageSize':1,'selectedValues':[selected['value']]}
    first=request(f'/api/catalog/{locale}/facet-values',body);second=request(f'/api/catalog/{locale}/facet-values',{**body,'page':2})
    assert first['total']>=3 and first['values'][0]['value']!=second['values'][0]['value']
    assert first['selectedValues'][0]==selected
    search=request(f'/api/catalog/{locale}/facet-values',{**body,'query':'۲۵۶'})
    assert len(search['values'])==1 and search['selectedValues'][0]==selected
request('/api/catalog/fa/facet-values',{'categoryId':'phones','key':'storage','pageSize':61},400)
request('/api/catalog/en/facet-values',{'categoryId':'phones','key':'missing'},400)
request('/api/catalog/fa/facet-values',{'categoryId':'phones','key':'storage','selectedValues':['same','same']},400)
request('/api/catalog/fa/search',{'pageSize':49},400)
request('/api/catalog/en/lookup',{},400)
request('/api/catalog/en/search',raw='{bad}',expected=400)
request('/api/catalog/fa/search',raw=' '*32769,expected=413)
request('/api/catalog/fa/search',{'pageSize':2},403,origin='https://unrelated.example')
request('/api/catalog/fa/private',expected=404)
class Cards(HTMLParser):
    def __init__(self,html):
        super().__init__();self.cards=0;self.links=[];self.inputs={};self.feed(html)
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='article' and 'product-card' in a.get('class','').split():self.cards+=1
        if tag=='a' and 'product-name' in a.get('class','').split():self.links.append(a.get('href'))
        if tag=='input' and a.get('id'):self.inputs[a['id']]=a.get('value')
def html(path):
    c=http.client.HTTPConnection('127.0.0.1',3000,timeout=15);c.request('GET',path);r=c.getresponse();raw=r.read().decode();assert r.status==200,(path,r.status);c.close();checks.append({'path':path,'status':r.status});return raw
for locale in ['fa','en']:
    first=Cards(html(f'/{locale}/catalog?size=2'));second=Cards(html(f'/{locale}/catalog?size=2&page=2'))
    assert first.cards==second.cards==2 and not set(first.links)&set(second.links)
    for route in ['cart','wishlist','compare']:
        raw=html(f'/{locale}/{route}');assert 'priceRial' not in raw,(locale,route,'full product data in root bootstrap')
    raw=html(f'/{locale}/product/iphone-16');assert 0<Cards(raw).cards<=4 and 'iphone-16' in raw
    form=Cards(html(f'/{locale}/installments?product=iphone-16&variant=v1-black'));assert form.inputs['installment-amount']=='76900000'
report={'preview':True,'count':len(checks),'passed':checks};Path('artifacts/checks/catalog-gateway-smoke.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
