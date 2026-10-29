"""Exercise only an isolated, newly generated guest cart through the local BFF.

No account credentials or existing browser cookies are used or saved. Its items
are cleared in finally; no reservation, order, payment or notification is made.
"""
from pathlib import Path
from datetime import datetime, timezone
import http.cookiejar
import json
import urllib.error
import urllib.request

origin = 'http://127.0.0.1:3000'
jar = http.cookiejar.CookieJar()
client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
checks = []

def request(path, method='GET', body=None, expected=200, extra=None):
    headers = {'Content-Type': 'application/json'}
    if method != 'GET': headers['Origin'] = origin
    headers.update(extra or {})
    data = None if body is None else json.dumps(body).encode()
    try: response = client.open(urllib.request.Request(origin + path, data=data, method=method, headers=headers), timeout=15)
    except urllib.error.HTTPError as error: response = error
    with response:
        raw = response.read()
        assert response.code == expected, (path, response.code, expected)
        assert 'no-store' in response.headers.get('Cache-Control', ''), path
        assert 'private' in response.headers.get('Cache-Control', ''), path
        checks.append({'path': path, 'method': method, 'status': response.code, 'expected': expected, 'noStore': True, 'private': True})
        return json.loads(raw) if raw else None, response.headers

with urllib.request.urlopen('http://127.0.0.1:5080/health/ready', timeout=10) as response:
    assert response.code == 200
with urllib.request.urlopen('http://127.0.0.1:5080/api/storefront/en', timeout=10) as response:
    catalog = json.load(response)
variant = next(v for p in catalog['products'] for v in p['variants'] if v['stock'] > 0)
version = None
try:
    empty, headers = request('/api/cart/en')
    assert empty['lines'] == [] and empty['version'] is None and 'Set-Cookie' not in headers
    request('/api/cart/en', 'PUT', {'lines': [], 'version': None}, 403, {'Origin': 'https://untrusted.example'})
    request('/api/cart/en', 'PUT', {'lines': [{'variantId': variant['id'], 'quantity': 1, 'priceRial': '1'}], 'version': None}, 400)
    request('/api/cart/en', 'PUT', {'padding': 'a' * 17000}, 413)
    created, headers = request('/api/cart/en', 'PUT', {'lines': [{'variantId': variant['id'], 'quantity': 1}], 'version': None})
    cookie = headers['Set-Cookie'].lower()
    assert 'httponly' in cookie and 'samesite=strict' in cookie and 'path=/api/cart' in cookie
    assert isinstance(created['subtotalRial'], str) and created['subtotalRial'] == variant['priceRial']
    assert created['lines'][0]['quantity'] == 1
    version = created['version']
    localized, _ = request('/api/cart/fa')
    assert localized['version'] == version and localized['lines'][0]['variantId'] == variant['id']
    replay, _ = request('/api/cart/en', 'PUT', {'lines': [{'variantId': variant['id'], 'quantity': 1}], 'version': None})
    assert replay['version'] == version
    request('/api/cart/en', 'PUT', {'lines': [], 'version': None}, 409)
    request('/api/cart/en/merge', 'POST', {}, 401)
    request('/api/cart/en', expected=401, extra={'Authorization': 'Bearer invalid'})
    request('/api/cart/en', expected=403, extra={'Origin': 'https://untrusted.example'})
    request('/api/cart/en/arbitrary', expected=404)
finally:
    if version:
        cleared, _ = request('/api/cart/en', 'PUT', {'lines': [], 'version': version})
        assert cleared['lines'] == [] and cleared['subtotalRial'] == '0'
        final, _ = request('/api/cart/en')
        assert final['lines'] == []

report = {'at': datetime.now(timezone.utc).isoformat(), 'checks': checks, 'checksPassed': len(checks), 'guestItemsCleared': True, 'credentialsSaved': False}
destination = Path(__file__).resolve().parent.parent / 'artifacts/checks/server-cart-http.json'
destination.write_text(json.dumps(report, indent=2))
print(f'{len(checks)} BFF cart checks passed; isolated guest items cleared; no credentials saved.')
