"""Offline publisher guards. No subprocess, SQL, HTTP, or real descriptor write."""
from copy import deepcopy
from pathlib import Path
from unittest import TestCase, main
from unittest.mock import patch
from contextlib import ExitStack
import importlib.util
import io
from email.message import Message

from scripts.tests.script_loader import load_script


p = load_script('image_library_publisher', 'publish-local-image-library.py')


class PublisherTests(TestCase):
    def setUp(self):
        # Every test is offline even if a guard accidentally reaches a later boundary.
        for target, name in [(p.ops, 'read'), (p.ops, 'write'), (p.ops.HTTP, 'open'),
                             (p.rma, 'sql'), (p.rma, 'payload'), (p.rma, 'snapshot'),
                             (p.rma, 'shape'), (p.rma, 'listener'), (p.rma, 'owned_process'),
                             (p.rma, 'stop_owned'), (p.rma, 'start_selected'),
                             (p.runner, 'freeze')]:
            patcher = patch.object(target, name, side_effect=AssertionError('Unmocked live boundary: ' + name))
            patcher.start(); self.addCleanup(patcher.stop)

    def state(self):
        return {'api': 'http://127.0.0.1:5080', 'sourceMigrationCount': 88, 'databaseMigrationCount': 88,
                'tableCount': 229, 'commerceRmaAccepted': True, 'commerceRmaPolicyConfigured': True,
                'policyConfigurationPending': {'shippingTaxPolicy': False, 'reservationAndOpenOrderSettings': False, 'returnRequestPolicy': False, 'method': 'Normal authorized admin CAS'}, 'commerceRmaRecoveryRequired': False,
                'usedInspectionPhotosApiAccepted': True, 'privateAdminHeadersAccepted': True,
                'customerLoginContinuityAccepted': True, 'privateFilesStorage': 'Disabled',
                'storeIdentityApiAccepted': True, 'storeIdentityAccepted': True,
                'storeIdentityExamplesConfigured': True, 'storeIdentityBackendEvidence': 'accepted-d63',
                'manualAddressBrowserAccepted': True, 'addressMapFlowBuildRun': 'existing-d64',
                'catalogPriceHistoryApiAccepted': True,
                'catalogPriceHistoryBackendEvidence': p.relative(p.BASELINE),
                'catalogPriceHistoryAutomatedAcceptanceEvidence': 'accepted-d65',
                'privateAdminQaPending': True,
                'catalogPriceHistoryPrivateAdminQaPending': True,
                'policyConfigurationEvidence': 'existing-real-policy-evidence',
                'runtimeDirectory': 'tmp/api-runtime-existing88', 'unrecognizedFutureMarker': {'retain': True}}

    def aggregate(self):
        return {**self.state(), 'database': 'Sayman', 'canonicalUrls': dict(p.rma.URLS),
                'componentReleaseEvidence': {'api': 'old-api', 'storefront': 'old-storefront', 'admin': 'old-admin'}}

    def test_finalized88_is_the_only_compatible_source_or_recovery(self):
        p.compatible88(self.state())
        for key, value in [('sourceMigrationCount', 86), ('databaseMigrationCount', 87), ('tableCount', 223),
                           ('api', 'http://127.0.0.1:5081'), ('commerceRmaAccepted', False),
                           ('policyConfigurationPending', True), ('commerceRmaRecoveryRequired', True),
                           ('commerceRmaPolicyConfigured', False)]:
            with self.subTest(key=key):
                state = self.state(); state[key] = value
                with self.assertRaises(Exception): p.compatible88(state)

    def test_current_and_recovery_require_exact_accepted_d65_modules_and_markers(self):
        _, baseline, _, _ = self.acceptance_fixture()
        state = self.state()
        state['moduleSha256'] = {name: value['api'] for name, value in baseline['frozen']['module14parity'].items()}
        with patch.object(p.ops, 'read', return_value=baseline) as read:
            p.current_d65(state)
            read.assert_called_once_with(p.BASELINE)
            for mutate in [
                lambda s: s.update(catalogPriceHistoryApiAccepted=False),
                lambda s: s.update(catalogPriceHistoryBackendEvidence='other-acceptance.json'),
                lambda s: s['moduleSha256'].update({'Shop.Api.dll': 'unknown-api'}),
                lambda s: s['moduleSha256'].update({'Shop.Modules.Catalog.dll': 'unknown-catalog'}),
                lambda s: s['moduleSha256'].pop('Shop.Modules.Guard0.dll'),
            ]:
                changed = deepcopy(state); mutate(changed)
                with self.subTest(mutation=mutate), self.assertRaises(Exception): p.current_d65(changed)
        for key, value in [('passed', False), ('schemaChanges', 1)]:
            changed = deepcopy(baseline); changed[key] = value
            with patch.object(p.ops, 'read', return_value=changed), self.assertRaises(Exception): p.current_d65(state)

    def test_candidate_retains_business_and_unknown_markers_and_never_claims_new_full_sql(self):
        old = self.state(); before = deepcopy(old)
        plan = {'previous': old, 'runtimeDirectory': 'tmp/api-runtime-image-library-' + 'a' * 32,
                'artifactManifest': 'artifacts/checks/manifest.json', 'artifactManifestSha256': 'a' * 64,
                'accepted': {'frozen': {'module14parity': {'Shop.Api.dll': {'api': 'a' * 64}}},
                             'unit': {'passed': 1520}, 'sql': {'passed': 36}}}
        new = p.candidate(plan, p.CHECKS / 'example-release.json')
        self.assertEqual(old, before)
        for key in ['commerceRmaAccepted', 'commerceRmaPolicyConfigured', 'policyConfigurationPending',
                    'commerceRmaRecoveryRequired', 'usedInspectionPhotosApiAccepted', 'privateAdminHeadersAccepted',
                    'customerLoginContinuityAccepted', 'privateFilesStorage', 'policyConfigurationEvidence',
                    'storeIdentityApiAccepted', 'storeIdentityAccepted', 'storeIdentityExamplesConfigured',
                    'storeIdentityBackendEvidence', 'manualAddressBrowserAccepted', 'addressMapFlowBuildRun',
                    'catalogPriceHistoryApiAccepted', 'catalogPriceHistoryBackendEvidence',
                    'catalogPriceHistoryAutomatedAcceptanceEvidence', 'privateAdminQaPending',
                    'catalogPriceHistoryPrivateAdminQaPending',
                    'unrecognizedFutureMarker']:
            self.assertEqual(new[key], before[key])
        self.assertFalse(new['mainSeedPerformed']); self.assertEqual(new['newMigrations'], 0)
        self.assertFalse(new['fullSqlRunThisRelease']); self.assertFalse(new['fullSqlSingleRunPassed'])
        self.assertEqual(new['historicalFullSqlPassed'], 1031)
        self.assertFalse(new['imageLibraryApiAccepted'])
        self.assertEqual(new['imageLibraryBackendEvidence'], p.relative(p.ACCEPTANCE))

    def test_only_api_and_catalog_bytes_can_change_and_dependencies_cannot_be_added(self):
        old = {name: 'old' for name in ['Shop.Api.dll', 'Shop.Api.pdb', 'Shop.Modules.Catalog.dll', 'Shop.Modules.Catalog.pdb', 'Shop.Modules.Sales.dll', 'Shop.Api.deps.json']}
        valid = {**old, 'Shop.Api.dll': 'new', 'Shop.Modules.Catalog.dll': 'new'}
        self.assertEqual(p.package_delta(old, valid), {'Shop.Api.dll', 'Shop.Modules.Catalog.dll'})
        for value in [{**valid, 'Shop.Modules.Sales.dll': 'new'}, {**valid, 'new.dll': 'new'},
                      {key: value for key, value in valid.items() if key != 'Shop.Api.deps.json'},
                      {**old, 'Shop.Api.dll': 'new'}]:
            with self.subTest(value=value):
                with self.assertRaises(Exception): p.package_delta(old, value)

    def test_stale_evidence_refuses_before_any_stop_or_sql(self):
        with patch.object(p, 'acceptance', return_value={'different': True}), patch.object(p.rma, 'stop_owned') as stop, patch.object(p.rma, 'shape') as sql:
            with self.assertRaises(Exception): p.apply({'kind': p.KIND, 'run': 'a' * 32, 'accepted': {}, 'helpers': {}})
            stop.assert_not_called(); sql.assert_not_called()

    def test_descriptor_race_refuses_before_any_stop_or_sql(self):
        with patch.object(p, 'acceptance', return_value={}), patch.object(p, 'helpers', return_value={}), patch.object(p, 'descriptor_hashes', return_value={'api': 'changed'}), patch.object(p.rma, 'stop_owned') as stop, patch.object(p.rma, 'shape') as sql:
            with self.assertRaises(Exception): p.apply({'kind': p.KIND, 'run': 'a' * 32, 'accepted': {}, 'helpers': {}, 'descriptors': {'api': 'previous'}})
            stop.assert_not_called(); sql.assert_not_called()

    def test_invalid_plan_never_enters_live_boundaries(self):
        for plan in [{}, {'kind': p.KIND, 'run': '../outside'}, {'kind': p.KIND, 'run': 'z' * 32}]:
            with patch.object(p, 'acceptance') as accepted, patch.object(p.rma, 'stop_owned') as stop:
                with self.assertRaises(Exception): p.apply(plan)
                accepted.assert_not_called(); stop.assert_not_called()

    def test_import_is_inert(self):
        with patch('subprocess.run', side_effect=AssertionError('No subprocess on import')), \
             patch('subprocess.Popen', side_effect=AssertionError('No startup on import')), \
             patch('urllib.request.OpenerDirector.open', side_effect=AssertionError('No HTTP on import')):
            spec = importlib.util.spec_from_file_location('image_library_import_only', Path(p.__file__))
            imported = importlib.util.module_from_spec(spec); spec.loader.exec_module(imported)
            self.assertEqual(imported.KIND, p.KIND)

    def test_aggregate_cannot_select_another_database_port_or_unfinalized_policy(self):
        p.aggregate88(self.aggregate())
        for key, value in [('database', 'Other'), ('databaseMigrationCount', 87),
                           ('canonicalUrls', {**p.rma.URLS, 'storefront': 'http://127.0.0.1:3105'}),
                           ('componentReleaseEvidence', {'api': 'only'}), ('commerceRmaPolicyConfigured', False),
                           ('catalogPriceHistoryApiAccepted', False)]:
            state = self.aggregate(); state[key] = value
            with self.subTest(key=key), self.assertRaises(Exception): p.aggregate88(state)

    def acceptance_fixture(self):
        modules = {name: {kind: 'old-' + name for kind in ('api', 'unit', 'sql')}
                   for name in ['Shop.Api.dll', 'Shop.Modules.Catalog.dll'] + ['Shop.Modules.Guard' + str(i) + '.dll' for i in range(12)]}
        baseline = {'passed': True, 'schemaChanges': 0, 'frozen': {
            'sourceSha256': {'backend/src/Shop.Api/Endpoints/PublicMediaEndpoints.cs': 'old', 'backend/unchanged.cs': 'same'},
            'module14parity': deepcopy(modules)}}
        for name in p.CHANGED_MODULES:
            modules[name] = {kind: 'new-' + name for kind in ('api', 'unit', 'sql')}
        frozen = {'sourceSha256': {**baseline['frozen']['sourceSha256'], **{path: 'new' for path in p.ALLOWED}},
                  'module14parity': modules, 'testAssemblySha256': {'unit': 'frozen-unit', 'sql': 'frozen-sql'}}
        sql_names = [name + '.WholeClassCase' for name in sorted(p.SQL_CLASSES)] + ['Shop.SqlTests.PublicImageLibrarySqlTests.AnotherCase']
        unit_names = ['Shop.Tests.CompleteUnit.Case' + str(i) for i in range(1554)]
        def record(name):
            return {'path': 'artifacts/checks/d66-offline-' + name, 'sha256': 'bound-hash', 'exitCode': 0}
        accepted = {'passed': True, 'schemaChanges': 0, 'frozen': frozen,
                    'build': record('build.log'), 'cleanup': record('cleanup.log'),
                    'unit': {**record('unit.trx'), 'passed': len(unit_names), 'names': unit_names},
                    'sql': {**record('sql.trx'), 'passed': len(sql_names), 'names': sql_names,
                            'classes': sorted(p.SQL_CLASSES), 'exactDiscoveryCounter': True},
                    'sqlDiscovery': record('discovery.json'), 'sqlClassesExpected': sorted(p.SQL_CLASSES)}
        discovery = {'allCases': 1100, 'selected': sql_names.copy(), 'selectedClasses': sorted(p.SQL_CLASSES)}
        actual = {'unit.trx': unit_names.copy(), 'sql.trx': sql_names.copy()}
        return accepted, baseline, discovery, actual

    def check_acceptance(self, mutate=None, cleanup=None):
        accepted, baseline, discovery, actual = self.acceptance_fixture()
        if mutate: mutate(accepted, baseline, discovery, actual)
        def read(path):
            if path == p.ACCEPTANCE: return accepted
            if path == p.BASELINE: return baseline
            if path == p.ROOT / accepted['sqlDiscovery']['path']: return discovery
            raise AssertionError('Unexpected evidence read')
        def trx(path, _count):
            return actual['unit.trx' if path.name.endswith('unit.trx') else 'sql.trx']
        with patch.object(p.ops, 'read', side_effect=read), \
             patch.object(p.ops, 'sha', return_value='bound-hash'), \
             patch.object(p.runner, 'freeze', return_value=accepted['frozen']), \
             patch.object(p.ops, 'accepted_trx', side_effect=trx), \
             patch.object(Path, 'read_text', return_value=p.CLEANUP_ZERO if cleanup is None else cleanup):
            return p.acceptance()

    def test_fresh_complete_targeted_acceptance_is_required(self):
        accepted = self.check_acceptance()
        self.assertEqual(accepted['sql']['passed'], 5)
        self.assertEqual(accepted['unit']['passed'], 1554)

    def test_source_baseline_and_exact_four_path_delta_are_guarded(self):
        for mutate in [
            lambda a, b, d, t: a['frozen']['sourceSha256'].update({'backend/extra.cs': 'unreviewed'}),
            lambda a, b, d, t: a['frozen']['sourceSha256'].pop('backend/src/Shop.Modules.Catalog/Media/Services/PublicImageLibrary.cs'),
            lambda a, b, d, t: b.update(passed=False),
            lambda a, b, d, t: a.update(schemaChanges=1),
        ]:
            with self.subTest(mutation=mutate), self.assertRaises(Exception): self.check_acceptance(mutate)

    def test_all14_modules_have_parity_and_only_api_catalog_change(self):
        for mutate in [
            lambda a, b, d, t: a['frozen']['module14parity'].update({'Shop.Modules.Guard0.dll': {kind: 'changed' for kind in ('api', 'unit', 'sql')}}),
            lambda a, b, d, t: a['frozen']['module14parity']['Shop.Api.dll'].update(unit='different'),
            lambda a, b, d, t: a['frozen']['module14parity'].pop('Shop.Modules.Guard0.dll'),
        ]:
            with self.subTest(mutation=mutate), self.assertRaises(Exception): self.check_acceptance(mutate)

    def test_check_hash_exit_codes_and_zero_cleanup_are_not_just_claims(self):
        for mutate in [
            lambda a, b, d, t: a['build'].update(sha256='stale'),
            lambda a, b, d, t: a['unit'].update(exitCode=1),
            lambda a, b, d, t: a['unit'].update(passed=1553),
            lambda a, b, d, t: a['sqlDiscovery'].update(sha256='stale'),
            lambda a, b, d, t: a['sql'].update(exactDiscoveryCounter=False),
        ]:
            with self.subTest(mutation=mutate), self.assertRaises(Exception): self.check_acceptance(mutate)
        with self.assertRaises(Exception): self.check_acceptance(cleanup='SQL cleanup incomplete: 1 database remains.')

    def test_counter_rejects_missing_cases_even_when_every_class_is_still_present(self):
        for mutate in [
            lambda a, b, d, t: d['selected'].pop(),
            lambda a, b, d, t: t['sql.trx'].pop(),
            lambda a, b, d, t: d['selected'].append(d['selected'][0]),
            lambda a, b, d, t: d['selectedClasses'].pop(),
            lambda a, b, d, t: a['sql']['classes'].append('Shop.SqlTests.Unrelated'),
        ]:
            with self.subTest(mutation=mutate), self.assertRaises(Exception): self.check_acceptance(mutate)

    def response(self, headers=None, body=b'', status=401):
        values = {'Cache-Control': 'private, no-store', 'Vary': 'Cookie, Authorization',
                  'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff',
                  'X-Sayman-Returns-Contract': 'rma-v1'}
        values.update(headers or {})
        message = Message()
        for name, value in values.items(): message[name] = value
        response = io.BytesIO(body); response.status = status; response.headers = message
        return response

    def test_private_image_library_uses_anonymous_bounded_get_and_strict_headers(self):
        path = '/api/admin/media/images'
        with patch.object(p.ops.HTTP, 'open', return_value=self.response()) as request:
            result = p.private_probe(path)
            self.assertTrue(result['privateHeadersAccepted'])
            request.assert_called_once_with(p.ops.API_URL + path, timeout=10)
        for headers in [{'Cache-Control': 'no-store'}, {'Vary': 'Authorization'}, {'X-Robots-Tag': ''},
                        {'X-Content-Type-Options': ''}, {'Set-Cookie': 'unexpected=1'}, {'Location': '/login'}]:
            with self.subTest(headers=headers), patch.object(p.ops.HTTP, 'open', return_value=self.response(headers)):
                with self.assertRaises(Exception): p.private_probe(path)
        for response in [self.response(body=b'x' * 32769), self.response(status=200)]:
            with patch.object(p.ops.HTTP, 'open', return_value=response), self.assertRaises(Exception): p.private_probe(path)

    def test_expected_http401_exception_is_inspected_as_a_private_response(self):
        path = '/api/admin/media/images'
        response = self.response()
        error = p.HTTPError(p.ops.API_URL + path, 401, 'Unauthorized', response.headers, io.BytesIO(b''))
        with patch.object(p.ops.HTTP, 'open', side_effect=error):
            self.assertTrue(p.private_probe(path)['privateHeadersAccepted'])

    def test_rma_marker_and_fixed_probe_paths_are_preserved(self):
        for path in ['/api/admin/products/p1/price-history', '/api/admin/content', '/api/returns', '/api/admin/media/images']:
            with patch.object(p.ops.HTTP, 'open', return_value=self.response()):
                self.assertTrue(p.private_probe(path)['privateHeadersAccepted'])
        with patch.object(p.ops.HTTP, 'open', return_value=self.response({'X-Sayman-Returns-Contract': ''})), self.assertRaises(Exception):
            p.private_probe('/api/returns')
        with patch.object(p.ops.HTTP, 'open') as request, self.assertRaises(Exception): p.private_probe('/api/admin/staff')
        request.assert_not_called()

    def test_sql_fingerprints_require229_tables_and_metadata(self):
        before = {'database': 'Sayman', 'atUtc': 'ignored', 'tables': [{}] * 229, 'configuration': {'key': 'hash'}}
        with patch.object(p.rma, 'snapshot', return_value=deepcopy(before)), patch.object(p.rma, 'payload', return_value=[{}] * 229):
            result = p.fingerprints()
            self.assertNotIn('atUtc', result); self.assertEqual(result['configuration'], before['configuration'])
        with patch.object(p.rma, 'snapshot', return_value=deepcopy(before)), patch.object(p.rma, 'payload', return_value=[{}] * 228):
            with self.assertRaises(Exception): p.fingerprints()

    def failure_after_stop(self, late=False):
        previous = self.state(); previous['apiPid'] = 100
        accepted = {'frozen': {'module14parity': {'Shop.Api.dll': {'api': 'a' * 64}}}, 'unit': {'passed': 1520}, 'sql': {'passed': 36}}
        hashes = {'api': 'api-before', 'storefront': 'sf-before', 'admin': 'admin-before'}
        plan = {'kind': p.KIND, 'run': 'a' * 32, 'accepted': accepted, 'helpers': {}, 'descriptors': hashes,
                'aggregateSha256': 'aggregate-before', 'preservedFiles': {}, 'previous': previous,
                'process': {'pid': 100}, 'runtimeDirectory': 'tmp/api-runtime-image-library-' + 'a' * 32,
                'artifactManifest': 'artifacts/checks/fake-manifest.json', 'artifactManifestSha256': 'b' * 64, 'apiFiles': {}}
        active = {**p.candidate(plan, p.CHECKS / 'fake.json'), 'apiPid': 200}
        writes = []
        def write(path, value, *args, **kwargs):
            writes.append((path, deepcopy(value)))
            if late and path == p.AGGREGATE: raise RuntimeError('injected aggregate failure')
        def sha(path):
            if path == p.AGGREGATE: return 'aggregate-before'
            for name, descriptor in p.rma.DESCRIPTORS.items():
                if path == descriptor: return hashes[name]
            return 'evidence-hash'
        with ExitStack() as stack:
            for target, name, options in [
                (p, 'acceptance', {'return_value': accepted}), (p, 'helpers', {'return_value': {}}),
                (p, 'current_d65', {'side_effect': p.compatible88}),
                (p, 'descriptor_hashes', {'return_value': hashes}), (p.ops, 'sha', {'side_effect': sha}),
                (p.photo, 'preserved_files', {'return_value': {}}),
                (p.rma, 'shape', {'return_value': {'migrationCount': 88, 'tableCount': 229}}),
                (p.rma, 'owned_process', {'side_effect': lambda _, state: {'pid': state['apiPid']}}),
                (p.rma, 'runtime', {'return_value': Path('/unused')}), (p.photo, 'tree', {'return_value': {}}),
                (p, 'fingerprints', {'return_value': {'all229': 'unchanged'}}),
                (p.rma, 'listener', {'return_value': 200}), (p.ops, 'write', {'side_effect': write}),
                (p.ops, 'read', {'return_value': self.aggregate()}),
                (p, 'private_probe', {'return_value': {'status': 401, 'privateHeadersAccepted': True}}),
            ]: stack.enter_context(patch.object(target, name, **options))
            stack.enter_context(patch.object(Path, 'exists', return_value=False))
            stop = stack.enter_context(patch.object(p.rma, 'stop_owned'))
            start = stack.enter_context(patch.object(p.rma, 'start_selected', side_effect=[(active, [], {'pid': 200}), ({**previous, 'apiPid': 300}, [], {'pid': 300})]))
            request = stack.enter_context(patch.object(p.ops, 'request', **({'return_value': ({'status': 200}, b'{}')} if late else {'side_effect': RuntimeError('injected HTTP failure')})))
            with self.assertRaises(RuntimeError): p.apply(plan)
            self.assertEqual(stop.call_count, 2)
            self.assertEqual(stop.call_args_list[0].args[2], {'pid': 100})
            self.assertEqual(stop.call_args_list[1].args[2], {'pid': 200})
            self.assertEqual(start.call_args_list[1].args[1], previous)
            self.assertGreater(request.call_count, 0)
        reports = [value for path, value in writes if path.name.endswith('-main-release.json')]
        self.assertFalse(reports[-1]['passed'])
        self.assertTrue(reports[-1]['recoveredPreviousCompatible88'])
        self.assertEqual(reports[-1]['newMigrations'], 0)

    def test_failed_probe_recovers_only_previous_compatible88(self): self.failure_after_stop()

    def test_failure_after_success_report_is_rewritten_failed_before_recovery(self): self.failure_after_stop(late=True)


if __name__ == '__main__': main()
