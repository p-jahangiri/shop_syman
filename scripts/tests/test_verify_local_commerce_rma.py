"""Offline fault injection with synthetic artifacts; no live service access."""
from contextlib import ExitStack
from copy import deepcopy
from pathlib import Path
from string import ascii_uppercase
from tempfile import TemporaryDirectory
from unittest import TestCase, main
from unittest.mock import patch
import hashlib
import json
import sys
from types import SimpleNamespace
import xml.etree.ElementTree as ET

from scripts.tests.script_loader import load_script


v = load_script('commerce_rma_verifier', 'verify-local-commerce-rma.py')
SYNTHETIC_BUILD = 'b' * 32


def headers(private=False):
    return {'content-type': 'application/json', 'cache-control': 'private, no-store' if private else 'public, no-store',
            'x-robots-tag': 'noindex, nofollow', 'x-content-type-options': 'nosniff',
            'vary': 'Cookie, Authorization' if private else '', 'x-sayman-returns-contract': 'rma-v1',
            'set-cookie': '', 'location': ''}


def policy(configured=False):
    return {'schemaVersion': 1, 'configured': configured, 'enabled': configured, 'physicalReturns': configured, 'digitalComplaints': configured,
            'conditionsFa': 'شرایط عمومی' if configured else None, 'conditionsEn': 'Public synthetic terms' if configured else None,
            'windowMode': 'deliveryDays' if configured else None, 'windowDays': 3 if configured else None,
            'canRefund': False, 'refundAvailability': 'provider_unconfigured'}


def configuration(p):
    data = {'settings': {'reservationMinutes': 60, 'maxOpenOrdersPerCustomer': 2},
            'charges': {'shippingMode': 'postpaid', 'shippingFeeRial': None, 'shippingFreeFromRial': None, 'taxMode': 'included_unitemized', 'taxRateBasisPoints': None},
            'returns': {key: p[key] for key in ('enabled', 'physicalReturns', 'digitalComplaints', 'windowMode', 'windowDays')}}
    data['returns'].update({key + 'Hash': hashlib.sha256(p[key].encode('utf-16-le')).hexdigest().upper() for key in ('conditionsFa', 'conditionsEn')})
    return data


class BoundaryTests(TestCase):
    def test_cookie_values_never_enter_serialized_failure_proof_even_when_primitive_raises_first(self):
        secret = 'SYNTHETIC_COOKIE_MUST_NEVER_APPEAR_IN_PROOF'
        for fail_before_return in (False, True):
            proof = {'passed': False, 'httpChecks': []}
            response = SimpleNamespace(status=200, fp=None, read1=lambda _: b'')
            observed = headers() | {'set-cookie': 'session=' + secret + '; HttpOnly'}
            response.getheader = lambda name, default='': observed.get(name.lower(), default)
            connection = SimpleNamespace(sock=None, request=lambda *args, **kwargs: None, getresponse=lambda: response, close=lambda: None)
            # Exercise the actual historical append-before-status primitive,
            # replacing only its transport; no real HTTP connection is opened.
            with patch.object(v.legacy.http.client, 'HTTPConnection', return_value=connection), self.assertRaises(v.VerificationError):
                v.anonymous_get('api', '/api/returns/policy', 401 if fail_before_return else 200, 15, records=proof['httpChecks'])
            self.assertEqual(len(proof['httpChecks']), 1)
            self.assertIs(proof['httpChecks'][0]['setCookiePresent'], True)
            serialized = json.dumps(proof)
            self.assertNotIn(secret, serialized); self.assertNotIn('session=', serialized); self.assertNotIn('set-cookie', serialized)

    def test_raw_api_rma401_requires_marker_but_preauth_bff401_does_not(self):
        for component in ('api', 'storefront', 'admin'):
            record = {'component': component, 'path': '/api/admin/returns' if component == 'admin' else '/api/returns', 'status': 401, 'headers': headers(True) | {'x-sayman-returns-contract': ''}}
            if component == 'api':
                with self.assertRaisesRegex(v.VerificationError, 'raw API RMA bearer challenge'): v.private_response(record, b'')
            else: v.private_response(record, b'')
        v.private_response({'component': 'api', 'path': '/api/account/profile', 'status': 401, 'headers': headers(True) | {'x-sayman-returns-contract': ''}}, b'')
        for path in (*v.CUSTOMER_RMA_READS, *v.ADMIN_RMA_READS):
            v.private_response({'component': 'api', 'path': path, 'status': 401, 'headers': headers(True)}, b'')

    def test_owned_api_process_handles_workspace_space_and_rejects_foreign_pid_command_or_cwd(self):
        state = {'apiPid': 1234, 'runtimeDirectory': 'tmp/api-runtime-synthetic'}
        command = 'dotnet ' + str(v.ROOT / state['runtimeDirectory'] / 'Shop.Api.dll')
        def check_output(args, **_):
            return 'n' + str(v.ROOT) + '\n' if args[0] == 'lsof' else command if args[-1] == 'command=' else 'Fri Oct 30 10:00:00 2026'
        with patch.object(v.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout='1234\n')) as run:
            with patch.object(v.subprocess, 'check_output', side_effect=check_output):
                self.assertEqual(v.process_identity('api', state)['pid'], 1234)
                self.assertIn('-tiTCP:5080', run.call_args.args[0])
            for invalid in ('dotnet ' + str(v.ROOT / 'tmp/foreign/Shop.Api.dll'), 'dotnet /outside/Shop.Api.dll'):
                with patch.object(v.subprocess, 'check_output', side_effect=lambda args, **_: invalid if args[-1] == 'command=' else check_output(args)), self.assertRaises(v.VerificationError): v.process_identity('api', state)
            with patch.object(v.subprocess, 'check_output', side_effect=lambda args, **_: 'n/outside' if args[0] == 'lsof' else check_output(args)), self.assertRaises(v.VerificationError): v.process_identity('api', state)
        with patch.object(v.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout='1234\n9999\n')), self.assertRaises(v.VerificationError): v.process_identity('api', state)

    def test_public_unconfigured_is_honest_and_configured_policy_has_literal_false_refund(self):
        for configured in (False, True):
            p = policy(configured)
            self.assertEqual(v.public_policy({'status': 200, 'headers': headers()}, json.dumps(p).encode()), p)
        self.assertFalse(v.public_policy({'status': 200, 'headers': headers()}, json.dumps(policy()).encode())['configured'])

    def test_missing_marker_private_fields_fake_nullability_refund_and_duplicate_json_fail_closed(self):
        p = policy()
        faults = [(headers() | {'x-sayman-returns-contract': ''}, p), (headers(), p | {'ownerId': 'private'}),
                  (headers(), p | {'staffNote': 'private'}), (headers(), p | {'canRefund': True}),
                  (headers(), p | {'configured': 0}), (headers(), p | {'conditionsFa': 'invented'}),
                  (headers() | {'set-cookie': 'forbidden=1'}, p), (headers() | {'content-type': 'text/html'}, p)]
        for h, body in faults:
            with self.subTest(body=body, headers=h), self.assertRaises(v.VerificationError):
                v.public_policy({'status': 200, 'headers': h}, json.dumps(body).encode())
        for body in (b'{"schemaVersion":1,"SchemaVersion":1}', b'\xff', b'{"x":NaN}'):
            with self.subTest(body=body), self.assertRaises(v.VerificationError): v.strict_json(body)

    def test_private_error_never_leaks_case_data_or_loses_protective_headers(self):
        v.private_response({'status': 401, 'headers': headers(True)}, b'')
        v.private_response({'status': 401, 'headers': headers(True)}, b'{"title":"invalid_credentials"}')
        faults = [('status', 200), ('cache-control', 'no-store'), ('x-robots-tag', ''), ('x-content-type-options', ''), ('vary', 'Origin'), ('set-cookie', 'secret=1')]
        for key, value in faults:
            record = {'status': 401, 'headers': headers(True)}
            if key == 'status': record[key] = value
            else: record['headers'][key] = value
            with self.subTest(key=key), self.assertRaises(v.VerificationError): v.private_response(record, b'')
        with self.assertRaises(v.VerificationError): v.private_response({'status': 401, 'headers': headers(True)}, b'{"ownerId":"private"}')

    def test_only_exact_storefront_addresses_get_accepts_authorization_only_vary(self):
        record = {'component': 'storefront', 'path': '/api/addresses', 'method': 'GET', 'status': 401,
                  'headers': headers(True) | {'vary': 'RSC, Next-Router-State-Tree, Authorization'}}
        v.private_response(record, b'{"title":"invalid_credentials"}')
        for vary in ('', 'Cookie', 'RSC, Next-Router-State-Tree', 'Next-Router-State-Tree, Cookie'):
            with self.subTest(vary=vary), self.assertRaises(v.VerificationError):
                v.private_response(record | {'headers': record['headers'] | {'vary': vary}}, b'')
        for component, path, method in [('api', '/api/addresses', 'GET'), ('admin', '/api/addresses', 'GET'),
                                       ('storefront', '/api/addresses/', 'GET'), ('storefront', '/api/addresses?x=1', 'GET'),
                                       ('storefront', '/api/addresses/' + v.ID, 'GET'), ('storefront', '/api/addresses-extra', 'GET'),
                                       ('storefront', '/api/returns', 'GET'), ('storefront', '/api/account/profile', 'GET'),
                                       ('storefront', '/api/addresses', 'PUT')]:
            with self.subTest(component=component, path=path, method=method), self.assertRaises(v.VerificationError):
                v.private_response(record | {'component': component, 'path': path, 'method': method}, b'')
        for key, value in [('cache-control', 'no-store'), ('x-robots-tag', ''), ('x-content-type-options', ''),
                           ('set-cookie', 'SYNTHETIC_NOT_ALLOWED=1'), ('location', '/login')]:
            with self.subTest(key=key), self.assertRaises(v.VerificationError):
                v.private_response(record | {'headers': record['headers'] | {key: value}}, b'')

    def test_preserved_actual_v2_address401_record_passes_without_product_changes(self):
        proof = v.read(v.CHECKS / 'commerce-rma-main88-before-policy-v2.json')
        records = [record for record in proof['httpChecks'] if record.get('component') == 'storefront' and record.get('path') == '/api/addresses']
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]['status'], 401)
        self.assertIn('authorization', records[0]['headers']['vary'].lower())
        self.assertNotIn('cookie', records[0]['headers']['vary'].lower())
        v.private_response(records[0], b'{"title":"invalid_credentials"}')

    def test_owner_configuration_checks_reject_zero_tax_fake_free_fee_and_mismatched_terms(self):
        p = policy(True); good = configuration(p)
        result = v.configured_policy(p, good)
        self.assertFalse(result['taxBreakdownKnown']); self.assertFalse(result['carrierFeeKnown']); self.assertFalse(result['refundEnabled'])
        faults = [('settings', 'reservationMinutes', 5), ('settings', 'maxOpenOrdersPerCustomer', 3),
                  ('charges', 'taxMode', 'exempt'), ('charges', 'taxRateBasisPoints', 0), ('charges', 'shippingMode', 'free'),
                  ('charges', 'shippingFeeRial', 0), ('returns', 'windowDays', 4), ('returns', 'conditionsFaHash', 'A' * 64)]
        for section, key, value in faults:
            data = deepcopy(good); data[section][key] = value
            with self.subTest(section=section, key=key), self.assertRaises(v.VerificationError): v.configured_policy(p, data)
        with self.assertRaises(v.VerificationError): v.configured_policy(policy(), good)


class OrchestrationTests(TestCase):
    def harness(self):
        digest = 'a' * 64
        states = {name: {'mainPromoted': True, 'api': v.URLS['api'], 'sourceMigrationCount': 88, 'databaseMigrationCount': 88,
                         'tableCount': 229, 'commerceRmaAccepted': True, 'commerceRmaRecoveryRequired': False,
                         'localReleaseEvidence': 'artifacts/checks/synthetic-release.json', 'runtimeDirectory': 'tmp/' + name + '-runtime-synthetic',
                         'artifactManifest': 'artifacts/checks/' + name + '-synthetic.json'} for name in v.PORTS}
        for name in ('storefront', 'admin'): states[name].update(apiMinimumMigrationCount=88, frontendBuildRun=SYNTHETIC_BUILD, retainedPriorAssets={'old.js': digest})
        states['storefront']['distDirectory'] = '.next-synthetic'
        aggregate = {'database': 'Sayman', 'canonicalUrls': deepcopy(v.URLS), 'sourceMigrationCount': 88, 'databaseMigrationCount': 88,
                     'tableCount': 229, 'commerceRmaAccepted': True, 'commerceRmaRecoveryRequired': False,
                     'schemaReleaseEvidence': {'path': 'artifacts/checks/synthetic-release.json', 'sha256': digest},
                     'componentReleaseEvidence': {name: state['localReleaseEvidence'] for name, state in states.items()}}
        aggregate.update({name + 'Descriptor': str(v.DESCRIPTORS[name].relative_to(v.ROOT)) for name in states})
        return states, aggregate

    def run_verify(self, mutate=None, response_fault=None, drift=False, process_drift=False, configured=False, configuration_fault=None, evidence_fault=None):
        states, aggregate = self.harness()
        if mutate: mutate(states, aggregate)
        backend = v.CHECKS / 'synthetic-backend.json'; frozen = v.CHECKS / 'synthetic-frozen.json'
        accepted = {'status': 'backend-frozen-targeted-accepted', 'unit': {'total': 1486}, **{key: True for key in ('commerceChargePolicyAccepted', 'privateReturnRequestsAccepted', 'privateAdminHeadersAccepted', 'physicalFulfillmentCapacityAccepted', 'customerLoginContinuityAccepted')}}
        documents = {path: states[name] for name, path in v.DESCRIPTORS.items()}; documents[v.AGGREGATE] = aggregate
        documents[v.ROOT / v.DEFAULT_FRONTEND] = {'sourceFrozen': True, 'sourceSha256': {'apps/storefront/synthetic.ts': 'a' * 64},
            'checks': {name: {'exitCode': 0} for name in ('fullStorefront', 'fullAdmin', 'storefrontTypeScript', 'adminTypeScript', 'globalEslint', 'globalPrettier')}, 'adminProxy': {'exitCode': 0}}
        documents[v.ROOT / v.DEFAULT_BUILD] = {'source': {'apps/storefront/synthetic.ts': 'a' * 64}, 'passed': True,
            'sourceStableDuringBuild': True, 'apiMinimumMigrationCount': 88, 'targets': ['storefront', 'admin'], 'run': SYNTHETIC_BUILD}
        documents[v.CHECKS / 'synthetic-release.json'] = {'passed': True, 'databaseMigrationCount': 88, 'tableCount': 229,
            'bothCompatibleFrontendsPromoted': True, 'acceptedEvidence': {v.DEFAULT_FRONTEND: 'a' * 64, v.DEFAULT_BUILD: 'a' * 64},
            'services': {name: {'runtimeDirectory': state['runtimeDirectory']} for name, state in states.items()}}
        if evidence_fault: evidence_fault(documents)
        for name in ('storefront', 'admin'): documents[v.ROOT / states[name]['artifactManifest']] = {'retainedPriorAssets': states[name]['retainedPriorAssets']}
        calls, proof = [], {'httpChecks': []}; manifests = {}
        for name, state in states.items():
            entries = {'index.html': 'index-sha'} if name == 'admin' else {}
            if name != 'api':
                prefix = '/_next/static/' if name == 'storefront' else '/assets/'
                entries.update({v.asset_entry(name, state, prefix + asset): 'a' * 64 for asset in ('entry.js', 'old.js')})
            manifests[name] = (v.ROOT / state['runtimeDirectory'], entries, {'byteExact': True})
        p = policy(configured); conf = configuration(p) if configured else None
        if configuration_fault: configuration_fault(conf)
        def get(name, path, status, timeout, private=False, expected_hash=None, records=None):
            calls.append((name, path, status, private)); h = headers(private)
            if path == '/api/returns/policy': body = json.dumps(p).encode()
            elif status == 401: body = b''
            elif name == 'admin' and path == '/': body = b'<script src="/assets/entry.js"></script>'
            elif name == 'storefront' and path.startswith(('/fa', '/en')): body = b'<script src="/_next/static/entry.js"></script>'
            elif path == '/health/ready': body = b'{"status":"ready"}'
            else: body = b'{}'
            record = {'component': name, 'path': path, 'status': status, 'headers': h}
            if response_fault: response_fault(name, path, record, body)
            if records is not None: records.append(record)
            return record, body
        reads = {}
        def sha(path):
            key = str(path); reads[key] = reads.get(key, 0) + 1
            return ('b' if drift and path == v.AGGREGATE and reads[key] > 1 else 'a') * 64
        process_reads = {}
        def identity(name, state):
            process_reads[name] = process_reads.get(name, 0) + 1
            return {'pid': 100, 'command': name, 'started': 'changed' if process_drift and process_reads[name] > 1 else 'unchanged'}
        with ExitStack() as stack:
            network = stack.enter_context(patch.object(v.legacy.http.client, 'HTTPConnection'))
            stack.enter_context(patch.object(v.legacy, 'backend_acceptance', return_value=(backend, accepted, frozen)))
            stack.enter_context(patch.object(v, 'sha', side_effect=sha)); stack.enter_context(patch.object(v, 'read', side_effect=lambda path: deepcopy(documents[path])))
            manifest = stack.enter_context(patch.object(v.legacy, 'manifest', side_effect=lambda state, name: manifests[name]))
            modules = stack.enter_context(patch.object(v, 'backend_evidence', return_value={'moduleCount': 14}))
            stack.enter_context(patch.object(v, 'process_identity', side_effect=identity)); stack.enter_context(patch.object(v.legacy, 'get', side_effect=get))
            sql = stack.enter_context(patch.object(v.legacy, 'sql_shape', return_value={'readOnly': True, 'migrationCount': 88, 'tableCount': 229}))
            stack.enter_context(patch.object(v.legacy, 'ready_public_image_smoke', return_value={'status': 'not-run'}))
            selection = stack.enter_context(patch.object(v, 'configuration_select', return_value=conf))
            try: v.verify(proof, 15, backend, configured)
            finally:
                if mutate: self.assertEqual(calls, [], 'Stale/half-published state must fail before any HTTP.')
            network.assert_not_called()
        return proof, calls, manifest, modules, sql, selection

    def test_unconfigured_base_passes_without_claiming_owner_policy_or_making_config_select(self):
        proof, calls, manifest, modules, sql, selection = self.run_verify()
        self.assertTrue(proof['passed']); self.assertFalse(proof['publicRmaPolicy']['configured'])
        self.assertFalse(proof['configuredOwnerPolicy']['asserted']); selection.assert_not_called()
        self.assertEqual(manifest.call_count, 6); self.assertEqual(modules.call_count, 2)
        self.assertEqual(sql.call_count, 2); self.assertTrue(all(call.args == (88, 229) for call in sql.call_args_list))
        for name in ('api', 'storefront'):
            for path in v.CUSTOMER_RMA_READS: self.assertIn((name, path, 401, True), calls)
        for name in ('api', 'admin'):
            for path in v.ADMIN_RMA_READS: self.assertIn((name, path, 401, True), calls)
        self.assertFalse(any('/returns/commands/' in path and private is False for _, path, _, private in calls))

    def test_stale_or_half_published_service_is_rejected_before_any_http(self):
        mutations = [lambda s, a: s['admin'].update(databaseMigrationCount=86), lambda s, a: a.update(commerceRmaAccepted=False),
                     lambda s, a: s['storefront'].update(apiMinimumMigrationCount=86), lambda s, a: s['storefront'].update(frontendBuildRun='old'),
                     lambda s, a: s['api'].update(commerceRmaRecoveryRequired=True), lambda s, a: a['canonicalUrls'].update(admin='http://127.0.0.1:3175')]
        for mutate in mutations:
            with self.subTest(case=mutations.index(mutate)), patch.object(v.legacy, 'get') as get:
                with self.assertRaises(v.VerificationError): self.run_verify(mutate=mutate)
                get.assert_not_called()

    def test_missing_public_marker_and_private_leak_are_detected_in_real_path_selection(self):
        def missing(name, path, record, body):
            if name == 'storefront' and path == '/api/returns/policy': record['headers']['x-sayman-returns-contract'] = ''
        def leak(name, path, record, body):
            if name == 'admin' and path == '/api/admin/returns': record['status'] = 200
        def missing_raw_marker(name, path, record, body):
            if name == 'api' and path == '/api/returns': record['headers']['x-sayman-returns-contract'] = ''
        for fault in (missing, leak, missing_raw_marker):
            with self.subTest(fault=fault.__name__), self.assertRaises(v.VerificationError): self.run_verify(response_fault=fault)

    def test_descriptor_or_process_start_drift_prevents_success(self):
        for flags in ({'drift': True}, {'process_drift': True}):
            with self.subTest(flags=flags), self.assertRaises(v.VerificationError): self.run_verify(**flags)

    def test_configured_mode_is_explicit_and_rejects_lying_tax_zero(self):
        proof, _, _, _, _, selection = self.run_verify(configured=True)
        self.assertEqual(selection.call_count, 2); self.assertTrue(proof['configuredOwnerPolicy']['publicTermsMatchSql'])
        with self.assertRaises(v.VerificationError): self.run_verify(configured=True, configuration_fault=lambda c: c['charges'].update(taxRateBasisPoints=0))

    def test_frontend_run_and_explicit_acceptance_bind_to_the_same_publication_without_hardcoded_run(self):
        proof, *_ = self.run_verify()
        self.assertEqual(proof['frontendAcceptance']['run'], SYNTHETIC_BUILD)
        def same_old_run(states, aggregate):
            for name in ('storefront', 'admin'): states[name]['frontendBuildRun'] = 'c' * 32
        with self.assertRaisesRegex(v.VerificationError, 'hash-bound published build'):
            self.run_verify(mutate=same_old_run)
        faults = [lambda docs: docs[v.CHECKS / 'synthetic-release.json']['acceptedEvidence'].update({v.DEFAULT_FRONTEND: 'b' * 64}),
                  lambda docs: docs[v.CHECKS / 'synthetic-release.json'].update(frontendBuildRun='c' * 32),
                  lambda docs: docs[v.ROOT / v.DEFAULT_FRONTEND]['checks']['fullStorefront'].update(exitCode=1),
                  lambda docs: docs[v.ROOT / v.DEFAULT_BUILD].update(sourceStableDuringBuild=False)]
        for fault in faults:
            with self.subTest(case=faults.index(fault)), self.assertRaises(v.VerificationError): self.run_verify(evidence_fault=fault)

    def test_retained_assets_cannot_escape_or_disagree_with_manifest(self):
        states, _ = self.harness(); state = states['admin']
        for retained in ({'../outside.js': 'a' * 64}, {'old.js': 'b' * 64}):
            state['retainedPriorAssets'] = retained
            with patch.object(v, 'read', return_value={'retainedPriorAssets': retained}):
                with self.assertRaises(v.VerificationError): v.retained_assets('admin', state, {'assets/old.js': 'a' * 64})

    def test_scoped_config_select_uses_no_personal_or_mutation_columns(self):
        p = policy(True)
        def sql(query, timeout):
            self.assertEqual(timeout, 20)
            self.assertIn('sales.CheckoutOrderSettings', query); self.assertIn('sales.CheckoutChargePolicies', query); self.assertIn('sales.RmaPolicyRevisions', query)
            self.assertNotRegex(query.lower(), r'\b(update|insert|delete|alter|drop|exec|ownerid|actorid|protectednote|email|password)\b')
            self.assertIn('HASHBYTES', query)
            return json.dumps(configuration(p))
        with patch.dict(sys.modules, {'local_shop_ops': SimpleNamespace(sql=sql)}): self.assertEqual(v.configuration_select(), configuration(p))


class D60ArtifactRegressionTests(TestCase):
    TOTAL = 1486

    def setUp(self):
        self.root = Path(self.enterContext(TemporaryDirectory())).resolve()
        self.checks = self.root / 'artifacts/checks'
        self.runtime = self.root / 'tmp/api-runtime-synthetic-d60'
        self.acceptance_path = self.checks / 'backend.json'
        self.publication_path = self.checks / 'release.json'
        self.enterContext(patch.object(v, 'ROOT', self.root))
        self.enterContext(patch.object(v, 'CHECKS', self.checks))
        self.enterContext(patch.object(v.legacy, 'ROOT', self.root))

        api_bin = self.root / 'backend/src/Shop.Api/bin/Debug/net10.0'
        test_bins = {name: self.root / f'backend/tests/{name}/bin/Debug/net10.0'
                     for name in ('Shop.Tests', 'Shop.SqlTests')}
        modules = ['Shop.Api.dll'] + [f'Shop.Module{letter}.dll' for letter in ascii_uppercase[:13]]
        module_hashes = {}
        for name in modules:
            for directory in (self.runtime, api_bin, *test_bins.values()):
                self.write(directory / name, name.encode())
            module_hashes[name] = v.sha(self.runtime / name)
        parity = {name: dict.fromkeys(('api', 'unit', 'sql'), digest)
                  for name, digest in module_hashes.items()}
        test_hashes = {}
        for name, directory in test_bins.items():
            for suffix in ('.dll', '.deps.json', '.runtimeconfig.json'):
                path = directory / (name + suffix)
                self.write(path, path.name.encode())
                reference = self.reference(path)
                test_hashes[reference['path']] = reference['sha256']

        source_delta = 'backend/tests/Shop.SqlTests/SyntheticTests.cs'
        sources = {'backend/src/Shop.Api/Program.cs': 'a' * 64, source_delta: 'c' * 64}
        self.frozen = {'sourceSha256': sources, 'module14parity': parity, 'testAssemblySha256': test_hashes}
        previous = {**self.frozen, 'sourceSha256': {**sources, source_delta: 'b' * 64}}
        frozen_ref = self.write_json(self.checks / 'frozen.json', self.frozen)
        previous_ref = self.write_json(self.checks / 'previous-frozen.json', previous)
        self.enterContext(patch.object(v, 'current_backend_sources', return_value=sources))

        self.trx_path = self.checks / 'unit.trx'
        trx = ET.Element('TestRun')
        counters = dict.fromkeys(('total', 'executed', 'passed'), str(self.TOTAL))
        counters.update(dict.fromkeys((
            'failed', 'error', 'timeout', 'aborted', 'inconclusive', 'passedButRunAborted',
            'notRunnable', 'notExecuted', 'disconnected', 'warning', 'inProgress', 'pending',
        ), '0'))
        ET.SubElement(trx, 'Counters', counters)
        results = ET.SubElement(trx, 'Results')
        for number in range(self.TOTAL):
            ET.SubElement(results, 'UnitTestResult', outcome='Passed', executionId=str(number))
        self.write(self.trx_path, ET.tostring(trx))
        log_path = self.checks / 'output.log'
        self.write(log_path, b'synthetic complete unit run')
        command = self.write_json(self.checks / 'command.json', {
            'status': 'completed', 'returnCode': 0, 'cwd': str(self.root),
            'argv': ['dotnet', 'test', 'backend/tests/Shop.Tests', '--no-build'],
            'termination': {'processGroupEmpty': True}, 'logSha256': v.sha(log_path),
        })
        unit = {'total': self.TOTAL, 'failed': 0, 'skipped': 0,
                'trx': self.reference(self.trx_path), 'command': command}
        accepted = {'status': 'backend-frozen-targeted-accepted', 'module14parity': parity,
                    'testAssemblySha256': test_hashes}
        previous_acceptance = self.write_json(self.checks / 'previous-backend.json', {
            **accepted, 'frozen': previous_ref, 'unit': unit,
        })
        proof = self.write_json(self.checks / 'reuse.json', {
            'accepted': True, 'unitPassed': self.TOTAL, 'module14parity': parity,
            'unitArtifacts': {name: digest for name, digest in test_hashes.items()
                              if name.startswith('backend/tests/Shop.Tests/')},
            'unitTrx': unit['trx']['path'], 'unitTrxSha256': unit['trx']['sha256'],
            'currentFrozen': frozen_ref, 'previousFrozen': previous_ref,
            'previousAcceptedBackend': previous_acceptance, 'sourceDelta': [source_delta],
        })
        self.acceptance = {
            **accepted, 'frozen': frozen_ref,
            'unit': {**unit, 'reusedFromRound3': True, 'reuseProof': proof},
            'commerceChargePolicyAccepted': True, 'privateReturnRequestsAccepted': True,
            'privateAdminHeadersAccepted': True, 'physicalFulfillmentCapacityAccepted': True,
            'customerLoginContinuityAccepted': True,
        }
        acceptance_ref = self.write_json(self.acceptance_path, self.acceptance)
        self.state = {'runtimeDirectory': self.runtime.relative_to(self.root).as_posix(),
                      'localReleaseEvidence': self.publication_path.relative_to(self.root).as_posix(),
                      'moduleSha256': module_hashes}
        self.write_json(self.publication_path, {
            'passed': True, 'databaseMigrationCount': 88, 'tableCount': 229, 'unitPassed': self.TOTAL,
            'services': {'api': {'runtimeDirectory': self.state['runtimeDirectory']}},
            'acceptedEvidence': {acceptance_ref['path']: acceptance_ref['sha256']},
        })

    def reference(self, path):
        return {'path': path.relative_to(self.root).as_posix(), 'sha256': v.sha(path)}

    def write_json(self, path, value):
        self.write(path, json.dumps(value).encode())
        return self.reference(path)

    @staticmethod
    def write(path, content):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)

    def validate(self):
        # A regression here must never fall back to legacy photo validation or
        # issue transport/SQL/process calls to compensate for a missing field.
        with (patch.object(v.legacy, 'modules') as old, patch.object(v.legacy.http.client, 'HTTPConnection') as network,
                patch.object(v.subprocess, 'run') as run, patch.object(v.subprocess, 'check_output') as output):
            try:
                return v.backend_evidence(self.state, self.runtime, self.acceptance_path, self.publication_path)
            finally:
                for operation in (old, network, run, output):
                    operation.assert_not_called()

    def test_d60_shape_without_legacy_source_count_keeps_all_exact_evidence(self):
        self.assertNotIn('backendSourceEntryCount', self.acceptance)
        result = self.validate()
        self.assertEqual(result['moduleCount'], 14)
        self.assertEqual(result['backendAcceptance']['sourceEntriesVerified'], 2)
        self.assertEqual(result['backendAcceptance']['testArtifactsVerified'], 6)
        self.assertEqual(result['backendAcceptance']['unitPassed'], self.TOTAL)
        self.assertTrue(result['backendAcceptance']['unitReusedFromOriginalRun'])
        self.assertIn(self.acceptance['unit']['reuseProof']['path'], result['backendAcceptance']['referencedEvidence'])

    def test_current_source_runtime_dll_test_artifact_and_trx_tampering_are_rejected(self):
        sources = deepcopy(self.frozen['sourceSha256']); sources[next(iter(sources))] = 'b' * 64
        with patch.object(v, 'current_backend_sources', return_value=sources), self.assertRaisesRegex(v.VerificationError, 'source inventory'):
            self.validate()
        original_sha = v.sha
        paths = [self.runtime / 'Shop.Api.dll',
                 self.root / 'backend/tests/Shop.SqlTests/bin/Debug/net10.0/Shop.SqlTests.dll',
                 self.trx_path]
        for target in paths:
            with self.subTest(target=str(target)), patch.object(v, 'sha', side_effect=lambda path: 'b' * 64 if path == target else original_sha(path)), self.assertRaises(v.VerificationError):
                self.validate()
        document = ET.parse(self.trx_path)
        document.find('.//{*}Counters').set('passed', str(self.TOTAL - 1))
        with patch.object(v.ET, 'parse', return_value=document), self.assertRaisesRegex(v.VerificationError, 'TRX counters'):
            self.validate()

    def test_original_reused_unit_refs_and_published_acceptance_hash_cannot_be_substituted(self):
        original_read = v.read
        reuse_path = v.ROOT / self.acceptance['unit']['reuseProof']['path']
        for target, mutation in [
            (reuse_path, lambda document: document['previousAcceptedBackend'].update(sha256='b' * 64)),
            (reuse_path, lambda document: document.update(sourceDelta=['backend/src/Shop.Api/Program.cs'])),
            (self.publication_path, lambda document: document['acceptedEvidence'].update({str(self.acceptance_path.relative_to(v.ROOT)): 'b' * 64})),
        ]:
            def changed(path):
                document = original_read(path)
                if path == target: mutation(document)
                return document
            with self.subTest(path=str(target)), patch.object(v, 'read', side_effect=changed), self.assertRaises(v.VerificationError):
                self.validate()


if __name__ == '__main__':
    main()
