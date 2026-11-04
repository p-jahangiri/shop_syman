"""Offline release-gate fixtures. No HTTP, SQL, services or business rows are used."""
from contextlib import ExitStack
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase, main
from unittest.mock import patch
import hashlib
import json
import sys
from types import SimpleNamespace

from scripts.tests.script_loader import load_script


verifier = load_script('business_release_verifier', 'verify-local-business-release.py')


class FrozenEvidenceTests(TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.checks = self.root / 'artifacts/checks'
        self.frozen_path = self.checks / 'used-photos-backend/frozen-accepted.json'
        self.accepted_path = self.checks / 'used-photos-backend/acceptance.json'
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        for name, value in {'ROOT': self.root, 'CHECKS': self.checks,
                            'USED_PHOTOS_FROZEN': self.frozen_path,
                            'USED_PHOTOS_ACCEPTANCE': self.accepted_path}.items():
            self.stack.enter_context(patch.object(verifier, name, value))
        source = self.write('backend/src/source.cs', 'frozen source')
        tests = {}
        for assembly in ('Shop.Tests', 'Shop.SqlTests'):
            for suffix in ('dll', 'deps.json', 'runtimeconfig.json'):
                name = f'backend/tests/{assembly}/bin/Debug/net10.0/{assembly}.{suffix}'
                tests[name] = verifier.sha(self.write(name, name))
        digest = 'a' * 64
        names = ['Shop.Api.dll'] + [f'Shop.Module{chr(65 + i)}.dll' for i in range(13)]
        self.frozen = {'sourceSha256': {'backend/src/source.cs': verifier.sha(source)},
                       'module14parity': {name: {label: digest for label in ('api', 'unit', 'sql')} for name in names},
                       'testAssemblySha256': tests}
        self.accepted = {'backendSourceEntryCount': 1, 'module14parity': self.frozen['module14parity'],
                         'testAssemblySha256': tests, 'unit': {'total': 1416, 'failed': 0, 'skipped': 0}}
        self.trx()
        self.save()

    def write(self, name, value):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value)
        return path

    def trx(self, passed=1416):
        counters = {name: '0' for name in ('failed', 'error', 'timeout', 'aborted', 'inconclusive',
                                          'passedButRunAborted', 'notRunnable', 'notExecuted', 'disconnected')}
        counters.update(total=str(self.accepted['unit']['total']), executed=str(passed), passed=str(passed))
        attributes = ' '.join(f'{key}="{value}"' for key, value in counters.items())
        path = self.write(str(self.accepted_path.parent.relative_to(self.root) / 'unit-accepted/unit.trx'),
                          '<TestRun><ResultSummary><Counters ' + attributes + '/></ResultSummary></TestRun>')
        self.accepted['unit']['trx'] = {'path': str(path.relative_to(self.root)), 'sha256': verifier.sha(path)}

    def save(self):
        self.write(str(self.frozen_path.relative_to(self.root)), json.dumps(self.frozen))
        self.accepted['frozen'] = {'path': str(self.frozen_path.relative_to(self.root)),
                                   'sha256': verifier.sha(self.frozen_path)}
        self.write(str(self.accepted_path.relative_to(self.root)), json.dumps(self.accepted))

    def test_new_frozen_shape_proves_fourteen_equal_modules_and_exact_unit_counter(self):
        modules, proof = verifier.used_photos_evidence(self.frozen)
        self.assertEqual(len(modules), 14)
        self.assertEqual(proof['unitPassed'], 1416)
        self.assertEqual(proof['testArtifactsVerified'], 6)
        self.assertEqual(proof['sourceEntriesVerified'], 1)

    def test_source_and_test_assembly_drift_are_rejected(self):
        for relative in ('backend/src/source.cs', next(iter(self.frozen['testAssemblySha256']))):
            with self.subTest(path=relative):
                path = self.root / relative
                original = path.read_text()
                path.write_text(original + ' drift')
                with self.assertRaises(verifier.VerificationError):
                    verifier.used_photos_evidence(self.frozen)
                path.write_text(original)

    def test_split_api_unit_sql_parity_is_rejected_even_when_acceptance_agrees(self):
        self.frozen['module14parity']['Shop.Api.dll']['sql'] = 'b' * 64
        self.save()
        with self.assertRaisesRegex(verifier.VerificationError, 'parity is incomplete'):
            verifier.used_photos_evidence(self.frozen)

    def test_forged_unit_summary_cannot_hide_missing_trx_case(self):
        self.trx(passed=1415)
        self.save()
        with self.assertRaisesRegex(verifier.VerificationError, 'TRX counters'):
            verifier.used_photos_evidence(self.frozen)

    def test_explicit_combined_acceptance_resolves_its_own_frozen_file_and_unit_total(self):
        self.frozen_path = self.checks / 'business-final-backend/frozen.json'
        self.accepted_path = self.checks / 'business-final-backend/acceptance.json'
        self.accepted['unit']['total'] = 1422
        self.accepted['physicalFulfillmentCapacityAccepted'] = True
        self.trx(passed=1422)
        self.save()
        modules, proof = verifier.used_photos_evidence(self.frozen, self.accepted_path)
        self.assertEqual(len(modules), 14)
        self.assertEqual(proof['unitPassed'], 1422)
        self.assertEqual(proof['path'], 'artifacts/checks/business-final-backend/acceptance.json')
        _, historical = verifier.used_photos_evidence(self.frozen)
        self.assertEqual(historical['unitPassed'], 1416)

    def test_combined_unit_total_requires_exact_trx_and_at_least_photo_baseline(self):
        for total, passed in ((1422, 1416), (1415, 1415)):
            with self.subTest(total=total, passed=passed):
                self.accepted['unit']['total'] = total
                self.trx(passed=passed)
                self.save()
                with self.assertRaises(verifier.VerificationError):
                    verifier.used_photos_evidence(self.frozen)

    def test_selected_acceptance_cannot_escape_owned_frozen_artifacts(self):
        self.accepted['frozen']['path'] = '../outside.json'
        self.write(str(self.accepted_path.relative_to(self.root)), json.dumps(self.accepted))
        with self.assertRaisesRegex(verifier.VerificationError, 'workspace-relative'):
            verifier.backend_acceptance(self.accepted_path)


class ReleaseGateTests(TestCase):
    def harness(self, used_photos, capacity_selected=False, continuity_selected=False):
        schema, tables = (86, 223) if used_photos else (85, 222)
        states = {name: {'mainPromoted': True, 'api': verifier.URLS['api'],
                         'sourceMigrationCount': schema, 'databaseMigrationCount': schema,
                         'localReleaseEvidence': name + '-release.json'} for name in verifier.PORTS}
        states['api'].update(digitalDeliveryApiAccepted=True, tableCount=tables)
        aggregate = {'canonicalUrls': verifier.URLS, 'database': 'Sayman', 'databaseMigrationCount': schema,
                     'componentReleaseEvidence': {name: state['localReleaseEvidence'] for name, state in states.items()}}
        aggregate.update({name + 'Descriptor': str(path.relative_to(verifier.ROOT))
                          for name, path in verifier.DESCRIPTORS.items()})
        if used_photos:
            aggregate.update(usedInspectionPhotosAccepted=True, tableCount=223)
            states['api'].update(usedInspectionPhotosApiAccepted=True, usedInspectionPhotosFrontendPromotionPending=False,
                                 usedInspectionPhotosMigrationId=verifier.USED_PHOTOS_MIGRATION)
            for name in ('storefront', 'admin'):
                states[name].update(tableCount=223, usedInspectionPhotosFrontendAccepted=True)
        if capacity_selected:
            states['api']['physicalFulfillmentCapacityAccepted'] = True
        if continuity_selected:
            states['api']['customerLoginContinuityAccepted'] = True
        documents = {path: states[name] for name, path in verifier.DESCRIPTORS.items()}
        documents[verifier.AGGREGATE] = aggregate
        return states, aggregate, documents

    def run_verify(self, used_photos, mutate=None, image_headers=None, capacity_selected=False, continuity_selected=False):
        states, aggregate, documents = self.harness(used_photos, capacity_selected, continuity_selected)
        if mutate:
            mutate(states, aggregate)
        proof = {'httpChecks': []}
        calls = []

        def get(component, path, status, timeout, private=False, expected_hash=None, records=None):
            calls.append((component, path, status, private))
            body = b'{"status":"ready"}'
            if component == 'admin' and path == '/':
                body = b'<script src="/assets/app.js"></script>'
            record = {'headers': {'x-content-type-options': 'nosniff', 'content-type': ''}}
            if image_headers and status == 404:
                record['headers'].update(image_headers)
            if records is not None:
                records.append(record)
            return record, body

        with ExitStack() as stack:
            stack.enter_context(patch.object(verifier, 'sha', return_value='a' * 64))
            stack.enter_context(patch.object(verifier, 'read', side_effect=lambda path: deepcopy(documents[path])))
            selected_path = (verifier.CHECKS / 'business-continuity-backend/acceptance.json' if continuity_selected
                             else verifier.CHECKS / 'business-final-backend/acceptance.json'
                             if capacity_selected else verifier.USED_PHOTOS_ACCEPTANCE)
            documents[selected_path] = {'physicalFulfillmentCapacityAccepted': capacity_selected,
                                        'customerLoginContinuityAccepted': continuity_selected}
            stack.enter_context(patch.object(verifier, 'backend_acceptance', return_value=(
                selected_path, documents[selected_path], verifier.USED_PHOTOS_FROZEN)))
            modules = stack.enter_context(patch.object(verifier, 'modules', return_value={'moduleCount': 14}))
            manifest = stack.enter_context(patch.object(verifier, 'manifest', side_effect=lambda state, name: (
                verifier.ROOT / 'tmp' / (name + '-runtime-offline'), {'index.html': 'index-sha', 'assets/app.js': 'js-sha'}, {})))
            stack.enter_context(patch.object(verifier, 'get', side_effect=get))
            sql = stack.enter_context(patch.object(verifier, 'sql_shape', return_value={'readOnly': True}))
            stack.enter_context(patch.object(verifier, 'ready_public_image_smoke', return_value={'status': 'not-run'}))
            verifier.verify(proof, 15, True, used_photos, selected_path if capacity_selected or continuity_selected else None)
        return proof, calls, modules, manifest, sql

    def test_default_historical_release_remains85_and_has_no_photo_requests(self):
        proof, calls, modules, manifest, sql = self.run_verify(False)
        self.assertTrue(proof['passed'])
        self.assertNotIn('usedInspectionPhotos', proof)
        self.assertNotIn('readyPublicImages', proof)
        self.assertFalse(any('used-items' in path or '/media/catalog/' in path for _, path, _, _ in calls))
        self.assertEqual(modules.call_count, 1)
        self.assertFalse(modules.call_args.args[2])
        self.assertEqual(manifest.call_count, 6)
        sql.assert_called_once_with(85, 222)

    def test_photo_mode_retains_old_requests_and_adds_only_anonymous_protection_and404_checks(self):
        _, old, _, _, _ = self.run_verify(False)
        proof, current, modules, manifest, sql = self.run_verify(True)
        self.assertEqual(current[:len(old)], old)
        extra = current[len(old):]
        self.assertEqual(len(extra), 10)
        self.assertEqual(sum(status == 401 and private for _, _, status, private in extra), 4)
        self.assertEqual(sum(status == 404 for _, _, status, _ in extra), 6)
        self.assertTrue(proof['usedInspectionPhotos']['allThreeDescriptorsAndAggregateAccepted'])
        self.assertFalse(proof['usedInspectionPhotos']['authenticatedPhotoGalleryBrowserAccepted'])
        self.assertEqual(proof['readyPublicImages']['status'], 'not-run')
        self.assertEqual(modules.call_count, 2)
        self.assertEqual(manifest.call_count, 6)
        sql.assert_called_once_with(86, 223)

    def test_half_publication_is_rejected_before_http_or_artifact_validation(self):
        mutations = [lambda s, a: a.update(usedInspectionPhotosAccepted=False),
                     lambda s, a: s['api'].update(usedInspectionPhotosFrontendPromotionPending=True),
                     lambda s, a: s['storefront'].update(usedInspectionPhotosFrontendAccepted=False),
                     lambda s, a: s['admin'].update(tableCount=222),
                     lambda s, a: s['admin'].update(sourceMigrationCount=85)]
        for mutate in mutations:
            with self.subTest(mutation=mutations.index(mutate)):
                with patch.object(verifier.http.client, 'HTTPConnection') as connection:
                    with self.assertRaises(verifier.VerificationError):
                        self.run_verify(True, mutate)
                    connection.assert_not_called()

    def test_missing_public_photo_cannot_be_mislabeled_as_an_image_or_omit_nosniff(self):
        for headers in ({'content-type': 'image/webp'}, {'x-content-type-options': ''}):
            with self.subTest(headers=headers):
                with self.assertRaisesRegex(verifier.VerificationError, 'unavailable public image'):
                    self.run_verify(True, image_headers=headers)

    def test_combined_acceptance_requires_capacity_api_marker_and_records_only_matching_scope(self):
        proof, _, modules, _, _ = self.run_verify(True, capacity_selected=True)
        self.assertTrue(proof['physicalFulfillmentCapacity']['selectedBackendAcceptanceAndApiMarkerMatch'])
        self.assertEqual(modules.call_args.args[3], verifier.CHECKS / 'business-final-backend/acceptance.json')
        with self.assertRaisesRegex(verifier.VerificationError, 'capacity fix has not been promoted'):
            self.run_verify(True, lambda s, a: s['api'].update(physicalFulfillmentCapacityAccepted=False),
                            capacity_selected=True)
        photos_only, _, _, _, _ = self.run_verify(True)
        self.assertNotIn('physicalFulfillmentCapacity', photos_only)

    def test_explicit_backend_cannot_change_default_historical_release(self):
        with self.assertRaisesRegex(verifier.VerificationError, 'requires the used-inspection-photos'):
            verifier.verify({'httpChecks': []}, 15, False, False,
                            verifier.CHECKS / 'business-final-backend/acceptance.json')

    def test_login_continuity_marker_is_required_only_when_selected_backend_accepts_it(self):
        proof, _, _, _, _ = self.run_verify(True, capacity_selected=True, continuity_selected=True)
        self.assertTrue(proof['customerLoginContinuity']['selectedBackendAcceptanceAndApiMarkerMatch'])
        with self.assertRaisesRegex(verifier.VerificationError, 'customer-login continuity fix has not been promoted'):
            self.run_verify(True, lambda s, a: s['api'].update(customerLoginContinuityAccepted=False),
                            capacity_selected=True, continuity_selected=True)
        photos_only, _, _, _, _ = self.run_verify(True)
        capacity_only, _, _, _, _ = self.run_verify(True, capacity_selected=True)
        historical, _, _, _, _ = self.run_verify(False)
        for result in (photos_only, capacity_only, historical):
            self.assertNotIn('customerLoginContinuity', result)


class ReadyPublicImageTests(TestCase):
    def metadata(self):
        bodies = {name: b'RIFF' + b'\0' * 4 + b'WEBP' + name.encode() for name in ('thumb', 'card', 'zoom')}
        return {'assetId': 'a' * 32,
                'variants': [{'name': name, 'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()}
                             for name, body in bodies.items()]}, bodies

    def run_smoke(self, assets, bodies, tamper=None):
        calls = []

        def sql(query, timeout):
            self.assertIn('TOP (3)', query)
            self.assertIn("a.Status=N'Ready'", query)
            self.assertNotIn('CreatedBy', query)
            self.assertNotIn('OriginalSha256', query)
            self.assertEqual(timeout, 20)
            return json.dumps({'assets': assets})

        def get(component, path, status, timeout, private=False, expected_hash=None, records=None):
            self.assertEqual(status, 200)
            self.assertFalse(private)
            body = bodies[Path(path).stem]
            record = {'component': component, 'path': path, 'bodyBytes': len(body),
                      'bodySha256': hashlib.sha256(body).hexdigest(),
                      'headers': {'content-type': 'image/webp', 'x-content-type-options': 'nosniff'}}
            self.assertEqual(expected_hash, record['bodySha256'])
            if tamper:
                tamper(record)
            calls.append((component, path))
            if records is not None:
                records.append(record)
            return record, body

        with patch.dict(sys.modules, {'local_shop_ops': SimpleNamespace(sql=sql)}):
            with patch.object(verifier, 'get', side_effect=get):
                proof = verifier.ready_public_image_smoke(15, [])
        return proof, calls

    def test_all_three_real_metadata_variants_are_required_at_all_three_gateways(self):
        asset, bodies = self.metadata()
        proof, calls = self.run_smoke([asset], bodies)
        self.assertEqual(proof['status'], 'passed')
        self.assertTrue(proof['readyBytesAndSha256Match'])
        self.assertEqual(proof['httpChecks'], 9)
        self.assertEqual(set(calls), {(component, ('/media/catalog/' if component == 'storefront' else '/api/media/catalog/')
                                      + asset['assetId'] + '/' + name + '.webp')
                                     for component in verifier.PORTS for name in bodies})
        self.assertFalse(proof['uploadPerformed'])
        self.assertFalse(proof['authenticatedGalleryOrBrowserAccepted'])

    def test_zero_ready_images_records_not_run_and_incomplete_or_overbound_metadata_is_rejected(self):
        proof, calls = self.run_smoke([], {})
        self.assertEqual(proof['status'], 'not-run')
        self.assertFalse(proof['readyBytesAndSha256Match'])
        self.assertEqual(calls, [])
        asset, bodies = self.metadata()
        incomplete = deepcopy(asset)
        incomplete['variants'].pop()
        for assets in ([incomplete], [asset, asset], [asset] * 4):
            with self.subTest(assets=len(assets), variants=len(assets[0]['variants'])):
                with self.assertRaises(verifier.VerificationError):
                    self.run_smoke(assets, bodies)

    def test_positive_image_bytes_hash_mime_and_nosniff_must_all_match(self):
        asset, bodies = self.metadata()
        mutations = [lambda r: r['headers'].update({'content-type': 'image/png'}),
                     lambda r: r['headers'].update({'x-content-type-options': ''}),
                     lambda r: r.update(bodyBytes=r['bodyBytes'] + 1),
                     lambda r: r.update(bodySha256='0' * 64)]
        for tamper in mutations:
            with self.subTest(mutation=mutations.index(tamper)):
                with self.assertRaisesRegex(verifier.VerificationError, 'Ready public image differs'):
                    self.run_smoke([asset], bodies, tamper)


if __name__ == '__main__':
    main()
