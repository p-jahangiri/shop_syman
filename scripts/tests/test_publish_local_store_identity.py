"""Offline publisher guards. No subprocess, SQL, HTTP, or real descriptor write."""
from copy import deepcopy
from pathlib import Path
from unittest import TestCase, main
from unittest.mock import patch
from contextlib import ExitStack

from scripts.tests.script_loader import load_script


p = load_script('store_identity_publisher', 'publish-local-store-identity.py')


class PublisherTests(TestCase):
    def state(self):
        return {'api': 'http://127.0.0.1:5080', 'sourceMigrationCount': 88, 'databaseMigrationCount': 88,
                'tableCount': 229, 'commerceRmaAccepted': True, 'commerceRmaPolicyConfigured': True,
                'policyConfigurationPending': {'shippingTaxPolicy': False, 'reservationAndOpenOrderSettings': False, 'returnRequestPolicy': False, 'method': 'Normal authorized admin CAS'}, 'commerceRmaRecoveryRequired': False,
                'usedInspectionPhotosApiAccepted': True, 'privateAdminHeadersAccepted': True,
                'customerLoginContinuityAccepted': True, 'privateFilesStorage': 'Disabled',
                'policyConfigurationEvidence': 'existing-real-policy-evidence',
                'runtimeDirectory': 'tmp/api-runtime-existing88', 'unrecognizedFutureMarker': {'retain': True}}

    def test_finalized88_is_the_only_compatible_source_or_recovery(self):
        p.compatible88(self.state())
        for key, value in [('sourceMigrationCount', 86), ('databaseMigrationCount', 87), ('tableCount', 223),
                           ('api', 'http://127.0.0.1:5081'), ('commerceRmaAccepted', False),
                           ('policyConfigurationPending', True), ('commerceRmaRecoveryRequired', True),
                           ('commerceRmaPolicyConfigured', False)]:
            with self.subTest(key=key):
                state = self.state(); state[key] = value
                with self.assertRaises(Exception): p.compatible88(state)

    def test_candidate_retains_business_and_unknown_markers_and_never_claims_new_full_sql(self):
        old = self.state(); before = deepcopy(old)
        plan = {'previous': old, 'runtimeDirectory': 'tmp/api-runtime-store-identity-' + 'a' * 32,
                'artifactManifest': 'artifacts/checks/manifest.json', 'artifactManifestSha256': 'a' * 64,
                'accepted': {'frozen': {'module14parity': {'Shop.Api.dll': {'api': 'a' * 64}}},
                             'unit': {'passed': 1520}, 'sql': {'passed': 36}}}
        new = p.candidate(plan, p.CHECKS / 'example-release.json')
        self.assertEqual(old, before)
        for key in ['commerceRmaAccepted', 'commerceRmaPolicyConfigured', 'policyConfigurationPending',
                    'commerceRmaRecoveryRequired', 'usedInspectionPhotosApiAccepted', 'privateAdminHeadersAccepted',
                    'customerLoginContinuityAccepted', 'privateFilesStorage', 'policyConfigurationEvidence', 'unrecognizedFutureMarker']:
            self.assertEqual(new[key], before[key])
        self.assertFalse(new['mainSeedPerformed']); self.assertEqual(new['newMigrations'], 0)
        self.assertFalse(new['fullSqlRunThisRelease']); self.assertFalse(new['fullSqlSingleRunPassed'])
        self.assertEqual(new['historicalFullSqlPassed'], 1031)

    def test_only_api_and_cms_bytes_can_change_and_dependencies_cannot_be_added(self):
        old = {name: 'old' for name in ['Shop.Api.dll', 'Shop.Api.pdb', 'Shop.Modules.Cms.dll', 'Shop.Modules.Cms.pdb', 'Shop.Modules.Sales.dll', 'Shop.Api.deps.json']}
        valid = {**old, 'Shop.Api.dll': 'new', 'Shop.Modules.Cms.dll': 'new'}
        self.assertEqual(p.package_delta(old, valid), {'Shop.Api.dll', 'Shop.Modules.Cms.dll'})
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

    def failure_after_stop(self, late=False):
        previous = self.state(); previous['apiPid'] = 100
        accepted = {'frozen': {'module14parity': {'Shop.Api.dll': {'api': 'a' * 64}}}, 'unit': {'passed': 1520}, 'sql': {'passed': 36}}
        hashes = {'api': 'api-before', 'storefront': 'sf-before', 'admin': 'admin-before'}
        plan = {'kind': p.KIND, 'run': 'a' * 32, 'accepted': accepted, 'helpers': {}, 'descriptors': hashes,
                'aggregateSha256': 'aggregate-before', 'preservedFiles': {}, 'previous': previous,
                'process': {'pid': 100}, 'runtimeDirectory': 'tmp/api-runtime-store-identity-' + 'a' * 32,
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
                (p, 'descriptor_hashes', {'return_value': hashes}), (p.ops, 'sha', {'side_effect': sha}),
                (p.photo, 'preserved_files', {'return_value': {}}),
                (p.rma, 'shape', {'return_value': {'migrationCount': 88, 'tableCount': 229}}),
                (p.rma, 'owned_process', {'side_effect': lambda _, state: {'pid': state['apiPid']}}),
                (p.rma, 'runtime', {'return_value': Path('/unused')}), (p.photo, 'tree', {'return_value': {}}),
                (p, 'fingerprints', {'return_value': {'all229': 'unchanged'}}),
                (p.rma, 'listener', {'return_value': 200}), (p.ops, 'write', {'side_effect': write}),
                (p.ops, 'read', {'return_value': {'componentReleaseEvidence': {'api': 'old'}}}),
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
