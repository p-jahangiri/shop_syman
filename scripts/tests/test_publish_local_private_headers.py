"""Offline code-only publication faults; no process, socket, SQL or main writes."""
from contextlib import ExitStack
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import TestCase, main
from unittest.mock import Mock, patch

from scripts.tests.script_loader import load_script


publication = load_script('private_header_publication', 'publish-local-private-headers.py')


def previous86():
    return {'api': 'http://127.0.0.1:5080', 'sourceMigrationCount': 86, 'databaseMigrationCount': 86, 'tableCount': 223,
            **{key: True for key in publication.API_FLAGS}, 'usedInspectionPhotosFrontendPromotionPending': False,
            'usedInspectionPhotosMigrationId': publication.photo.MIGRATION, 'runtimeDirectory': 'tmp/api-runtime-current86',
            'previousRuntimeDirectory': 'tmp/api-runtime-old85', 'apiPid': 10, 'localReleaseEvidence': 'artifacts/checks/original.json'}


def snapshot():
    return {'database': 'Sayman', 'atUtc': 'before', 'configuration': {'keys': 'same'},
            'tables': [{'schema': 's', 'table': 't' + str(n), 'count': n, 'sha256': 'same'} for n in range(223)],
            'metadata': [{'schema': 's', 'table': 't' + str(n), 'sha256': 'metadata'} for n in range(223)],
            'histories': [{'schema': 's', 'MigrationId': 'm' + str(n), 'ProductVersion': '10'} for n in range(86)]}


class GuardTests(TestCase):
    def test_every_finalized_marker_and_exact86_shape_are_required(self):
        publication.require_api86(previous86())
        for key, value in [('databaseMigrationCount', 85), ('sourceMigrationCount', 85), ('tableCount', 222),
                           ('usedInspectionPhotosFrontendPromotionPending', True), *[(key, False) for key in publication.API_FLAGS]]:
            state = {**previous86(), key: value}
            with self.subTest(key=key), self.assertRaises(publication.ops.PublishError):
                publication.require_api86(state)

    def test_header_acceptance_must_be_literal_true_not_inherited_or_truthy(self):
        accepted = {'selection': {'backendAcceptance': 'artifacts/checks/new.json'}, 'files': {'artifacts/checks/new.json': 'hash'},
                    'physicalFulfillmentCapacityAccepted': True, 'customerLoginContinuityAccepted': True}
        with patch.object(publication.photo, 'accepted_evidence', return_value=accepted), patch.object(publication.ops, 'sha', return_value='hash'):
            for marker in (None, False, 1, 'true', True):
                with self.subTest(marker=marker), patch.object(publication.ops, 'read', return_value={'privateAdminHeadersAccepted': marker}):
                    if marker is True:
                        self.assertTrue(publication.accepted_evidence('artifacts/checks/new.json', 'artifacts/checks/sql.json')['privateAdminHeadersAccepted'])
                    else:
                        with self.assertRaises(publication.ops.PublishError):
                            publication.accepted_evidence('artifacts/checks/new.json', 'artifacts/checks/sql.json')

    def test_each_raw401_header_is_required(self):
        headers = {'Cache-Control': 'private, no-store', 'X-Robots-Tag': ' noindex, nofollow', 'X-Content-Type-Options': 'nosniff'}
        publication.private_headers(headers)
        for key, value in [('Cache-Control', 'no-store'), ('Cache-Control', 'private'), ('X-Robots-Tag', 'nofollow'), ('X-Content-Type-Options', '')]:
            with self.subTest(key=key, value=value), self.assertRaises(publication.ops.PublishError):
                publication.private_headers({**headers, key: value})

    def test_only_api_product_and_pdb_may_change_not_dependencies_or_file_set(self):
        modules = {('Shop.Api.dll' if n == 0 else 'Shop.Module' + str(n) + '.dll'): 'old' for n in range(14)}
        previous = {**previous86(), 'moduleSha256': modules}
        accepted = {'modules': {**modules, 'Shop.Api.dll': 'new'}}
        original = {**modules, 'Shop.Api.pdb': 'old', 'dependency.dll': 'fixed'}
        new = {**original, 'Shop.Api.dll': 'new', 'Shop.Api.pdb': 'new'}
        with patch.object(publication.photo, 'runtime', return_value=Path('/synthetic/old')):
            for changed in (new, {**new, 'dependency.dll': 'changed'}, {**new, 'extra.json': 'new'}):
                with self.subTest(changed=set(changed)), patch.object(publication.photo, 'tree', side_effect=[original, changed]):
                    if changed == new:
                        self.assertEqual(publication.package_delta(previous, accepted)['changedFiles'], ['Shop.Api.dll', 'Shop.Api.pdb'])
                    else:
                        with self.assertRaises(publication.ops.PublishError):
                            publication.package_delta(previous, accepted)
            with patch.object(publication.photo, 'tree') as trees, self.assertRaises(publication.ops.PublishError):
                publication.package_delta(previous, {'modules': {**accepted['modules'], 'Shop.Module1.dll': 'changed'}})
            trees.assert_not_called()

    def test_candidate_replaces_inherited85_pointer_with_direct_previous86_runtime(self):
        plan = {'previous': previous86(), 'accepted': {'privateAdminHeadersAccepted': True, 'modules': {},
                'unitPassed': 1430, 'fullSqlPassed': 984}}
        with patch.object(publication.ops, 'sha', return_value='hash'):
            state = publication.state86(plan, publication.ROOT / 'tmp/api-runtime-candidate', publication.CHECKS / 'manifest.json', publication.CHECKS / 'release.json')
        self.assertEqual(state['previousRuntimeDirectory'], 'tmp/api-runtime-current86')
        self.assertEqual((state['codeOnly'], state['newMigrations'], state['newTables']), (True, 0, 0))
        self.assertFalse(state['usedInspectionPhotosFrontendPromotionPending'])
        self.assertFalse(state['privateAdminHeadersAccepted'])
        self.assertTrue(all(state[key] is True for key in publication.API_FLAGS))


class PreservationTests(TestCase):
    def test_all223_rows_metadata_histories_and_configuration_are_compared_without_exclusions(self):
        before = snapshot()
        migrations = {(row['schema'], row['MigrationId']) for row in before['histories']}
        with patch.object(publication.photo, 'source_migrations', return_value=migrations):
            after = deepcopy(before)
            after['atUtc'] = 'later'
            publication.unchanged_database(before, after)
            for section, key in [('tables', 'sha256'), ('metadata', 'sha256'), ('histories', 'ProductVersion')]:
                after = deepcopy(before)
                after[section][0][key] = 'changed'
                with self.subTest(section=section), self.assertRaises(publication.ops.PublishError):
                    publication.unchanged_database(before, after)
            after = deepcopy(before)
            after['configuration']['keys'] = 'changed'
            with self.assertRaises(publication.ops.PublishError):
                publication.unchanged_database(before, after)

    def test_duplicate_or_missing_tables_cannot_hide_a_changed_identity_table(self):
        before = snapshot()
        migrations = {(row['schema'], row['MigrationId']) for row in before['histories']}
        with patch.object(publication.photo, 'source_migrations', return_value=migrations):
            for section in ('tables', 'metadata'):
                after = deepcopy(before)
                after[section][-1] = deepcopy(after[section][0])
                with self.subTest(section=section), self.assertRaises(publication.ops.PublishError):
                    publication.unchanged_database(before, after)

    def test_aggregate_retains_original_schema_backup_and_finalization_evidence(self):
        original = {'schemaReleaseEvidence': {'path': 'original-migration.json', 'sha256': 'original'},
                    'usedInspectionPhotosFinalizationEvidence': 'original-finalization.json',
                    'componentReleaseEvidence': {'api': 'old.json', 'storefront': 'front.json', 'admin': 'admin.json'}}
        with patch.object(publication.ops, 'sha', return_value='new-report'):
            updated = publication.aggregate_for({'aggregate': deepcopy(original)}, publication.CHECKS / 'new.json')
        self.assertEqual(updated['schemaReleaseEvidence'], original['schemaReleaseEvidence'])
        self.assertEqual(updated['usedInspectionPhotosFinalizationEvidence'], original['usedInspectionPhotosFinalizationEvidence'])
        self.assertEqual(updated['componentReleaseEvidence']['storefront'], 'front.json')
        self.assertNotEqual(updated['componentReleaseEvidence']['api'], original['componentReleaseEvidence']['api'])
        self.assertNotIn('backup', updated)


class RecoveryTests(TestCase):
    def fixture(self, listener=None, current=None):
        plan = {'previous': previous86(), 'process': {'pid': 10, 'started': 'original'}, 'runId': 'a' * 32}
        candidate = {**previous86(), 'runtimeDirectory': 'tmp/api-runtime-candidate86', 'apiPid': 20}
        starts, writes, stops = [], [], []
        stack = ExitStack()
        stack.enter_context(patch.object(publication.photo, 'shape', return_value={'migrationCount': 86, 'tableCount': 223}))
        stack.enter_context(patch.object(publication.ops, 'listener', return_value=listener))
        stack.enter_context(patch.object(publication.ops, 'read', return_value=current or candidate))
        stack.enter_context(patch.object(publication.ops, 'write', side_effect=lambda path, value, **kw: writes.append((path, deepcopy(value)))))
        stack.enter_context(patch.object(publication.photo, 'owned_process', return_value={'pid': listener, 'started': 'candidate'}))
        stack.enter_context(patch.object(publication.photo, 'stop_owned', side_effect=lambda state, identity: stops.append(state)))
        stack.enter_context(patch.object(publication.photo, 'start_selected', side_effect=lambda state, log: (starts.append(deepcopy(state)) or SimpleNamespace(pid=30), {**state, 'apiPid': 30})))
        # Any forgotten real boundary fails before a process, SQL or socket call.
        for module, name in ((publication.photo, 'sql'), (publication.photo, 'payload'), (publication.photo.subprocess, 'run'),
                             (publication.photo.subprocess, 'Popen'), (publication.photo.os, 'kill'), (publication.ops.HTTP, 'open')):
            stack.enter_context(patch.object(module, name, side_effect=AssertionError('Live side effect forbidden in offline tests')))
        return stack, plan, candidate, starts, writes, stops

    def test_empty_listener_recovers_only_direct_previous86_never_its85_pointer(self):
        stack, plan, candidate, starts, writes, stops = self.fixture()
        with stack:
            report = {}
            publication.recover_previous86(plan, candidate, report, publication.CHECKS / 'release.json')
        self.assertEqual([value['runtimeDirectory'] for value in starts], ['tmp/api-runtime-current86'])
        self.assertEqual(starts[0]['databaseMigrationCount'], 86)
        self.assertTrue(report['recoveryHealthy'])
        self.assertFalse(report['sqlDowngradedOrRestored'])
        self.assertEqual(stops, [])

    def test_prior85_is_rejected_before_any_recovery_write_or_start(self):
        stack, plan, candidate, starts, writes, stops = self.fixture()
        plan['previous']['databaseMigrationCount'] = 85
        with stack, self.assertRaises(publication.ops.PublishError):
            publication.recover_previous86(plan, candidate, {}, publication.CHECKS / 'release.json')
        self.assertEqual((starts, writes, stops), ([], [], []))

    def test_foreign_descriptor_listener_is_never_stopped_or_overwritten(self):
        stack, plan, candidate, starts, writes, stops = self.fixture(999, {'runtimeDirectory': 'tmp/foreign-api', 'apiPid': 999})
        with stack, self.assertRaises(publication.ops.PublishError):
            publication.recover_previous86(plan, candidate, {}, publication.CHECKS / 'release.json')
        self.assertEqual((starts, writes, stops), ([], [], []))

    def test_same_candidate_name_cannot_authorize_killing_a_foreign_process(self):
        stack, plan, candidate, starts, writes, stops = self.fixture(999)
        with stack, patch.object(publication.photo, 'owned_process', side_effect=publication.ops.PublishError('foreign identity')), self.assertRaises(publication.ops.PublishError):
            publication.recover_previous86(plan, candidate, {}, publication.CHECKS / 'release.json')
        self.assertEqual((starts, writes, stops), ([], [], []))

    def test_foreign_descriptor_without_listener_is_preserved(self):
        stack, plan, candidate, starts, writes, stops = self.fixture(None, {'runtimeDirectory': 'tmp/foreign-api', 'apiPid': None})
        with stack, self.assertRaises(publication.ops.PublishError):
            publication.recover_previous86(plan, candidate, {}, publication.CHECKS / 'release.json')
        self.assertEqual((starts, writes, stops), ([], [], []))

    def test_owned_candidate_is_stopped_before_exact_previous86_is_started(self):
        stack, plan, candidate, starts, writes, stops = self.fixture(20)
        with stack, patch.object(publication.ops, 'listener', side_effect=[20, None]):
            publication.recover_previous86(plan, candidate, {}, publication.CHECKS / 'release.json', {'pid': 20, 'started': 'candidate'})
        self.assertEqual([value['runtimeDirectory'] for value in stops], ['tmp/api-runtime-candidate86'])
        self.assertEqual([value['runtimeDirectory'] for value in starts], ['tmp/api-runtime-current86'])

    def test_same_runtime_replacement_child_is_preserved_when_start_fingerprint_changes(self):
        for expected in (None, {'pid': 20, 'started': 'old-start'}):
            stack, plan, candidate, starts, writes, stops = self.fixture(20)
            with stack, self.subTest(expected=expected), self.assertRaises(publication.ops.PublishError):
                publication.recover_previous86(plan, candidate, {}, publication.CHECKS / 'release.json', expected)
            self.assertEqual((starts, writes, stops), ([], [], []))

    def test_apply_incomplete_startup_does_not_try_a_second_child_or_recovery(self):
        with TemporaryDirectory() as temporary, ExitStack() as stack:
            root = Path(temporary)
            (root / 'tmp').mkdir()
            checks = root / 'checks'
            checks.mkdir()
            plan = {'runId': 'a' * 32, 'previous': previous86(), 'process': {'pid': 10}, 'package': {'files': {'Shop.Api.dll': 'hash'}},
                    'schemaEvidence': {'schemaReleaseEvidence': {'path': 'original', 'sha256': 'hash'}}, 'helpers': {},
                    'frontends': {}, 'preservedFiles': {}, 'accepted': {'frozenRecord': {},
                        'selection': {'backendAcceptance': 'backend', 'sqlProof': 'sql'}, 'files': {'backend': 'hash', 'sql': 'hash'}}}
            for name, value in [('ROOT', root), ('CHECKS', checks)]:
                stack.enter_context(patch.object(publication, name, value))
            stack.enter_context(patch.object(publication.photo, 'relative', side_effect=lambda path: str(path.relative_to(root))))
            stack.enter_context(patch.object(publication, 'validate_plan'))
            stack.enter_context(patch.object(publication.shutil, 'copytree'))
            stack.enter_context(patch.object(publication.photo, 'tree', return_value=plan['package']['files']))
            stack.enter_context(patch.object(publication, 'state86', return_value={'runtimeDirectory': 'tmp/candidate'}))
            stack.enter_context(patch.object(publication.ops, 'write'))
            stack.enter_context(patch.object(publication.ops, 'sha', return_value='hash'))
            stack.enter_context(patch.object(publication.photo, 'stop_owned'))
            stack.enter_context(patch.object(publication.photo, 'database_snapshot', return_value=snapshot()))
            stack.enter_context(patch.object(publication, 'valid_snapshot'))
            stack.enter_context(patch.object(publication.photo, 'preserved_files', return_value={}))
            stack.enter_context(patch.object(publication, 'finalized_frontends', return_value={}))
            start = stack.enter_context(patch.object(publication.photo, 'start_selected', side_effect=publication.photo.OwnedStartupIncomplete('still alive')))
            recover = stack.enter_context(patch.object(publication, 'recover_previous86'))
            smoke = stack.enter_context(patch.object(publication, 'smoke', side_effect=AssertionError('No HTTP after incomplete startup')))
            with self.assertRaises(publication.photo.OwnedStartupIncomplete):
                publication.apply(plan)
            start.assert_called_once()
            recover.assert_not_called()
            smoke.assert_not_called()

    def test_failed_commit_does_not_overwrite_unrelated_aggregate(self):
        original = {'schemaReleaseEvidence': {'path': 'original'}, 'componentReleaseEvidence': {'api': 'old', 'admin': 'old-admin'}}
        foreign = {**original, 'componentReleaseEvidence': {'api': 'foreign', 'admin': 'new-admin'}}
        with patch.object(publication.ops, 'read', return_value=foreign), patch.object(publication.ops, 'write') as write:
            with self.assertRaises(publication.ops.PublishError):
                publication.reconcile_failed_aggregate({'aggregate': original}, publication.CHECKS / 'ours.json')
        write.assert_not_called()


if __name__ == '__main__':
    main()
