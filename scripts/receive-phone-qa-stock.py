"""Prepare one audited manual stock-in for the owned D41 availability browser QA.

Run only after explicit authorization and an Active customer interest. Uses the
normal Inventory adjustment API and its idempotency/CAS contract. This is a
synthetic GUID-fixture stock movement, not an external supplier receipt.
No direct SQL, notification injection, quote, payment, shipping or order calls.
"""
from pathlib import Path
import argparse, base64, hashlib, hmac, importlib.util, json, os, re, struct, time, uuid
import urllib.error, urllib.request
from urllib.parse import quote, urlsplit
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('owned_phone_qa_provision', ROOT / 'scripts/provision-phone-qa-sku.py')
provision = importlib.util.module_from_spec(spec)
spec.loader.exec_module(provision)
unique = provision.unique

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--descriptor', type=Path, required=True)
    parser.add_argument('--run-id', required=True)
    parser.add_argument('--api', required=True)
    parser.add_argument('--admin-origin', required=True)
    parser.add_argument('--storefront-origin', required=True)
    parser.add_argument('--provision-manifest', type=Path, required=True)
    parser.add_argument('--interest-owner', choices=['customer', 'otherCustomer'], required=True)
    args = parser.parse_args()
    if not re.fullmatch('[a-f0-9]{32}', args.run_id): raise RuntimeError('An exact owned QA run is required.')
    api, api_port = provision.local_endpoint(args.api, api=True)
    admin_origin, admin_port = provision.local_endpoint(args.admin_origin, api=False)
    storefront_origin, storefront_port = provision.local_endpoint(args.storefront_origin, api=False)
    if len({api_port, admin_port, storefront_port}) != 3 or urlsplit(admin_origin).hostname == urlsplit(storefront_origin).hostname:
        raise RuntimeError('Use the separate API/admin/storefront ports and independent local browser hosts of this fixture.')
    descriptor = args.descriptor if args.descriptor.is_absolute() else ROOT / args.descriptor
    if descriptor.is_symlink() or descriptor.suffix != '.json' or not descriptor.resolve().is_relative_to((ROOT / 'tmp').resolve()):
        raise RuntimeError('An explicit owned non-symlink JSON fixture descriptor under workspace tmp is required.')
    descriptor = descriptor.resolve()
    descriptor_raw = descriptor.read_bytes()
    descriptor_sha256 = hashlib.sha256(descriptor_raw).hexdigest()
    initial = json.loads(descriptor_raw)
    directory = Path(initial.get('directory', ''))
    if not directory.is_absolute() or directory.is_symlink() or not directory.resolve().is_relative_to((ROOT / 'tmp').resolve()):
        raise RuntimeError('The fixture private directory is outside its owned workspace tmp scope.')
    def guard():
        if descriptor.is_symlink() or directory.is_symlink(): raise RuntimeError('Owned QA paths changed to symlinks.')
        raw = descriptor.read_bytes()
        if hashlib.sha256(raw).hexdigest() != descriptor_sha256:
            raise RuntimeError('The bound QA descriptor bytes changed. No further API call is allowed.')
        current = json.loads(raw)
        if (current.get('runId') != args.run_id or current.get('syntheticTestOnly') is not True or current.get('mainChanged') is not False
            or current.get('apiPort') != api_port or current.get('adminPort') != admin_port or current.get('storefrontPort') != storefront_port
            or current.get('pid') != initial.get('pid') or current.get('connectionDatabase') != initial.get('connectionDatabase')
            or not re.fullmatch('SaymanTest_[a-f0-9]{32}', current.get('connectionDatabase', ''))
            or Path(current.get('directory', '')).resolve() != directory.resolve()):
            raise RuntimeError('The owned GUID fixture binding changed. No further API call is allowed.')
        os.kill(int(current['pid']), 0)
        return current
    current = guard()
    credential_file = directory / 'credentials.json'
    if credential_file.is_symlink() or credential_file.stat().st_mode & 0o077:
        raise RuntimeError('Use only the owner-only regular credentials file of the owned fixture.')
    credentials = json.loads(credential_file.read_text())
    if credentials.get('runId') != args.run_id or credentials.get('syntheticTestOnly') is not True:
        raise RuntimeError('Credentials belong to another fixture.')
    source_manifest = args.provision_manifest if args.provision_manifest.is_absolute() else ROOT / args.provision_manifest
    if source_manifest.is_symlink() or not source_manifest.resolve().is_relative_to((ROOT / 'artifacts/checks').resolve()):
        raise RuntimeError('Use the explicit owned SKU provisioning evidence under artifacts/checks.')
    source_raw = source_manifest.read_bytes()
    source = json.loads(source_raw)
    if (source.get('runId') != args.run_id or source.get('syntheticTestOnly') is not True or source.get('completed') is not True
        or source.get('mainChanged') is not False or source.get('database') != current['connectionDatabase']
        or source.get('api') != api or source.get('adminOrigin') != admin_origin
        or source.get('sku') != 'QA-D41-A56-8-256-PINK-' + args.run_id[:8].upper()
        or source.get('ramGb') != 8 or source.get('storageGb') != 256 or source.get('colorNameEn') != 'Awesome Pink'
        or source.get('listingIsDemo') is not True or source.get('zeroStockVerified') is not True):
        raise RuntimeError('The supplied provisioning evidence is not the exact owned zero-stock demo A56 SKU.')
    for field in ('variantId', 'listingId', 'modelId', 'configurationId'):
        if not re.fullmatch('[a-f0-9]{32}', source.get(field, '')): raise RuntimeError('Provisioning target identity is invalid.')
    output = ROOT / ('artifacts/checks/phone-qa-stock-' + args.run_id)
    if output.is_symlink(): raise RuntimeError('The owned QA evidence directory changed to a symlink.')
    output.mkdir(parents=True, exist_ok=True)
    if not os.name == 'nt': output.chmod(0o700)
    report = {'schemaVersion': 1, 'runId': args.run_id, 'syntheticTestOnly': True, 'mainChanged': False,
        'operation': 'audited_manual_stock_in', 'externalSupplierReceiptClaim': False,
        'api': api, 'adminOrigin': admin_origin, 'storefrontOrigin': storefront_origin,
        'descriptor': str(descriptor.relative_to(ROOT)), 'descriptorSha256': descriptor_sha256,
        'database': current['connectionDatabase'], 'provisionManifestSha256': hashlib.sha256(source_raw).hexdigest(),
        'variantId': source['variantId'], 'listingId': source['listingId'], 'configurationId': source['configurationId'],
        'delta': 1, 'interestOwnerRole': args.interest_owner, 'directSql': False,
        'notificationInjected': False, 'quotePaymentShippingOrOrderCreated': False, 'credentialsCaptured': False, 'requests': []}
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), provision.NoRedirect())
    tokens = {'admin': None, 'customer': None}
    def call(audience, method, path, body=None, capture=None, auth=False):
        guard()
        if not path.startswith('/api/') or '..' in path or '\\' in path: raise RuntimeError('Only bound QA API paths are allowed.')
        headers = {'Origin': admin_origin if audience == 'admin' else storefront_origin,
            'X-Sayman-Client': 'admin' if audience == 'admin' else 'storefront', 'Accept': 'application/json'}
        if audience == 'admin': headers['X-Sayman-Admin'] = '1'
        if tokens[audience]: headers['Authorization'] = 'Bearer ' + tokens[audience]
        raw = None if body is None else json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode()
        if raw is not None: headers['Content-Type'] = 'application/json'
        request = urllib.request.Request(api + path, data=raw, method=method, headers=headers)
        try:
            with opener.open(request, timeout=45) as response: status, payload = response.status, response.read()
        except urllib.error.HTTPError as error:
            report['requests'].append({'audience': audience, 'method': method, 'path': path, 'status': error.code})
            if capture and not auth: (output / (capture + '-error.json')).write_bytes(error.read())
            raise RuntimeError('Owned QA API rejected ' + method + ' ' + path + ' with HTTP ' + str(error.code)) from None
        report['requests'].append({'audience': audience, 'method': method, 'path': path, 'status': status})
        if capture and not auth:
            (output / (capture + '.json')).write_bytes(payload)
            if raw is not None: (output / (capture + '-input.json')).write_bytes(raw)
        return json.loads(payload)
    def inbox_items(label):
        items = []
        cursor = None
        for page_index in range(5):
            path = '/api/notifications/phones/?unreadOnly=false' + ('&cursor=' + quote(cursor, safe='') if cursor else '')
            page = call('customer', 'GET', path, capture=label + '-page-' + str(page_index + 1))
            items.extend(page['items'])
            cursor = page.get('nextCursor')
            if cursor is None: break
        if cursor is not None: raise RuntimeError('The bounded owned inbox scan was incomplete; no duplicate-free result can be claimed.')
        return items
    def target_notices(items):
        return [row for row in items if row.get('kind') == 'phone_available'
            and row.get('listingId') == source['listingId'] and row.get('configurationId') == source['configurationId']]
    try:
        account = credentials['admin']
        pending = call('admin', 'POST', '/api/auth/password', {'identifier': account['username'], 'password': account['password']}, auth=True)
        if pending.get('requiresMfa') is not True or pending.get('requiresEnrollment') is not False:
            raise RuntimeError('The owned admin requires its normal enrolled MFA flow.')
        tokens['admin'] = pending['accessToken']
        time.sleep(31 - time.time() % 30)
        counter = int(time.time()) // 30
        key = account['authenticatorKey'].upper()
        digest = hmac.new(base64.b32decode(key + '=' * ((8 - len(key) % 8) % 8)), struct.pack('>Q', counter), hashlib.sha1).digest()
        offset = digest[-1] & 15
        code = str((struct.unpack('>I', digest[offset:offset + 4])[0] & 0x7fffffff) % 1000000).zfill(6)
        session = call('admin', 'POST', '/api/auth/mfa/verify', {'code': code}, auth=True)
        if session.get('requiresMfa') or session.get('user', {}).get('id') != account['id']: raise RuntimeError('Owned admin identity did not match.')
        tokens['admin'] = session['accessToken']
        report['nextFreshAdminMfaWindowUtc'] = datetime.fromtimestamp((counter + 1) * 30 + 1, timezone.utc).isoformat()
        person = credentials[args.interest_owner]
        session = call('customer', 'POST', '/api/auth/password', {'identifier': person['username'], 'password': person['password']}, auth=True)
        if session.get('requiresMfa') or session.get('user', {}).get('id') != person['id']: raise RuntimeError('Owned customer identity did not match.')
        tokens['customer'] = session['accessToken']
        interest = call('customer', 'GET', '/api/phones/interests/' + source['listingId'] + '/' + source['configurationId'], capture='interest-before')
        chosen = interest.get('configuration', {})
        if (interest.get('listingId') != source['listingId'] or chosen.get('id') != source['configurationId']
            or chosen.get('modelId') != source['modelId'] or chosen.get('ramGb') != 8 or chosen.get('storageGb') != 256
            or chosen.get('colorNameEn') != 'Awesome Pink'):
            raise RuntimeError('The owned interest does not describe the exact requested A56 choice.')
        listing = call('admin', 'GET', '/api/admin/market/' + source['listingId'], capture='listing-before')
        if listing.get('modelId') != source['modelId'] or listing.get('details', {}).get('isDemo') is not True:
            raise RuntimeError('The configured phone is not the same owned demo listing.')
        configurations = call('admin', 'GET', '/api/admin/market/' + source['listingId'] + '/phone-configurations', capture='configurations-before')
        configured = unique((row for row in configurations['configurations'] if row['id'] == source['configurationId']), 'The phone choice is not unique.')
        if configured.get('linkedVariantId') != source['variantId'] or not configured.get('enabled'):
            raise RuntimeError('The exact enabled choice must remain linked to the provisioned SKU.')
        inventory = call('admin', 'GET', '/api/admin/inventory?includeMovements=true', capture='inventory-before')
        stock = [row for row in inventory['stock'] if row['variantId'] == source['variantId']]
        if len(stock) > 1: raise RuntimeError('The stock identity is duplicated.')
        command_file = output / 'stock-adjust-command.json'
        if command_file.is_symlink(): raise RuntimeError('The persistent stock command changed to a symlink.')
        command_path = '/api/admin/inventory/' + source['variantId'] + '/adjust'
        reason = 'ورود دستی یک واحد آزمایشی D41 برای بررسی اعلان؛ فقط fixture ' + args.run_id
        if command_file.exists():
            saved = json.loads(command_file.read_text())
            if saved.get('runId') != args.run_id or saved.get('variantId') != source['variantId'] or saved.get('path') != command_path:
                raise RuntimeError('The persistent stock command belongs to another target.')
            body = saved['body']
            if body.get('delta') != 1 or body.get('reason') != reason or not re.fullmatch('[a-f0-9-]{36}', body.get('requestId', '')):
                raise RuntimeError('The stored stock command shape changed.')
            baseline_ids = saved.get('baselineAvailabilityEventIds')
            if (not isinstance(baseline_ids, list) or len(set(baseline_ids)) != len(baseline_ids)
                or any(not isinstance(value, str) or not re.fullmatch('[a-f0-9]{32}', value) for value in baseline_ids)):
                raise RuntimeError('The persistent stock command has no valid baseline for duplicate observation.')
        else:
            body = {'delta': 1, 'reason': reason,
                'requestId': str(uuid.uuid4()), 'version': stock[0]['version'] if stock else None}
            baseline_ids = None
        recorded = [row for row in inventory.get('movements', []) if row.get('requestId') == body['requestId']]
        if recorded:
            movement = unique(recorded, 'The recorded stock command is duplicated.')
            if movement.get('variantId') != source['variantId'] or int(movement.get('delta', 0)) != 1 or movement.get('reason') != body['reason']:
                raise RuntimeError('The existing movement does not match the persistent command.')
            report['recoveredCommittedMovement'] = True
        else:
            if interest.get('state') != 'Active': raise RuntimeError('Activate this exact interest through the browser before receiving QA stock.')
            if any(int(row.get(key, 0)) != 0 for row in stock for key in ('onHand', 'reserved', 'sourcingReserved')):
                raise RuntimeError('This helper only performs the first exact zero-to-one QA availability transition.')
            before = call('customer', 'GET', '/api/phones/fa/' + source['listingId'], capture='phone-before')
            choice = unique((row for row in before['configurations'] if row['id'] == source['configurationId']), 'The public choice is not unique.')
            if before.get('isDemo') is not True or choice.get('availableInStore') or choice.get('variantId') != source['variantId']:
                raise RuntimeError('The exact linked demo choice must be unavailable before the stock-in.')
            if baseline_ids is None: baseline_ids = [row['id'] for row in target_notices(inbox_items('inbox-before-stock'))]
            if not command_file.exists(): command_file.write_text(json.dumps({'runId': args.run_id, 'variantId': source['variantId'], 'path': command_path, 'body': body,
                'baselineAvailabilityEventIds': baseline_ids}, ensure_ascii=False, indent=2) + '\n')
            call('admin', 'POST', command_path, body, capture='stock-adjust')
            report['stockAdjustmentAccepted'] = True
        after = call('admin', 'GET', '/api/admin/inventory?includeMovements=true', capture='inventory-after')
        movement = unique((row for row in after.get('movements', []) if row.get('requestId') == body['requestId']), 'The normal inventory movement was not recorded exactly once.')
        balance = unique((row for row in after['stock'] if row['variantId'] == source['variantId']), 'The normal inventory stock row was not recorded.')
        if movement.get('variantId') != source['variantId'] or int(movement.get('delta', 0)) != 1 or int(balance['onHand']) != 1:
            raise RuntimeError('The final ledger/balance does not match this one-unit QA movement.')
        public = call('customer', 'GET', '/api/phones/fa/' + source['listingId'], capture='phone-after')
        choice = unique((row for row in public['configurations'] if row['id'] == source['configurationId']), 'The final public choice is not unique.')
        if not choice.get('availableInStore') or choice.get('variantId') != source['variantId']:
            raise RuntimeError('The current exact SKU has no available public stock after the movement.')
        report.update({'completed': True, 'requestId': body['requestId'], 'movementId': str(movement['id']),
            'onHand': int(balance['onHand']), 'reserved': int(balance['reserved']), 'sourcingReserved': int(balance['sourcingReserved']),
            'interestStateBefore': interest['state'], 'generation': interest['generation'], 'availableInStore': True,
            'stockMovementVerified': True, 'workerAlertAcceptance': False, 'browserAlertAcceptance': False,
            'workerOrBrowserAlertAcceptance': False})
        print(json.dumps({'stockMovementVerified': True, 'variantId': source['variantId'],
            'requestId': body['requestId'], 'movementId': str(movement['id']), 'onHand': int(balance['onHand'])}), flush=True)
        expected_notice = hashlib.sha256(('phone-available:' + interest['id'] + ':' + str(interest['generation'])).encode()).hexdigest()[:32]
        def notice_sample(label):
            items = inbox_items(label)
            expected = [row for row in items if row.get('id') == expected_notice]
            new_target = [row for row in target_notices(items) if row['id'] not in baseline_ids]
            if any(row.get('kind') != 'phone_available' or row.get('listingId') != source['listingId']
                or row.get('configurationId') != source['configurationId'] or row.get('variantId') != source['variantId']
                or row.get('requestId') is not None or row.get('offerId') is not None for row in expected):
                raise RuntimeError('The expected availability notice has a different physical choice or event shape.')
            current_interest = call('customer', 'GET', '/api/phones/interests/' + source['listingId'] + '/' + source['configurationId'], capture=label + '-interest')
            if current_interest.get('id') != interest['id'] or current_interest.get('generation') != interest['generation']:
                raise RuntimeError('The owned interest changed generation during observation; no result is attributed to another generation.')
            unread = call('customer', 'GET', '/api/notifications/phones/unread-count', capture=label + '-unread-count')
            result = {'observedAtUtc': datetime.now(timezone.utc).isoformat(), 'expectedEventId': expected_notice,
                'expectedGenerationCount': len(expected), 'newTargetAvailabilityCount': len(new_target),
                'allPhoneAvailableCount': sum(row.get('kind') == 'phone_available' for row in items),
                'unreadCount': unread['unreadCount'], 'interestState': current_interest.get('state')}
            if len(expected) > 1 or len(new_target) > 1 or any(row['id'] != expected_notice for row in new_target):
                raise RuntimeError('The same interest transition produced an additional or unexpected availability notice.')
            return result
        deadline = time.monotonic() + 150
        samples = []
        while True:
            sample = notice_sample('worker-check-' + str(len(samples) + 1))
            samples.append(sample)
            report['availabilityObservations'] = samples
            if sample['expectedGenerationCount'] == 1 and sample['newTargetAvailabilityCount'] == 1 and sample['interestState'] == 'Notified': break
            if time.monotonic() >= deadline: raise RuntimeError('The real availability worker did not notify this active generation within 150 seconds.')
            time.sleep(15)
        # A second read after more than one normal one-minute worker interval
        # proves stable persistence for the same generation without invoking it.
        time.sleep(35)
        time.sleep(30)
        repeat = notice_sample('worker-stability-check')
        samples.append(repeat)
        if repeat['expectedGenerationCount'] != 1 or repeat['newTargetAvailabilityCount'] != 1 or repeat['interestState'] != 'Notified':
            raise RuntimeError('The availability notice did not remain singular for the same notified generation.')
        report.update({'workerAlertAcceptance': True, 'availabilityEventId': expected_notice,
            'generationNoticeCountFirst': 1, 'generationNoticeCountSecond': 1,
            'stabilityObservationGapSeconds': 65, 'nextStep': 'Verify the real notice in the customer browser; this helper does not mark it read.'})
    except Exception as error:
        report.update({'completed': False, 'error': str(error)})
        raise
    finally:
        report['captures'] = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(output.glob('*.json')) if path.name != 'manifest.json'}
        (output / 'manifest.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({key: report[key] for key in ['completed', 'runId', 'variantId', 'requestId', 'movementId', 'onHand', 'interestStateBefore', 'generation', 'nextFreshAdminMfaWindowUtc']}))
    print('Manifest: ' + str((output / 'manifest.json').relative_to(ROOT)))

if __name__ == '__main__':
    main()
