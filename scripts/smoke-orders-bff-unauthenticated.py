"""Check the built orders BFF against the explicit logged-out layout fixture.

No real identity, SQL, successful order or provider is used. This is boundary
evidence only; connected order/MFA/stock acceptance still requires SQL QA.
"""
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import json

root = Path(__file__).resolve().parent.parent
origin = 'http://sayman-orders-ui.localhost:3105'
api = 'http://127.0.0.1:5181'

def call(url, method='GET', payload=None, headers=None):
    body = None if payload is None else json.dumps(payload).encode()
    request = Request(url, data=body, method=method, headers=headers or {})
    try:
        response = urlopen(request, timeout=15)
    except HTTPError as error:
        response = error
    with response:
        return response.status, response.headers, response.read()

status, headers, _ = call(api + '/health/live')
if headers.get('X-Sayman-QA') != 'logged-out-layout-fixture':
    raise SystemExit('Refusing to run without the explicit owned layout fixture.')
checks = []

def check(label, path, expected, method='GET', payload=None, headers=None):
    status, response_headers, body = call(origin + path, method, payload, headers)
    assert status == expected, (label, status, expected)
    control = response_headers.get('Cache-Control', '')
    assert 'no-store' in control, (label, control)
    assert 'noindex' in response_headers.get('X-Robots-Tag', ''), label
    assert response_headers.get('Set-Cookie') is None, label
    checks.append({'check': label, 'status': status, 'privateNoStore': True, 'noIndex': True})

base = '/api/orders'
identifier = 'a' * 32
auth = {'Authorization': 'Bearer qa-invalid-token-for-boundary-tests', 'Origin': origin, 'Content-Type': 'application/json'}
input_data = {'quoteId': 'b' * 32, 'requestId': '01234567-89ab-4cde-8012-3456789abcde',
              'contactName': 'Synthetic QA', 'contactPhone': '09123456789', 'delivery': None,
              'note': None, 'acknowledgeTemporary': True}
check('list requires bearer', base, 401)
check('detail requires bearer', base + '/' + identifier, 401)
check('write requires exact origin', base, 403, 'POST', input_data, {'Origin': 'https://untrusted.example'})
check('write requires bearer', base, 401, 'POST', input_data, {'Origin': origin})
check('unknown owner query rejected', base + '?ownerId=other', 400)
check('duplicate cursor rejected', base + '?cursor=a&cursor=b', 400)
check('invalid cursor rejected', base + '?cursor=../admin', 400)
check('oversized body rejected', base, 413, 'POST', {**input_data, 'note': 'x' * 17000}, auth)
check('client price rejected', base, 400, 'POST', {**input_data, 'payableTotalRial': '1'}, auth)
check('client ownership rejected', base, 400, 'POST', {**input_data, 'ownerId': 'other'}, auth)
check('consent required', base, 400, 'POST', {**input_data, 'acknowledgeTemporary': False}, auth)
check('cancel version required', base + '/' + identifier + '/cancel', 400, 'POST', {'version': 'bad'}, auth)
check('unsupported resource rejected', base + '/not-an-order', 404)

status, response_headers, body = call(origin + '/en/orders/' + identifier)
assert status == 200
assert b'noindex, nofollow' in body
checks.append({'check': 'private page metadata remains noindex', 'status': status})
report = {'scope': 'native built Next HTTP boundary; explicit logged-out fixture, no SQL or successful authentication',
          'passed': len(checks), 'checks': checks,
          'notValidated': ['real identity/MFA', 'order creation', 'reservation', 'cancellation transaction', 'payment providers']}
(root / 'artifacts/checks/orders-bff-unauthenticated-http.json').write_text(json.dumps(report, indent=2) + '\n')
print(f'{len(checks)} orders BFF boundary checks passed; no SQL or successful authentication used.')
