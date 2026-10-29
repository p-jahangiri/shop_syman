"""Provision one owned D41 QA SKU through normal authenticated admin HTTP APIs.

No credentials or tokens are printed/captured. This script never connects to SQL,
adjusts inventory, creates a quote/request, or initiates a payment.
"""
from pathlib import Path
import argparse, base64, hashlib, hmac, json, os, re, struct, time, uuid
import urllib.error, urllib.request
from urllib.parse import urlsplit
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent
SAMPLE_PRICE = '123450000'

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, url):
        raise RuntimeError('The owned QA API attempted to redirect; no redirect was followed.')

def unique(values, message):
    rows = list(values)
    if len(rows) != 1:
        raise RuntimeError(message)
    return rows[0]

def local_endpoint(raw, *, api):
    """Bind explicit endpoints to loopback-only disposable QA transports."""
    try:
        url = urlsplit(raw)
        host, port = url.hostname, url.port
    except ValueError:
        raise RuntimeError('An explicit valid local QA endpoint is required.') from None
    valid_host = host in ('127.0.0.1', 'localhost') if api else host in ('127.0.0.1', 'localhost') or bool(host and host.endswith('.localhost'))
    if (url.scheme != 'http' or not valid_host or port is None or not 1024 <= port <= 65535
        or url.username is not None or url.password is not None or url.path not in ('', '/') or url.query or url.fragment):
        raise RuntimeError('Use an explicit HTTP loopback QA origin with an unprivileged port and no path or credentials.')
    return url.scheme + '://' + host + ':' + str(port), port

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--run-id', required=True)
    parser.add_argument('--descriptor', required=True, type=Path, help='Explicit private owned QA descriptor inside this workspace tmp directory.')
    parser.add_argument('--api', required=True, help='Explicit loopback QA API origin; must match descriptor.apiPort.')
    parser.add_argument('--admin-origin', required=True, help='Explicit local QA admin origin; must match descriptor.adminPort.')
    args = parser.parse_args()
    if not re.fullmatch('[a-f0-9]{32}', args.run_id):
        raise RuntimeError('An exact owned phone QA run ID is required.')
    api, api_port = local_endpoint(args.api, api=True)
    origin, admin_port = local_endpoint(args.admin_origin, api=False)
    if api_port == admin_port:
        raise RuntimeError('The QA API and admin must use separate bound ports.')
    state_path = args.descriptor if args.descriptor.is_absolute() else ROOT / args.descriptor
    if state_path.is_symlink() or not state_path.resolve().is_relative_to((ROOT / 'tmp').resolve()) or state_path.suffix != '.json':
        raise RuntimeError('Use the explicit owned non-symlink QA JSON descriptor inside workspace tmp.')
    state_path = state_path.resolve()
    descriptor_raw = state_path.read_bytes()
    descriptor_sha256 = hashlib.sha256(descriptor_raw).hexdigest()
    initial = json.loads(descriptor_raw)
    expected_directory = Path(initial.get('directory', ''))
    if (not expected_directory.is_absolute() or expected_directory.is_symlink()
        or not expected_directory.resolve().is_relative_to((ROOT / 'tmp').resolve())):
        raise RuntimeError('The QA descriptor must point to its owned private directory inside workspace tmp.')
    def state():
        if state_path.is_symlink():
            raise RuntimeError('The owned QA descriptor changed to a symlink.')
        raw = state_path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != descriptor_sha256:
            raise RuntimeError('The bound QA descriptor bytes changed; no further HTTP call is allowed.')
        current = json.loads(raw)
        if (current.get('runId') != args.run_id or current.get('syntheticTestOnly') is not True
            or current.get('mainChanged') is not False or current.get('apiPort') != api_port
            or current.get('adminPort') != admin_port
            or not re.fullmatch('SaymanTest_[a-f0-9]{32}', current.get('connectionDatabase', ''))
            or Path(current.get('directory', '')).resolve() != expected_directory.resolve()
            or current.get('connectionDatabase') != initial.get('connectionDatabase')
            or current.get('pid') != initial.get('pid')
            or expected_directory.is_symlink()):
            raise RuntimeError('Owned disposable phone QA identity changed; no further HTTP mutation is allowed.')
        os.kill(int(current['pid']), 0)
        return current
    current = state()
    credential_path = expected_directory / 'credentials.json'
    if credential_path.is_symlink() or credential_path.stat().st_mode & 0o077:
        raise RuntimeError('QA credentials must remain an owner-only regular file.')
    credentials = json.loads(credential_path.read_text())
    if credentials.get('runId') != args.run_id or credentials.get('syntheticTestOnly') is not True:
        raise RuntimeError('Credentials do not belong to this synthetic QA run.')
    account = credentials['admin']
    output = ROOT / ('artifacts/checks/phone-qa-sku-' + args.run_id)
    output.mkdir(parents=True, exist_ok=True)
    manifest = {'schemaVersion': 1, 'runId': args.run_id, 'syntheticTestOnly': True,
        'database': current['connectionDatabase'], 'api': api, 'adminOrigin': origin,
        'descriptor': str(state_path.relative_to(ROOT)),
        'descriptorSha256': descriptor_sha256,
        'samplePriceRial': SAMPLE_PRICE, 'realMarketPriceClaim': False,
        'inventoryMutationPerformed': False, 'quoteRequestOrPaymentCreated': False,
        'credentialsCaptured': False, 'mainChanged': False, 'requests': []}
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    access = None
    def call(method, path, body=None, capture=None, authentication=False):
        state()
        if not path.startswith('/api/') or '\\' in path or '..' in path:
            raise RuntimeError('Only normal owned API paths are allowed.')
        raw = None if body is None else json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode()
        headers = {'Origin': origin, 'X-Sayman-Client': 'admin', 'X-Sayman-Admin': '1', 'Accept': 'application/json'}
        if raw is not None: headers['Content-Type'] = 'application/json'
        if access: headers['Authorization'] = 'Bearer ' + access
        request = urllib.request.Request(api + path, data=raw, headers=headers, method=method)
        try:
            with opener.open(request, timeout=45) as response:
                status, payload = response.status, response.read()
        except urllib.error.HTTPError as error:
            payload = error.read()
            manifest['requests'].append({'method': method, 'path': path, 'status': error.code})
            # Authentication responses are intentionally never captured, even on failure.
            if capture and not authentication:
                (output / (capture + '-error.json')).write_bytes(payload)
            raise RuntimeError('Owned QA API rejected ' + method + ' ' + path + ' with HTTP ' + str(error.code)) from None
        manifest['requests'].append({'method': method, 'path': path, 'status': status})
        if capture and not authentication:
            (output / (capture + '.json')).write_bytes(payload)
            if raw is not None: (output / (capture + '-input.json')).write_bytes(raw)
        return json.loads(payload)
    try:
        pending = call('POST', '/api/auth/password', {'identifier': account['username'], 'password': account['password']}, authentication=True)
        if pending.get('requiresMfa') is not True or pending.get('requiresEnrollment') is not False:
            raise RuntimeError('The generated QA administrator must use its enrolled normal MFA flow.')
        access = pending['accessToken']
        # A fresh time window also avoids consuming a counter used by browser QA.
        time.sleep(31 - time.time() % 30)
        counter = int(time.time()) // 30
        key = account['authenticatorKey'].upper()
        secret = base64.b32decode(key + '=' * ((8 - len(key) % 8) % 8))
        digest = hmac.new(secret, struct.pack('>Q', counter), hashlib.sha1).digest()
        offset = digest[-1] & 15
        code = str((struct.unpack('>I', digest[offset:offset + 4])[0] & 0x7fffffff) % 1000000).zfill(6)
        verified = call('POST', '/api/auth/mfa/verify', {'code': code}, authentication=True)
        if verified.get('requiresMfa') or verified.get('user', {}).get('id') != account['id']:
            raise RuntimeError('Authenticated identity does not match the unique owned QA administrator.')
        access = verified['accessToken']
        manifest['authenticatedOwnedAdministrator'] = True
        manifest['nextFreshMfaWindowUtc'] = datetime.fromtimestamp((counter + 1) * 30 + 1, timezone.utc).isoformat()
        page = call('POST', '/api/phones/fa/search', {'query': 'Galaxy A56', 'page': 1, 'pageSize': 24}, 'phone-before')
        phone = unique((item for item in page['items'] if item['model']['slug'] == 'samsung-galaxy-a56-5g'), 'The owned A56 phone model was not unique.')
        if phone['isDemo'] is not True: raise RuntimeError('Only a demo phone may be provisioned by this script.')
        choice = unique((row for row in phone['configurations'] if row['ramGb'] == 8 and row['storageGb'] == 256 and row['colorNameEn'] == 'Awesome Pink'), 'The exact reviewed A56 8/256 Awesome Pink choice was not unique.')
        listing = call('GET', '/api/admin/market/' + phone['id'], capture='listing-before')
        if listing['modelId'] != phone['model']['id'] or listing['details']['isDemo'] is not True:
            raise RuntimeError('The admin listing is not the same demo phone model.')
        catalog = call('GET', '/api/admin/catalog', capture='catalog-before')
        product = unique((row for row in catalog['products'] if row['id'] == listing['modelId']), 'The existing Catalog model was not found.')
        if product['isDigital'] or product['slug'] != 'samsung-galaxy-a56-5g' or product['categoryId'] != 'phones':
            raise RuntimeError('Only the existing physical A56 phone Catalog model is permitted.')
        methods = call('GET', '/api/admin/purchase-methods', capture='purchase-methods')
        payment = unique((row for row in methods if row['id'] == 'online' and row['kind'] == 'online' and row['enabled']), 'The existing enabled full-payment method is unavailable.')
        def memory_option(key, capacity):
            definition = unique((row for row in catalog['attributes'] if row['key'] == key), 'A typed memory definition is missing.')
            if definition['dataType'] != 'Select': raise RuntimeError('This QA script expects the existing Select memory contract; it will not rewrite metadata.')
            option = unique((row for row in definition['options'] if row['labelEn'].replace(' ', '').lower() == str(capacity) + 'gb'), 'An exact GB option is missing or ambiguous.')
            return {'attributeId': definition['id'], 'optionId': option['id']}
        axes = [memory_option('ram', 8), memory_option('storage', 256)]
        def values(rows):
            result = []
            for row in rows:
                value = {'attributeId': row['attributeId']}
                for source, target in [('valueTextFa', 'textFa'), ('valueTextEn', 'textEn'), ('valueNumber', 'number'), ('valueBool', 'bool'), ('valueOptionId', 'optionId')]:
                    if row.get(source) is not None: value[target] = row[source]
                if row.get('selections'): value['optionIds'] = [selection['optionId'] for selection in row['selections']]
                result.append(value)
            return result
        def variant_input(row):
            return {'id': row['id'], 'sku': row['sku'], 'priceRial': str(row['priceRial']), 'compareAtRial': None if row.get('compareAtPriceRial') is None else str(row['compareAtPriceRial']),
                **{key: row[key] for key in ['color', 'colorNameFa', 'colorNameEn', 'labelFa', 'labelEn', 'warrantyFa', 'warrantyEn', 'isActive', 'version']},
                'attributes': values(row['attributes']), 'purchaseMethodIds': [link['methodId'] for link in row['purchaseMethods']]}
        sku = 'QA-D41-A56-8-256-PINK-' + args.run_id[:8].upper()
        existing = [row for row in product['variants'] if row['sku'] == sku]
        if len(existing) > 1: raise RuntimeError('The owned QA SKU is duplicated.')
        if not existing:
            variant = {'id': None, 'sku': sku, 'priceRial': SAMPLE_PRICE, 'compareAtRial': None, 'color': choice['colorHex'],
                'colorNameFa': choice['colorNameFa'], 'colorNameEn': choice['colorNameEn'],
                'labelFa': '۸ / ۲۵۶ گیگابایت · صورتی · نمونهٔ آزمایش D41', 'labelEn': '8 / 256 GB · Awesome Pink · Synthetic D41 QA',
                'warrantyFa': 'گارانتی نمونهٔ آزمایش؛ تعهد تجاری نیست', 'warrantyEn': 'Synthetic QA warranty; no commercial guarantee',
                'isActive': True, 'attributes': axes, 'purchaseMethodIds': [payment['id']], 'version': None}
            body = {'categoryId': product['categoryId'], 'brandId': product['brandId'], 'slug': product['slug'], 'status': 'Published', 'isDigital': False,
                'featured': product['featured'], 'translations': [{**{key: row[key] for key in ['locale', 'name', 'description']}, 'badge': row.get('badge')} for row in product['translations']],
                'attributes': values(product['attributes']), 'variants': [variant_input(row) for row in product['variants']] + [variant],
                'imageUrls': [row['url'] for row in sorted(product['media'], key=lambda row: row['sortOrder'])],
                'purchaseMethodIds': list(dict.fromkeys([row['methodId'] for row in product['purchaseMethods']] + [payment['id']])),
                'chequePlanIds': [row['planId'] for row in product['creditPlans']], 'version': product['version']}
            call('PUT', '/api/admin/products/' + product['id'], body, 'product-save')
        after_catalog = call('GET', '/api/admin/catalog', capture='catalog-after')
        after_product = unique((row for row in after_catalog['products'] if row['id'] == product['id']), 'Updated Catalog model is missing.')
        actual = unique((row for row in after_product['variants'] if row['sku'] == sku), 'The owned QA SKU is missing.')
        if (str(actual['priceRial']) != SAMPLE_PRICE or actual['colorNameEn'] != choice['colorNameEn'] or not actual['isActive']
            or any(not any(row['attributeId'] == axis['attributeId'] and row.get('valueOptionId') == axis['optionId'] for row in actual['attributes']) for axis in axes)):
            raise RuntimeError('The existing QA SKU does not have the exact explicitly requested sample terms.')
        configs = call('GET', '/api/admin/market/' + phone['id'] + '/phone-configurations', capture='configurations-before-link')
        current_choice = unique((row for row in configs['configurations'] if row['id'] == choice['id']), 'The reviewed phone choice is missing.')
        if current_choice.get('linkedVariantId') not in (None, actual['id']): raise RuntimeError('An admin linked this choice to another SKU; preserve that choice.')
        if current_choice.get('linkedVariantId') is None:
            command = str(uuid.uuid4())
            body = {'listingVersion': configs['listingVersion'], 'configurationVersion': current_choice['version'], 'configuration': {
                **{key: current_choice[key] for key in ['enabled', 'ramGb', 'storageGb', 'colorKey', 'colorNameFa', 'colorNameEn', 'colorHex', 'imageUrl']}, 'linkedVariantId': actual['id']}}
            call('PUT', '/api/admin/market/' + phone['id'] + '/phone-configurations/' + choice['id'] + '/commands/' + command, body, 'configuration-link')
        inventory = call('GET', '/api/admin/inventory?includeMovements=false', capture='inventory-after')
        balances = [row for row in inventory['stock'] if row['variantId'] == actual['id']]
        if any(row.get('onHand', 0) or row.get('reserved', 0) or row.get('sourcingReserved', 0) for row in balances):
            raise RuntimeError('The owned QA SKU has nonzero inventory; do not treat this provision as zero-stock.')
        public = call('GET', '/api/phones/fa/' + phone['id'], capture='phone-after')
        public_choice = unique((row for row in public['configurations'] if row['id'] == choice['id']), 'Updated public choice is missing.')
        if public['isDemo'] is not True or public_choice['availableInStore'] or not public_choice['canRequest']:
            raise RuntimeError('The public demo choice must remain unavailable in Store and eligible for sourcing.')
        manifest.update({'completed': True, 'listingId': phone['id'], 'modelId': product['id'], 'configurationId': choice['id'],
            'variantId': actual['id'], 'sku': sku, 'ramGb': 8, 'storageGb': 256, 'colorNameEn': choice['colorNameEn'],
            'productStatus': after_product['status'], 'listingIsDemo': public['isDemo'], 'zeroStockVerified': True, 'canRequest': public_choice['canRequest'],
            'variantAlreadyExisted': bool(existing), 'methodId': payment['id'], 'methodKind': payment['kind']})
    except Exception as error:
        manifest.update({'completed': False, 'error': str(error)})
        raise
    finally:
        manifest['captures'] = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(output.glob('*.json')) if path.name != 'manifest.json'}
        (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({key: manifest[key] for key in ['completed', 'runId', 'listingId', 'modelId', 'configurationId', 'variantId', 'sku', 'samplePriceRial', 'zeroStockVerified', 'nextFreshMfaWindowUtc']}))
    print('Manifest: ' + str((output / 'manifest.json').relative_to(ROOT)))

if __name__ == '__main__':
    main()
