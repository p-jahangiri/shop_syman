"""Verify quote BFF → API → SQL with a new, isolated guest only.

No customer credential, reservation, order, payment or notification is used.
The generated cart is cleared; immutable QA quotes retain their fixed expiry.
"""
from pathlib import Path
from datetime import datetime, timezone
import http.cookiejar
import json
import urllib.error
import urllib.request
import uuid

origin = 'http://127.0.0.1:3000'
client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
checks = []
def request(path, method='POST', body=None, expected=200, extra=None):
    headers = {'Content-Type': 'application/json', 'Origin': origin}
    headers.update(extra or {})
    try: response = client.open(urllib.request.Request(origin + path, data=json.dumps(body or {}).encode() if method != 'GET' else None, method=method, headers=headers), timeout=20)
    except urllib.error.HTTPError as error: response = error
    with response:
        raw = response.read()
        assert response.code == expected, (path, response.code, expected)
        assert 'private' in response.headers.get('Cache-Control', '') and 'no-store' in response.headers.get('Cache-Control', '')
        checks.append({'path': path, 'method': method, 'status': response.code, 'private': True, 'noStore': True})
        return json.loads(raw) if raw else None

with urllib.request.urlopen('http://127.0.0.1:5080/health/ready', timeout=10) as response: assert response.code == 200
with urllib.request.urlopen('http://127.0.0.1:5080/api/storefront/en', timeout=10) as response: catalog = json.load(response)
variant = next(v for p in catalog['products'] for v in p['variants'] if v['stock'] > 1)
version = None
try:
    request('/api/cart/en/quote', body={'cartVersion': 'AAAAAAAAAAE='}, expected=400)
    request('/api/cart/en/quote', body={'cartVersion': 'AAAAAAAAAAE='}, expected=403, extra={'Origin': 'https://untrusted.example'})
    request('/api/cart/en/quote', method='GET', expected=404)
    request('/api/cart/en/quote', body={'padding': 'x' * 17000}, expected=413)
    cart = request('/api/cart/en', 'PUT', {'lines': [{'variantId': variant['id'], 'quantity': 1}], 'version': None}); version = cart['version']
    request('/api/cart/en/quote', body={'cartVersion': version, 'unitPriceRial': '1'}, expected=400)
    overview = request('/api/cart/en/quote', body={'cartVersion': version})
    assert overview['quoteId'] is None and overview['itemsSubtotalRial'] == variant['priceRial']
    assert overview['taxRial'] is None and overview['payableTotalRial'] is None and not overview['canPlaceOrder']
    if overview['shippingRequired']: assert overview['shippingRial'] is None
    fa = request('/api/cart/fa/quote', body={'cartVersion': version}); assert fa['locale'] == 'fa' and fa['itemsSubtotalRial'] == overview['itemsSubtotalRial']
    cash = next(m for m in overview['methods'] if m['kind'] == 'online')
    payload = {'cartVersion': version, 'methodId': cash['id'], 'requestId': str(uuid.uuid4())}
    saved = request('/api/cart/en/quote', body=payload); replay = request('/api/cart/en/quote', body=payload)
    assert saved == replay and saved['quoteId'] and saved['expiresAt']
    request('/api/cart/en/quote', body={**payload, 'planId': overview['plans'][0]['id']}, expected=409)
    cheque = next((m for m in overview['methods'] if m['kind'] == 'cheque'), None)
    if cheque:
        quoted = request('/api/cart/en/quote', body={'cartVersion': version, 'methodId': cheque['id'], 'planId': overview['plans'][0]['id'], 'requestId': str(uuid.uuid4())})
        assert quoted['requiresApproval'] and not quoted['canPlaceOrder']
        assert int(quoted['downPaymentRial']) + sum(int(i['amountRial']) for i in quoted['installments']) == int(quoted['goodsTotalRial'])
    request('/api/cart/en/quote', body={'cartVersion': version}, expected=401, extra={'Authorization': 'Bearer invalid'})
    changed = request('/api/cart/en', 'PUT', {'lines': [{'variantId': variant['id'], 'quantity': 2}], 'version': version}); version = changed['version']
    request('/api/cart/en/quote', body={**payload, 'requestId': str(uuid.uuid4())}, expected=409)
    assert request('/api/cart/en/quote', body=payload) == saved
finally:
    if version:
        cleared = request('/api/cart/en', 'PUT', {'lines': [], 'version': version}); assert cleared['lines'] == []

report = {'at': datetime.now(timezone.utc).isoformat(), 'checks': checks, 'checksPassed': len(checks), 'guestItemsCleared': True, 'credentialsSaved': False, 'ordersOrReservationsCreated': False, 'quoteIdsOrCookiesSaved': False}
(Path(__file__).resolve().parent.parent / 'artifacts/checks/checkout-quote-http.json').write_text(json.dumps(report, indent=2))
print(f'{len(checks)} quote BFF checks passed; guest cart cleared; no credentials saved.')
