"""Check public production output without browser storage, credentials or real checkout."""
import argparse, http.client, json, struct
from html.parser import HTMLParser
from urllib.parse import urlsplit, quote

class Head(HTMLParser):
    def __init__(self, html):
        super().__init__(); self.meta={}; self.links=[]; self.scripts=[]; self.html={}; self.feed(html)
    def handle_starttag(self, tag, attributes):
        a=dict(attributes)
        if tag=='meta': self.meta[a.get('name',a.get('property',''))]=a.get('content','')
        if tag=='link': self.links.append(a)
        if tag=='script': self.scripts.append(a)
        if tag=='html': self.html=a
    def canonical(self): return next((link['href'] for link in self.links if link.get('rel')=='canonical'),None)

parser=argparse.ArgumentParser(); parser.add_argument('--url',default='http://127.0.0.1:3000'); parser.add_argument('--report'); args=parser.parse_args()
base=urlsplit(args.url); assert base.scheme in ('http','https') and not base.username and not base.password
origin=f'{base.scheme}://{base.netloc}'
def read(path, host=None):
    connection=(http.client.HTTPSConnection if base.scheme=='https' else http.client.HTTPConnection)(base.hostname,base.port,timeout=15)
    connection.request('GET',path,headers={'User-Agent':'Sayman-local-smoke',**({'Host':host} if host else {})})
    response=connection.getresponse(); data=response.read(); headers={key.lower():value for key,value in response.getheaders()}; connection.close()
    assert response.status==200,(path,response.status)
    return headers,data

checks=[]
for locale,direction in [('fa','rtl'),('en','ltr')]:
    headers,raw=read(f'/{locale}/manifest.webmanifest'); manifest=json.loads(raw)
    assert 'manifest+json' in headers['content-type'] and manifest['lang']==locale and manifest['dir']==direction
    assert manifest['start_url']==f'/{locale}' and manifest['scope']=='/' and manifest['display']=='standalone'
    checks.append(f'{locale} localized manifest')
    for size in (180,192,512):
        headers,png=read(f'/pwa/icons/{locale}/{size}.png')
        assert headers['content-type'].startswith('image/png') and png[:8]==b'\x89PNG\r\n\x1a\n' and struct.unpack('>II',png[16:24])==(size,size)
    checks.append(f'{locale} PNG icon dimensions')
    headers,raw=read(f'/pwa/catalog/{locale}.json'); catalog=json.loads(raw)
    assert headers['x-shop-public-resource']=='offline-catalog-v1' and catalog['locale']==locale and catalog['isPreview'] is True
    assert set(catalog['site'])<={'name','tagline','primary'}
    assert all(set(p)<={'id','slug','name','brand','category','description','image'} for p in catalog['products'])
    assert catalog['products']
    checks.append(f'{locale} public catalogue allowlist')
    head=Head(read(f'/{locale}')[1].decode())
    assert head.html['lang']==locale and head.html['dir']==direction and 'noindex' in head.meta['robots']
    assert head.canonical()==f'{origin}/{locale}'
    checks.append(f'{locale} SSR locale and trusted canonical')
    slug=quote(catalog['products'][0]['slug'],safe=''); head=Head(read(f'/{locale}/product/{slug}?variant=ignored')[1].decode())
    assert head.canonical()==f'{origin}/{locale}/product/{slug}' and not any(s.get('type')=='application/ld+json' for s in head.scripts)
    checks.append(f'{locale} product canonical and no preview offers')

head=Head(read('/fa/catalog?category=phones&q=private-search&sort=price',host='spoofed.invalid')[1].decode())
assert head.canonical()==f'{origin}/fa/catalog?category=phones' and 'noindex' in head.meta['robots']
assert 'noindex' in Head(read('/en/account')[1].decode()).meta['robots']
assert b'Disallow: /' in read('/robots.txt')[1] and b'<loc>' not in read('/sitemap.xml')[1]
checks.extend(['facets and spoofed Host do not alter canonical','private pages noindex','preview robots blocked and sitemap empty'])
headers,worker=read('/sw.js'); assert 'no-store' in headers['cache-control'] and headers['service-worker-allowed']=='/' and b'__SAYMAN_PWA_VERSION__' not in worker
checks.append('generated worker headers and content version')
report={'origin':origin,'passed':checks,'count':len(checks),'preview':True}
if args.report:
    from pathlib import Path
    target=Path(args.report); target.parent.mkdir(parents=True,exist_ok=True); target.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
