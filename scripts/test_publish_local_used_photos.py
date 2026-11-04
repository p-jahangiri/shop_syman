"""Offline publication faults. Synthetic files only; never starts a service or SQL."""
from contextlib import ExitStack
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import TestCase, main
from unittest.mock import Mock, patch
import importlib.util


spec = importlib.util.spec_from_file_location('used_photo_publication', Path(__file__).with_name('publish_local_used_photos.py'))
publication = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publication)


def compatibility(**values):
    counts = {'photoRows': 0, 'receiptJson': 0, 'quoteJson': 0, 'orderJson': 0, **values}
    return {'counts': counts, 'oldCodeCompatible': not any(counts.values()), 'readOnly': True}


class CompatibilityTests(TestCase):
    def test_empty_rows_cannot_authorize_old_code_when_any_json_retains_the_new_property(self):
        publication.require_old_compatible(compatibility())
        for field in ('photoRows', 'receiptJson', 'quoteJson', 'orderJson'):
            with self.subTest(field=field), self.assertRaises(publication.ops.PublishError):
                publication.require_old_compatible(compatibility(**{field: 1}))

    def test_copied_compatibility_flag_cannot_override_nonzero_snapshot_count(self):
        value = compatibility(quoteJson=1)
        value['oldCodeCompatible'] = True
        with self.assertRaises(publication.ops.PublishError):
            publication.require_old_compatible(value)

    def test_new_public_objects_are_allowed_but_existing_objects_cannot_change_or_disappear(self):
        before = {'configuration': {'keys': 'fixed'}, 'mediaConfigurationSha256': 'fixed', 'publicMediaObjects': {'old.webp': 'original'}}
        after = deepcopy(before)
        after['publicMediaObjects']['new.webp'] = 'new-upload'
        publication.preserve_existing_files(before, after)
        for changed in ({}, {'old.webp': 'changed'}):
            after['publicMediaObjects'] = changed
            with self.assertRaises(publication.ops.PublishError):
                publication.preserve_existing_files(before, after)


class EvidenceSelectionTests(TestCase):
    def test_new_build_hash_cannot_hide_stale_quality_check_source(self):
        with TemporaryDirectory() as temporary:
            file = Path(temporary) / 'synthetic-form.tsx'
            file.write_text('current form')
            current = publication.ops.sha(file)
            build = {'source': {'synthetic-form.tsx': current}}
            frontend = {'sourceSha256': {'synthetic-form.tsx': 'old-quality-source'}}
            with patch.object(publication.ops, 'relative_path', return_value=file):
                with self.assertRaises(publication.ops.PublishError):
                    publication.verify_frontend_sources(frontend, build)
                frontend['sourceSha256']['synthetic-form.tsx'] = current
                publication.verify_frontend_sources(frontend, build)

    def test_default_and_explicit_evidence_paths_stay_under_the_check_directory(self):
        defaults = publication.evidence_selection()
        self.assertEqual(defaults, {'backendAcceptance': 'artifacts/checks/used-photos-backend/acceptance.json',
                                    'sqlProof': 'artifacts/checks/used-photos-sql/proof.json',
                                    'frontendAcceptance': 'artifacts/checks/used-inspection-photos-frontend/acceptance.json'})
        selected = publication.evidence_selection('artifacts/checks/business-final-backend/acceptance.json',
                                                  'artifacts/checks/business-final-sql/proof.json',
                                                  'artifacts/checks/business-final-frontend/acceptance.json')
        self.assertEqual(selected['backendAcceptance'], 'artifacts/checks/business-final-backend/acceptance.json')
        self.assertEqual(selected['sqlProof'], 'artifacts/checks/business-final-sql/proof.json')
        self.assertEqual(selected['frontendAcceptance'], 'artifacts/checks/business-final-frontend/acceptance.json')
        for invalid in ('/tmp/arbitrary.json', 'tmp/current.json', 'artifacts/checks/../../tmp/current.json'):
            with self.subTest(path=invalid), self.assertRaises(publication.ops.PublishError):
                publication.evidence_selection(invalid)

    def test_candidate_uses_actual_counts_and_requires_explicit_boolean_capacity_acceptance(self):
        previous = {'runtimeDirectory': 'tmp/api-runtime-old', 'physicalFulfillmentCapacityAccepted': True}
        accepted = {'modules': {}, 'unitPassed': 1439, 'targetedSqlPassed': 31, 'fullSqlPassed': 971}
        plan = {'previous': previous, 'accepted': accepted}
        with patch.object(publication.ops, 'sha', return_value='synthetic-manifest-hash'):
            for marker in (None, False, 1, 'true', True):
                with self.subTest(marker=marker):
                    accepted.pop('physicalFulfillmentCapacityAccepted', None)
                    if marker is not None:
                        accepted['physicalFulfillmentCapacityAccepted'] = marker
                    state = publication.state86(plan, publication.ROOT / 'tmp/api-runtime-synthetic',
                                                publication.CHECKS / 'manifest.json', publication.CHECKS / 'report.json')
                    self.assertEqual(state['unitPassed'], 1439)
                    self.assertEqual(state['fullSqlPassed'], 971)
                    self.assertEqual(state['sqlPassed'], 971)
                    self.assertEqual(state.get('physicalFulfillmentCapacityAccepted'), True if marker is True else None)

    def test_login_continuity_marker_is_never_inherited_or_inferred_from_truthy_values(self):
        plan = {'previous': {'runtimeDirectory': 'tmp/api-runtime-old', 'customerLoginContinuityAccepted': True},
                'accepted': {'modules': {}, 'unitPassed': 1422, 'targetedSqlPassed': 97, 'fullSqlPassed': 966}}
        with patch.object(publication.ops, 'sha', return_value='synthetic-manifest-hash'):
            for marker in (None, False, 1, 'true', True):
                with self.subTest(marker=marker):
                    plan['accepted'].pop('customerLoginContinuityAccepted', None)
                    if marker is not None:
                        plan['accepted']['customerLoginContinuityAccepted'] = marker
                    state = publication.state86(plan, publication.ROOT / 'tmp/api-runtime-synthetic',
                                                publication.CHECKS / 'manifest.json', publication.CHECKS / 'report.json')
                    self.assertEqual(state.get('customerLoginContinuityAccepted'), True if marker is True else None)


class ApiRecoveryTests(TestCase):
    def fixture(self, migration=86, photo_json=True, foreign=False):
        plan = {'runId': 'a' * 32, 'previous': {'runtimeDirectory': 'tmp/api-runtime-old', 'apiPid': 10},
                'aggregate': {'databaseMigrationCount': 85, 'componentReleaseEvidence': {'api': 'old.json'}}}
        candidate = {'runtimeDirectory': 'tmp/api-runtime-used-photos-new', 'apiPid': None}
        report, writes, starts = {}, [], []
        report_path = publication.CHECKS / 'synthetic-release.json'

        def start(state, log):
            starts.append(deepcopy(state))
            return SimpleNamespace(pid=20), {**state, 'apiPid': 20}

        def read(path):
            if path == publication.AGGREGATE:
                return deepcopy(plan['aggregate'])
            return {'runtimeDirectory': 'tmp/foreign-runtime', 'apiPid': 999}

        stack = ExitStack()
        stack.enter_context(patch.object(publication, 'shape', return_value={'migrationCount': migration, 'tableCount': 223 if migration == 86 else 222}))
        stack.enter_context(patch.object(publication, 'photo_compatibility', return_value=compatibility(orderJson=int(photo_json))))
        stack.enter_context(patch.object(publication, 'pending_migration'))
        stack.enter_context(patch.object(publication, 'snapshot', return_value={'histories': []}))
        stack.enter_context(patch.object(publication, 'start_selected', side_effect=start))
        stack.enter_context(patch.object(publication.ops, 'listener', return_value=999 if foreign else None))
        stack.enter_context(patch.object(publication.ops, 'read', side_effect=read))
        stack.enter_context(patch.object(publication.ops, 'write', side_effect=lambda path, value: writes.append((path, deepcopy(value)))))
        stack.enter_context(patch.object(publication.ops, 'sha', return_value='synthetic-evidence-hash'))
        for module, name in ((publication, 'sql'), (publication, 'payload'), (publication.subprocess, 'run'),
                             (publication.subprocess, 'Popen'), (publication.os, 'kill')):
            stack.enter_context(patch.object(module, name, side_effect=AssertionError('Real side effect forbidden')))
        return stack, plan, candidate, report, report_path, starts, writes

    def test_failure_after_migration_and_photo_writes_starts_only_compatible_candidate(self):
        stack, plan, candidate, report, path, starts, writes = self.fixture()
        with stack:
            publication.recover_api(plan, candidate, report, path)
        self.assertEqual([value['runtimeDirectory'] for value in starts], [candidate['runtimeDirectory']])
        self.assertFalse(starts[0]['usedInspectionPhotosApiAccepted'])
        self.assertTrue(starts[0]['usedInspectionPhotosRecoveryRequired'])
        self.assertEqual(report['recovery'], 'compatible86-forward-only')
        self.assertFalse(report['sqlDowngradedOrRestored'])
        self.assertTrue(writes[-1][1]['usedInspectionPhotosRecoveryRequired'])
        self.assertEqual(writes[-1][1]['schemaReleaseEvidence'], {'path': publication.relative(path), 'sha256': 'synthetic-evidence-hash'})

    def test_prior85_recovery_is_limited_to_unchanged_schema_and_zero_photo_history(self):
        stack, plan, candidate, report, path, starts, _ = self.fixture(migration=85, photo_json=False)
        with stack:
            publication.recover_api(plan, candidate, report, path)
        self.assertEqual(starts, [plan['previous']])
        stack, plan, candidate, report, path, starts, _ = self.fixture(migration=85, photo_json=True)
        with stack, self.assertRaises(publication.ops.PublishError):
            publication.recover_api(plan, candidate, report, path)
        self.assertEqual(starts, [])

    def test_foreign_listener_prevents_recovery_without_stop_or_start(self):
        stack, plan, candidate, report, path, starts, writes = self.fixture(foreign=True)
        with stack, self.assertRaises(publication.ops.PublishError):
            publication.recover_api(plan, candidate, report, path)
        self.assertEqual(starts, [])
        self.assertEqual(writes, [])


class BackupFailureTests(TestCase):
    def test_remote_local_checksum_mismatch_retains_backups_and_never_deletes_remote_scratch(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'tmp/local-backups').mkdir(parents=True)
            commands = []

            def run(argv, **kwargs):
                commands.append(argv)
                if argv[-2] == 'sha256sum':
                    return SimpleNamespace(returncode=0, stdout='a' * 64 + ' owned-backup.bak\n')
                if 'cp' in argv:
                    Path(argv[-1]).write_bytes(b'different-local-copy')
                    return SimpleNamespace(returncode=0)
                raise AssertionError('Unexpected backup subprocess')

            with patch.object(publication, 'ROOT', root), patch.object(publication, 'MEDIA', root / 'media'), \
                 patch.object(publication, 'measured_space', return_value={'measured': True}), \
                 patch.object(publication, 'private_copy'), patch.object(publication, 'preserved_files', return_value={}), \
                 patch.object(publication, 'sql'), patch.object(publication.subprocess, 'run', side_effect=run):
                with self.assertRaises(publication.ops.PublishError):
                    publication.verified_backup('b' * 32, {})
            self.assertTrue((root / 'tmp/local-backups' / ('used-photos-' + 'b' * 32) / 'Sayman.bak').exists())
            self.assertFalse(any('rm' in argv for argv in commands))


class StartupOwnershipTests(TestCase):
    def test_readiness_failure_stops_its_exact_child_before_recovery_can_start_another(self):
        child = Mock()
        child.poll.return_value = None
        with patch.object(publication.ops, 'listener', return_value=None), patch.object(publication, 'runtime'), \
             patch.object(publication.ops, 'write'), patch.object(publication.ops, 'start_api', return_value=child) as start, \
             patch.object(publication.ops, 'wait_ready', side_effect=RuntimeError('readiness timeout')):
            with self.assertRaisesRegex(RuntimeError, 'readiness timeout'):
                publication.start_selected({}, Path('/synthetic/startup.log'))
        start.assert_called_once()
        child.terminate.assert_called_once()
        child.wait.assert_called_once_with(timeout=15)

    def test_unstopped_startup_is_explicitly_marked_to_prevent_a_second_start(self):
        child = Mock()
        child.poll.return_value = None
        child.wait.side_effect = publication.subprocess.TimeoutExpired('synthetic-owned-child', 15)
        with patch.object(publication.ops, 'listener', return_value=None), patch.object(publication, 'runtime'), \
             patch.object(publication.ops, 'write'), patch.object(publication.ops, 'start_api', return_value=child) as start, \
             patch.object(publication.ops, 'wait_ready', side_effect=RuntimeError('readiness timeout')):
            with self.assertRaises(publication.OwnedStartupIncomplete):
                publication.start_selected({}, Path('/synthetic/startup.log'))
        start.assert_called_once()
        child.terminate.assert_called_once()

    def test_unproved_startup_termination_cannot_allow_a_second_start(self):
        child = Mock()
        child.poll.return_value = None
        child.terminate.side_effect = PermissionError('synthetic termination rejection')
        with patch.object(publication.ops, 'listener', return_value=None), patch.object(publication, 'runtime'), \
             patch.object(publication.ops, 'write'), patch.object(publication.ops, 'start_api', return_value=child) as start, \
             patch.object(publication.ops, 'wait_ready', side_effect=RuntimeError('readiness timeout')):
            with self.assertRaises(publication.OwnedStartupIncomplete):
                publication.start_selected({}, Path('/synthetic/startup.log'))
        start.assert_called_once()
        child.wait.assert_not_called()


class FrontendRecoveryTests(TestCase):
    class Process:
        def __init__(self, pid):
            self.pid, self.running = pid, True

        def poll(self):
            return None if self.running else 0

        def terminate(self):
            self.running = False

        def wait(self, timeout):
            if self.running:
                raise AssertionError('Expected owned candidate to stop before retry')

    def test_min86_recovery_restarts_only_the_candidate_and_never_an_old_ui(self):
        candidate = {'runtimeDirectory': 'tmp/admin-runtime-used-photos-new'}
        writes, starts = [], []

        def start(name):
            starts.append(name)
            return self.Process(21)

        check = Mock(side_effect=[RuntimeError('not ready yet'), [{'status': 200}]])
        result = publication.recover_compatible_frontend('admin', Path('/synthetic/current.json'), candidate,
                    self.Process(20), start, check, lambda path, value: writes.append(deepcopy(value)), lambda _: None)
        self.assertEqual(writes, [candidate])
        self.assertEqual(starts, ['admin'])
        self.assertTrue(result['recoveryHealthy'])
        self.assertTrue(result['passed'])
        self.assertEqual(result['pid'], 21)
        self.assertEqual(result['runtimeDirectory'], candidate['runtimeDirectory'])

    def test_unhealthy_compatible_frontend_stays_selected_and_raises(self):
        candidate = {'runtimeDirectory': 'tmp/storefront-runtime-used-photos-new'}
        writes = []
        with self.assertRaises(publication.ops.PublishError):
            publication.recover_compatible_frontend('storefront', Path('/synthetic/current.json'), candidate,
                self.Process(20), lambda _: self.Process(21), Mock(side_effect=RuntimeError('not ready')),
                lambda path, value: writes.append(deepcopy(value)), lambda _: None)
        self.assertEqual(writes, [candidate])

    def test_failed_initial_frontend_spawn_still_retries_only_the_selected_candidate(self):
        candidate = {'runtimeDirectory': 'tmp/admin-runtime-used-photos-new'}
        writes = []
        result = publication.recover_compatible_frontend('admin', Path('/synthetic/current.json'), candidate,
            None, lambda _: self.Process(21), lambda *_: [{'status': 200}],
            lambda path, value: writes.append(deepcopy(value)), lambda _: None)
        self.assertEqual(writes, [candidate])
        self.assertTrue(result['passed'])


if __name__ == '__main__':
    main(verbosity=2)
