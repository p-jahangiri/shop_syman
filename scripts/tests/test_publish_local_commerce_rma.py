"""Offline synthetic cutover faults only. No SQL, service, build or real prepare."""
from collections import Counter
from contextlib import ExitStack, contextmanager
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import TestCase, main
from unittest.mock import Mock, patch
import hashlib
import json

from scripts.tests.script_loader import load_script


publication = load_script('commerce_rma_publication', 'publish-local-commerce-rma.py')


def column(name='Id', ordinal=1, **values):
    return {'name': name, 'column_id': ordinal, 'system_type_id': 56, 'user_type_id': 56,
            'max_length': 4, 'precision': 10, 'scale': 0, 'is_nullable': False,
            'collation_name': None, 'is_identity': False, 'is_computed': False,
            'computedDefinition': None, 'defaultDefinition': None, **values}


def check(name, definition='old'):
    return {'name': name, 'definition': definition, 'is_disabled': False, 'is_not_trusted': False}


def metadata(name):
    schema, table = name.split('.')
    return {'schema': schema, 'table': table, 'columns': [column()],
            'indexes': [{'name': 'PK_' + table, 'is_unique': True}], 'foreignKeys': [], 'checks': []}


def snapshots():
    names = ['sales.Orders', 'sales.CheckoutChargePolicies', 'sales.CheckoutQuotes', 'sales.__EFMigrationsHistory']
    names += ['synthetic.T' + str(n) for n in range(219)]
    old_metadata = [metadata(name) for name in names]
    mapped = publication.table_map(old_metadata)
    for name in ('sales.CheckoutChargePolicies', 'sales.CheckoutQuotes'):
        mapped[name]['columns'].append(column('TaxMode', 2, system_type_id=167, user_type_id=167, max_length=16, precision=0))
    mapped['sales.CheckoutChargePolicies']['checks'] = [check('CK_ChargePolicy_Shipping'), check('CK_ChargePolicy_Tax')]
    mapped['sales.Orders']['columns'].append(column('TaxRial', 2, system_type_id=127, user_type_id=127, max_length=8, precision=19))
    mapped['sales.Orders']['checks'] = [check('CK_Order_Amounts'), check('CK_Order_Unrelated')]
    before = {'database': 'Sayman', 'tables': [{'schema': name.split('.')[0], 'table': name.split('.')[1], 'count': 3, 'sha256': 'original-' + name} for name in names],
              'metadata': old_metadata, 'histories': [{'schema': 'identity', 'MigrationId': 'old' + str(n), 'ProductVersion': '10.0.0'} for n in range(86)],
              'configuration': {'keys': 'unchanged', 'environment': 'unchanged'}, 'legacyUnknownTaxRows': 0}
    after = deepcopy(before); after_map = publication.table_map(after['metadata'])
    for name in ('sales.CheckoutChargePolicies', 'sales.CheckoutQuotes'):
        after_map[name]['columns'][1]['max_length'] = 24
    after_map['sales.Orders']['columns'][1]['is_nullable'] = True
    after_map['sales.Orders']['columns'].append(column('TaxBreakdownKnown', 3, system_type_id=104, user_type_id=104, max_length=1, precision=1, defaultDefinition='(CONVERT([bit],(1)))'))
    for item in after_map['sales.CheckoutChargePolicies']['checks']: item['definition'] = 'accepted new ' + item['name']
    after_map['sales.Orders']['checks'][0]['definition'] = 'accepted new amounts'
    after_map['sales.Orders']['checks'].append(check('CK_Order_TaxDisclosure', 'accepted bidirectional disclosure'))
    for name in sorted(publication.NEW_TABLES):
        schema, table = name.split('.'); after['tables'].append({'schema': schema, 'table': table, 'count': 0, 'sha256': 'empty'})
        after['metadata'].append(metadata(name))
    publication.table_map(after['tables'])['sales.__EFMigrationsHistory'].update(count=5, sha256='two new histories')
    after['histories'] += [{'schema': schema, 'MigrationId': name, 'ProductVersion': '10.0.0'} for schema, name in sorted(publication.MIGRATIONS)]
    contract = {'schemaVersion': 1, 'status': 'disposable-schema88-accepted', 'frozen': {'source': 'frozen'}, 'sourceMigrationCount': 88,
                'changedTablesMetadata': [deepcopy(after_map[name]) for name in sorted(publication.CHANGED_TABLES)],
                'newTablesMetadata': [deepcopy(publication.table_map(after['metadata'])[name]) for name in sorted(publication.NEW_TABLES)]}
    return before, after, contract


class DatabasePreservationTests(TestCase):
    def test_empty_fk_and_check_arrays_are_explicit_metadata_and_omission_is_not_accepted(self):
        # Real SQL capture must preserve these arrays even for tables with no
        # constraints. An omitted key is different from an empty collection.
        self.assertEqual(publication.METADATA_SQL.count('JSON_QUERY(COALESCE('), 4)
        self.assertEqual(publication.METADATA_SQL.count(",N'[]'))"), 4)
        before, after, contract = snapshots()
        empty = publication.table_map(after['metadata'])['sales.CheckoutQuotes']
        self.assertEqual(empty['foreignKeys'], []); self.assertEqual(empty['checks'], [])
        publication.preserved_database(before, after, contract)
        for key in ('foreignKeys', 'checks'):
            omitted = deepcopy(after); publication.table_map(omitted['metadata'])['sales.CheckoutQuotes'].pop(key)
            with self.subTest(key=key), self.assertRaises((publication.ops.PublishError, KeyError)):
                publication.preserved_database(before, omitted, contract)

    def test_only_precise_additive_schema_delta_preserves_all_original_projected_data(self):
        before, after, contract = snapshots()
        publication.validate_contract(contract, {'source': 'frozen'})
        publication.preserved_database(before, after, contract)

    def test_original_order_values_rowversions_json_and_unrelated_tables_cannot_be_excluded(self):
        for name in ('sales.Orders', 'sales.CheckoutQuotes', 'sales.CheckoutChargePolicies', 'synthetic.T17'):
            before, after, contract = snapshots(); publication.table_map(after['tables'])[name]['sha256'] = 'changed-old-field-or-rowversion'
            with self.subTest(table=name), self.assertRaises(publication.ops.PublishError): publication.preserved_database(before, after, contract)

    def test_rma_tables_must_be_exactly_six_and_initially_empty(self):
        before, after, contract = snapshots(); after['tables'][-1]['count'] = 1
        with self.assertRaises(publication.ops.PublishError): publication.preserved_database(before, after, contract)
        before, after, contract = snapshots(); after['tables'].pop()
        with self.assertRaises(publication.ops.PublishError): publication.preserved_database(before, after, contract)

    def test_old_history_versions_and_configuration_remain_exact(self):
        for key in ('history', 'configuration', 'knownFlag'):
            before, after, contract = snapshots()
            if key == 'history': after['histories'][0]['ProductVersion'] = 'changed'
            elif key == 'configuration': after['configuration']['keys'] = 'changed'
            else: after['legacyUnknownTaxRows'] = 1
            with self.subTest(key=key), self.assertRaises(publication.ops.PublishError): publication.preserved_database(before, after, contract)

    def test_matching_forged_contract_cannot_expand_the_column_allowlist(self):
        before, after, contract = snapshots()
        publication.table_map(after['metadata'])['sales.Orders']['columns'][0]['is_nullable'] = True
        publication.table_map(contract['changedTablesMetadata'])['sales.Orders']['columns'][0]['is_nullable'] = True
        with self.assertRaises(publication.ops.PublishError): publication.preserved_database(before, after, contract)

    def test_default_false_is_rejected_even_when_contract_bytes_agree(self):
        before, after, contract = snapshots()
        for rows in (after['metadata'], contract['changedTablesMetadata']): publication.table_map(rows)['sales.Orders']['columns'][-1]['defaultDefinition'] = '((0))'
        with self.assertRaises(publication.ops.PublishError): publication.preserved_database(before, after, contract)

    def test_indexes_foreign_keys_unrelated_checks_and_trust_cannot_change(self):
        for key in ('indexes', 'foreignKeys', 'unrelatedCheck', 'trust'):
            before, after, contract = snapshots()
            for rows in (after['metadata'], contract['changedTablesMetadata']):
                order = publication.table_map(rows)['sales.Orders']
                if key in ('indexes', 'foreignKeys'): order[key].append({'unapproved': True})
                elif key == 'unrelatedCheck': order['checks'][1]['definition'] = 'weakened'
                else: order['checks'][0]['is_not_trusted'] = True
            with self.subTest(key=key), self.assertRaises(publication.ops.PublishError): publication.preserved_database(before, after, contract)

    def test_duplicate_or_missing_metadata_cannot_hide_an_original_table(self):
        before, after, contract = snapshots(); after['metadata'].append(deepcopy(after['metadata'][0]))
        with self.assertRaises(publication.ops.PublishError): publication.preserved_database(before, after, contract)

    def test_schema_contract_is_source_bound_and_has_only_exact_changed_and_new_tables(self):
        _, _, contract = snapshots()
        for change in ('source', 'count', 'tables'):
            altered = deepcopy(contract)
            if change == 'source': altered['frozen'] = {'source': 'other'}
            elif change == 'count': altered['sourceMigrationCount'] = 87
            else: altered['newTablesMetadata'].pop()
            with self.subTest(change=change), self.assertRaises(publication.ops.PublishError): publication.validate_contract(altered, {'source': 'frozen'})


class EvidenceBoundaryTests(TestCase):
    def test_schema_changing_api_explicitly_overrides_old_code_only_release_fields(self):
        accepted = {'modules': {}, 'unitPassed': 1501, 'fullSqlPassed': 1021}
        candidate = {'codeOnly': True, 'newMigrations': 0, 'newTables': 0, **publication.api_release_fields(accepted)}
        self.assertFalse(candidate['codeOnly']); self.assertEqual(candidate['newMigrations'], 2); self.assertEqual(candidate['newTables'], 6)

    def test_counts_are_actual_positive_integers_never_a_truthy_marker_or_a_hardcoded_release_total(self):
        for count in (1, 1427, 2001): self.assertEqual(publication.positive_count(count), count)
        for invalid in (0, -1, True, '2001', None):
            with self.subTest(invalid=invalid), self.assertRaises(publication.ops.PublishError): publication.positive_count(invalid)

    def test_selection_rejects_path_escape_and_an_unowned_frontend_build(self):
        self.assertEqual(publication.selection()['schemaContract'], publication.DEFAULTS['schemaContract'])
        for values in ({'schemaContract': '/tmp/schema.json'}, {'sqlProof': 'artifacts/checks/../../tmp/x.json'}, {'frontendBuild': 'artifacts/checks/build.json'}):
            with self.subTest(values=values), self.assertRaises((publication.ops.PublishError, publication.verify.VerificationError)): publication.selection(values)

    def test_old86_runtime_never_masquerades_as_compatible_with87_or88_count(self):
        with patch.object(publication.verify, 'manifest') as manifest:
            for migration, tables in ((87, 223), (88, 223), (86, 229)):
                with self.subTest(migration=migration), self.assertRaises(publication.ops.PublishError): publication.runtime('api', {'api': publication.URLS['api'], 'sourceMigrationCount': migration, 'databaseMigrationCount': migration, 'tableCount': tables})
            manifest.assert_not_called()


class CopyAndPreflightTests(TestCase):
    def test_each_new_frontend_projection_is_compared_before_extra_old_assets_are_retained(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary); source = root / 'source'; source.mkdir(); (source / 'new.js').write_bytes(b'accepted-new')
            wanted = {'files': publication.photo.tree(source)}; target = root / 'target'
            publication.copy_projection(source, target, wanted)
            self.assertEqual(publication.photo.tree(target), wanted['files'])
            old = root / 'old'; old.mkdir(); (old / 'old.js').write_bytes(b'accepted-old')
            retained = publication.retain(old, target)
            self.assertEqual(retained, publication.photo.tree(old)); self.assertEqual(set(publication.photo.tree(target)), {'new.js', 'old.js'})

    def test_corrupt_or_missing_copied_bytes_are_never_blessed_by_a_new_manifest(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary); source = root / 'source'; source.mkdir(); (source / 'first.js').write_bytes(b'first'); (source / 'second.js').write_bytes(b'second')
            wanted = {'files': publication.photo.tree(source)}
            for fault in ('corrupt', 'missing'):
                target = root / fault
                def bad_copy(*_, **__):
                    target.mkdir(); (target / 'first.js').write_bytes(b'corrupt' if fault == 'corrupt' else b'first')
                    if fault == 'corrupt': (target / 'second.js').write_bytes(b'second')
                with self.subTest(fault=fault), patch.object(publication.shutil, 'copytree', side_effect=bad_copy), self.assertRaises(publication.ops.PublishError):
                    publication.copy_projection(source, target, wanted)

    def test_all_six_exact_repair_predicates_must_have_zero_candidates(self):
        zero = {name: 0 for name in ('brands', 'translations', 'variants', 'options', 'productValues', 'variantValues')}
        with patch.object(publication, 'listener', return_value=None), patch.object(publication, 'payload', return_value=zero) as query:
            self.assertFalse(publication.search_repair_ready()['repairWillWrite']); self.assertEqual(query.call_args.args[0], publication.SEARCH_REPAIR_SQL)
        self.assertEqual(publication.SEARCH_REPAIR_SQL.count('COUNT_BIG(*)'), 6)
        self.assertIn('[ProductTranslation]', publication.SEARCH_REPAIR_SQL); self.assertIn('[ProductAttributeValue]', publication.SEARCH_REPAIR_SQL); self.assertIn('[VariantAttributeValue]', publication.SEARCH_REPAIR_SQL)
        self.assertNotIn('LEN(', publication.SEARCH_REPAIR_SQL); self.assertNotIn('DATALENGTH', publication.SEARCH_REPAIR_SQL)
        for name in zero:
            with self.subTest(candidate=name), patch.object(publication, 'listener', return_value=None), patch.object(publication, 'payload', return_value={**zero, name: 1}), self.assertRaises(publication.ops.PublishError): publication.search_repair_ready()

    def test_search_preflight_rejects_missing_counts_and_any_live_writer_without_attempting_repair(self):
        with patch.object(publication, 'listener', return_value=None), patch.object(publication, 'payload', return_value={'brands': 0}), self.assertRaises(publication.ops.PublishError): publication.search_repair_ready()
        with patch.object(publication, 'listener', return_value=999), patch.object(publication, 'payload') as query:
            with self.assertRaises(publication.ops.PublishError): publication.search_repair_ready()
            query.assert_not_called()

    def test_pre_command86_recovery_has_no_metadata_or_history_allowlist(self):
        before = snapshots()[0]; publication.unchanged86(before, deepcopy(before))
        for kind in ('metadata', 'history', 'keys'):
            changed = deepcopy(before)
            if kind == 'metadata': changed['metadata'][0]['indexes'].append({'unapproved': True})
            elif kind == 'history': changed['histories'][0]['ProductVersion'] = 'other'
            else: changed['configuration']['keys'] = 'other'
            with self.subTest(kind=kind), self.assertRaises(publication.ops.PublishError): publication.unchanged86(before, changed)


class StartupTests(TestCase):
    def test_foreign_listener_prevents_descriptor_write_or_another_child(self):
        with patch.object(publication, 'listener', return_value=999), patch.object(publication.ops, 'write') as write, patch.object(publication.subprocess, 'Popen') as start:
            with self.assertRaises(publication.ops.PublishError): publication.start_selected('api', {}, Path('/synthetic/log'))
        write.assert_not_called(); start.assert_not_called()

    def test_unproved_own_child_termination_cannot_trigger_a_second_start(self):
        child = Mock(); child.poll.return_value = None; child.wait.side_effect = publication.subprocess.TimeoutExpired('owned-child', 15)
        with TemporaryDirectory() as temporary, patch.object(publication, 'listener', return_value=None), patch.object(publication, 'runtime'), \
             patch.object(publication.ops, 'write'), patch.object(publication.ops, 'read', return_value={}), \
             patch.object(publication, 'smoke', side_effect=RuntimeError('unready')), patch.object(publication.time, 'sleep'), \
             patch.object(publication.subprocess, 'Popen', return_value=child) as start:
            with self.assertRaises(publication.OwnedStartupIncomplete): publication.start_selected('api', {}, Path(temporary) / 'log')
        self.assertEqual(start.call_count, 1); child.terminate.assert_called_once(); child.wait.assert_called_once_with(timeout=15)


class ApplyTests(TestCase):
    def cutover(self, temporary, fault=None):
        root = Path(temporary); checks = root / 'checks'; checks.mkdir(); descriptors = {name: root / (name + '.json') for name in publication.PORTS}
        previous = {name: {'runtimeDirectory': 'tmp/old-' + name, 'sourceMigrationCount': 86, 'databaseMigrationCount': 86, 'tableCount': 223} for name in publication.PORTS}
        candidates = {name: {'runtimeDirectory': 'tmp/new-' + name, 'sourceMigrationCount': 88, 'databaseMigrationCount': 88, 'tableCount': 229} for name in publication.PORTS}
        accepted = {'selection': {}, 'files': {}, 'frontendBuild': {}, 'schemaContract': {}, 'unitPassed': 1501, 'targetedSqlPassed': 123, 'fullSqlPassed': 1021}
        processes = {name: {'pid': 10 + index, 'command': 'owned-' + name, 'started': 'fixed'} for index, name in enumerate(publication.PORTS)}
        plan = {'schemaVersion': 1, 'kind': publication.KIND, 'runId': 'a' * 32, 'accepted': accepted, 'helpers': {}, 'frontendInputs': {}, 'apiFiles': {},
                'previous': previous, 'processes': processes, 'descriptorSha256': {n: 'same' for n in publication.PORTS}, 'aggregate': {'databaseMigrationCount': 86}, 'aggregateSha256': 'same', 'preservedFiles': {}}
        aggregate_path = root / 'aggregate.json'; records = {aggregate_path: deepcopy(plan['aggregate']), **{descriptors[n]: deepcopy(s) for n, s in previous.items()}}
        active = {name: row['pid'] for name, row in processes.items()}; events = []; phase = {'migrated': False}; attempted = set(); snapshot_calls = []
        original_snapshot = snapshots()[0]
        def process(name, state):
            expected = state.get('apiPid', state.get('pid', state.get('adminPid')))
            if expected is not None and expected != active[name]: raise publication.ops.PublishError('foreign replacement listener')
            return {**processes[name], 'pid': active[name]}
        def stop(name, state, expected):
            events.append('stop:' + name); active.pop(name)
        def backup(*_):
            events.append('backup')
            if fault in ('backup', 'backup_changed', 'backup_foreign'):
                if fault == 'backup_foreign': active['api'] = 999
                raise RuntimeError('synthetic backup failure')
            return {'passed': True}
        def run(argv, **_):
            self.assertEqual(argv[-1], '--migrate'); events.append('migrate')
            if fault == 'migration': raise RuntimeError('synthetic migration invocation failure')
            phase['migrated'] = True
            return SimpleNamespace(returncode=0)
        def start(name, state, log):
            events.append('start:' + name)
            if fault == 'storefront' and name == 'storefront' and name not in attempted:
                attempted.add(name); raise RuntimeError('synthetic startup failure; exact child stopped')
            selected = deepcopy(state); selected['apiPid' if name == 'api' else 'pid' if name == 'storefront' else 'adminPid'] = 30 + list(publication.PORTS).index(name)
            active[name] = selected.get('apiPid', selected.get('pid', selected.get('adminPid'))); records[descriptors[name]] = selected
            return selected, [{'passed': True}], process(name, selected)
        def snapshot_read():
            snapshot_calls.append(True); value = deepcopy(original_snapshot)
            if fault == 'backup_changed' and len(snapshot_calls) > 1: value['tables'][0]['sha256'] = 'changed-after-backup-failure'
            if fault == 'pid_swap' and len(snapshot_calls) == 3: active['api'] = 999
            if fault == 'pid_reuse' and len(snapshot_calls) == 3: processes['api']['started'] = 'different-start-time'
            return value
        def write(path, value, **_): records[path] = deepcopy(value)
        stack = ExitStack()
        for key, value in (('ROOT', root), ('CHECKS', checks), ('AGGREGATE', aggregate_path), ('DESCRIPTORS', descriptors)): stack.enter_context(patch.object(publication, key, value))
        for key, value in (('accepted_evidence', accepted), ('helper_hashes', {}), ('build_inputs', {}), ('api_environment', {}), ('search_repair_ready', {'readOnly': True, 'repairWillWrite': False})):
            stack.enter_context(patch.object(publication, key, return_value=value))
        stack.enter_context(patch.object(publication, 'database_snapshot', side_effect=snapshot_read))
        stack.enter_context(patch.object(publication.photo, 'tree', return_value={})); stack.enter_context(patch.object(publication.photo, 'preserved_files', return_value={}))
        stack.enter_context(patch.object(publication.photo, 'preserve_existing_files')); stack.enter_context(patch.object(publication, 'pending')); stack.enter_context(patch.object(publication, 'preserved_database'))
        stack.enter_context(patch.object(publication, 'package', return_value=candidates)); stack.enter_context(patch.object(publication, 'runtime'))
        stack.enter_context(patch.object(publication.ops, 'sha', return_value='same')); stack.enter_context(patch.object(publication.ops, 'write', side_effect=write)); stack.enter_context(patch.object(publication.ops, 'read', side_effect=lambda path: deepcopy(records[path])))
        stack.enter_context(patch.object(publication, 'owned_process', side_effect=process)); stack.enter_context(patch.object(publication, 'stop_owned', side_effect=stop))
        stack.enter_context(patch.object(publication, 'listener', side_effect=lambda name: active.get(name))); stack.enter_context(patch.object(publication, 'verified_backup', side_effect=backup))
        stack.enter_context(patch.object(publication.subprocess, 'run', side_effect=run)); stack.enter_context(patch.object(publication, 'start_selected', side_effect=start)); stack.enter_context(patch.object(publication, 'smoke', return_value=[]))
        stack.enter_context(patch.object(publication, 'shape', side_effect=lambda: {'migrationCount': 88, 'tableCount': 229} if phase['migrated'] else {'migrationCount': 86, 'tableCount': 223}))
        for module, name in ((publication, 'sql'), (publication, 'payload'), (publication.subprocess, 'Popen'), (publication.os, 'kill')):
            stack.enter_context(patch.object(module, name, side_effect=AssertionError('Real side effect forbidden in offline test')))
        return stack, plan, records, aggregate_path, events

    def test_all_three_writers_stop_before_backup_migration_and_immediate_min88_frontends(self):
        with TemporaryDirectory() as temporary:
            stack, plan, records, aggregate, events = self.cutover(temporary)
            with stack: report = publication.apply(plan)
            self.assertEqual(events, ['stop:storefront', 'stop:admin', 'stop:api', 'backup', 'migrate', 'start:api', 'start:storefront', 'start:admin'])
            self.assertTrue(report['passed']); self.assertTrue(report['bothCompatibleFrontendsPromoted']); self.assertFalse(report['mainSeedPerformed']); self.assertFalse(report['sqlDowngradedOrRestored'])
            self.assertEqual(records[aggregate]['databaseMigrationCount'], 88); self.assertTrue(records[aggregate]['policyConfigurationPending']['shippingTaxPolicy'])

    def test_backup_failure_recovers_previous86_only_after_exact_unchanged_stopped_proof(self):
        with TemporaryDirectory() as temporary:
            stack, plan, records, _, events = self.cutover(temporary, 'backup')
            with stack, self.assertRaisesRegex(RuntimeError, 'backup failure'): publication.apply(plan)
            self.assertEqual(events, ['stop:storefront', 'stop:admin', 'stop:api', 'backup', 'start:api', 'start:storefront', 'start:admin'])
            report = next(value for path, value in records.items() if path.name.endswith('-main-release.json'))
            self.assertFalse(report['passed']); self.assertEqual(report['recovery'], 'previous86-before-migration-command-only'); self.assertFalse(report['sqlDowngradedOrRestored']); self.assertFalse(report['migrationCommandStarted'])
            for name in publication.PORTS: self.assertEqual(records[Path(temporary) / (name + '.json')]['runtimeDirectory'], 'tmp/old-' + name)

    def test_backup_failure_with_changed_data_or_foreign_listener_never_restarts_previous86(self):
        for fault in ('backup_changed', 'backup_foreign'):
            with self.subTest(fault=fault), TemporaryDirectory() as temporary:
                stack, plan, records, _, events = self.cutover(temporary, fault)
                with stack, self.assertRaisesRegex(RuntimeError, 'backup failure'): publication.apply(plan)
                self.assertEqual(events, ['stop:storefront', 'stop:admin', 'stop:api', 'backup'])
                report = next(value for path, value in records.items() if path.name.endswith('-main-release.json'))
                self.assertTrue(report['recoveryIncomplete'])

    def test_any_migration_invocation_forbids86_recovery_even_if_current_shape_is_still86(self):
        with TemporaryDirectory() as temporary:
            stack, plan, records, _, events = self.cutover(temporary, 'migration')
            with stack, self.assertRaisesRegex(RuntimeError, 'migration invocation'): publication.apply(plan)
            self.assertEqual(events, ['stop:storefront', 'stop:admin', 'stop:api', 'backup', 'migrate'])
            report = next(value for path, value in records.items() if path.name.endswith('-main-release.json'))
            self.assertTrue(report['migrationCommandStarted']); self.assertTrue(report['recoveryIncomplete'])

    def test_final_pid_listener_or_start_time_change_cannot_report_a_passed_cutover(self):
        for fault in ('pid_swap', 'pid_reuse'):
            with self.subTest(fault=fault), TemporaryDirectory() as temporary:
                stack, plan, records, _, _ = self.cutover(temporary, fault)
                with stack, self.assertRaises(publication.ops.PublishError): publication.apply(plan)
                report = next(value for path, value in records.items() if path.name.endswith('-main-release.json'))
                self.assertFalse(report['passed']); self.assertTrue(report['recoveryIncomplete'])

    def test_failed_frontend_start_recovers_all_components_forward_without_api86_or_old_ui(self):
        with TemporaryDirectory() as temporary:
            stack, plan, records, aggregate, events = self.cutover(temporary, 'storefront')
            with stack, self.assertRaisesRegex(RuntimeError, 'startup failure'): publication.apply(plan)
            self.assertEqual(events.count('start:api'), 1); self.assertEqual(events[-2:], ['start:storefront', 'start:admin'])
            for name in publication.PORTS:
                selected = records[Path(temporary) / (name + '.json')]
                self.assertEqual(selected['runtimeDirectory'], 'tmp/new-' + name); self.assertEqual(selected['databaseMigrationCount'], 88)
                self.assertTrue(selected['commerceRmaRecoveryRequired']); self.assertFalse(selected['commerceRmaAccepted'])
            self.assertEqual(records[aggregate]['databaseMigrationCount'], 88); self.assertTrue(records[aggregate]['commerceRmaRecoveryRequired'])

    def test_changed_evidence_aborts_before_packaging_or_stopping_any_writer(self):
        with TemporaryDirectory() as temporary:
            stack, plan, _, _, events = self.cutover(temporary)
            with stack, patch.object(publication, 'accepted_evidence', return_value={'changed': True}), patch.object(publication, 'package') as package:
                with self.assertRaises(publication.ops.PublishError): publication.apply(plan)
                package.assert_not_called()
            self.assertEqual(events, [])

    def test_foreign_process_identity_aborts_before_any_stop_or_backup(self):
        with TemporaryDirectory() as temporary:
            stack, plan, _, _, events = self.cutover(temporary)
            with stack, patch.object(publication, 'owned_process', side_effect=publication.ops.PublishError('foreign listener')):
                with self.assertRaisesRegex(publication.ops.PublishError, 'foreign'): publication.apply(plan)
            self.assertEqual(events, [])


class BackupTests(TestCase):
    def test_checksum_mismatch_retains_both_backups_and_never_removes_remote_scratch(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary); (root / 'tmp/local-backups').mkdir(parents=True); calls = []
            def run(argv, **_):
                calls.append(argv)
                if 'sha256sum' in argv: return SimpleNamespace(returncode=0, stdout='a' * 64 + ' owned.bak\n')
                if 'cp' in argv: Path(argv[-1]).write_bytes(b'wrong-copy'); return SimpleNamespace(returncode=0)
                raise AssertionError('Unexpected backup subprocess')
            with patch.object(publication, 'ROOT', root), patch.object(publication.photo, 'measured_space', return_value={}), \
                 patch.object(publication.photo, 'private_copy'), patch.object(publication.photo, 'preserved_files', return_value={}), \
                 patch.object(publication, 'sql') as sql, patch.object(publication.subprocess, 'run', side_effect=run):
                with self.assertRaises(publication.ops.PublishError): publication.verified_backup('b' * 32, {})
            self.assertTrue((root / 'tmp/local-backups' / ('commerce-rma-' + 'b' * 32) / 'Sayman.bak').exists())
            self.assertFalse(any('rm' in argv for argv in calls)); self.assertIn('COPY_ONLY,CHECKSUM', sql.call_args.args[0]); self.assertIn('RESTORE VERIFYONLY', sql.call_args.args[0])
            self.assertNotIn('RESTORE DATABASE', sql.call_args.args[0])


class ProofChainTests(TestCase):
    @contextmanager
    def workspace(self):
        with TemporaryDirectory() as temporary, ExitStack() as stack:
            root = Path(temporary).resolve(); checks = root / 'artifacts/checks'; checks.mkdir(parents=True)
            for module, key, value in ((publication, 'ROOT', root), (publication, 'CHECKS', checks), (publication.photo, 'ROOT', root),
                                        (publication.verify, 'ROOT', root), (publication, '__file__', str(root / 'scripts/publish-local-commerce-rma.py'))):
                stack.enter_context(patch.object(module, key, value))
            def owned(value, parent=None):
                publication.require(isinstance(value, str) and '..' not in Path(value).parts, 'Invalid synthetic evidence path.')
                return publication.verify.workspace_path(value, parent or checks)
            stack.enter_context(patch.object(publication, 'owned_path', side_effect=owned))
            def save(name, value):
                path = checks / name; path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(value)); return {'path': str(path.relative_to(root)), 'sha256': publication.ops.sha(path)}
            yield root, checks, save

    def unit_fixture(self, save):
        artifacts = {'backend/tests/Shop.Tests/bin/Debug/net10.0/' + name: str(i + 1) * 64 for i, name in enumerate(('Shop.Tests.dll', 'Shop.Tests.deps.json', 'Shop.Tests.runtimeconfig.json'))}
        parity = {name: {'api': 'a' * 64, 'unit': 'a' * 64, 'sql': 'a' * 64} for name in ['Shop.Api.dll'] + ['Shop.Module' + str(i) + '.dll' for i in range(13)]}
        old = {'sourceSha256': {'backend/src/product.cs': 'product', 'backend/tests/Shop.Tests/unit.cs': 'unit', 'backend/tests/Shop.SqlTests/fixture.cs': 'old'}, 'module14parity': parity, 'testAssemblySha256': artifacts}
        current = deepcopy(old); current['sourceSha256']['backend/tests/Shop.SqlTests/fixture.cs'] = 'current'
        prior_ref, current_ref = save('round3/frozen.json', old), save('round4/frozen.json', current)
        trx = save('round3/unit/unit.trx', {'synthetic': 'unit receipt bytes'})
        original_command = save('round3/unit/command.json', {'synthetic': 'original command reference'})
        unit = {'total': 1486, 'failed': 0, 'skipped': 0, 'trx': trx, 'command': original_command, 'reusedFromRound3': True}
        prior = {'status': 'backend-frozen-targeted-accepted', 'frozen': prior_ref, 'module14parity': parity, 'testAssemblySha256': deepcopy(old['testAssemblySha256']), 'unit': deepcopy(unit)}
        prior_acceptance = save('prior-acceptance.json', prior)
        proof = {'accepted': True, 'unitPassed': 1486, 'unitArtifacts': artifacts, 'module14parity': parity, 'unitTrx': trx['path'], 'unitTrxSha256': trx['sha256'],
                 'sourceDelta': ['backend/tests/Shop.SqlTests/fixture.cs'], 'previousFrozen': prior_ref, 'currentFrozen': current_ref, 'previousAcceptedBackend': prior_acceptance}
        unit['reuseProof'] = save('reuse-proof.json', proof)
        command = {'argv': ['dotnet', 'test', 'backend/tests/Shop.Tests', '--no-build']}
        return unit, current, current_ref, command, proof

    def test_unit_reuse_binds_original_command_trx_two_explicit_frozen_records_and_exact_artifacts(self):
        with self.workspace() as (_, _, save):
            unit, frozen, reference, command, _ = self.unit_fixture(save); captured = {}
            publication.verify_unit_reuse(unit, frozen, reference, command, captured)
            self.assertEqual(len(captured), 4); self.assertEqual(unit['command']['path'], 'artifacts/checks/round3/unit/command.json')

    def test_changed_unit_reuse_proof_bytes_are_rejected_before_trusting_accepted_marker(self):
        with self.workspace() as (root, _, save):
            unit, frozen, reference, command, _ = self.unit_fixture(save)
            (root / unit['reuseProof']['path']).write_text('{}')
            with self.assertRaises(publication.ops.PublishError): publication.verify_unit_reuse(unit, frozen, reference, command, {})

    def test_unit_reuse_rejects_wrong_trx_count_module_artifact_or_current_frozen_even_with_fresh_proof_hash(self):
        for field in ('unitPassed', 'unitTrxSha256', 'unitArtifacts', 'module14parity', 'currentFrozen'):
            with self.subTest(field=field), self.workspace() as (_, _, save):
                unit, frozen, reference, command, proof = self.unit_fixture(save)
                if field == 'unitPassed': proof[field] = 1485
                elif field == 'unitTrxSha256': proof[field] = '0' * 64
                elif field == 'currentFrozen': proof[field] = proof['previousFrozen']
                else: proof[field] = {}
                unit['reuseProof'] = save('reuse-proof.json', proof)
                with self.assertRaises(publication.ops.PublishError): publication.verify_unit_reuse(unit, frozen, reference, command, {})

    def test_unit_or_product_source_change_is_not_a_sql_only_reuse_delta(self):
        for name in ('backend/src/product.cs', 'backend/tests/Shop.Tests/unit.cs'):
            with self.subTest(source=name), self.workspace() as (_, _, save):
                unit, frozen, _, command, proof = self.unit_fixture(save); frozen['sourceSha256'][name] = 'changed'
                reference = save('round4/frozen.json', frozen); proof['currentFrozen'] = reference
                proof['sourceDelta'] = sorted([name, 'backend/tests/Shop.SqlTests/fixture.cs']); unit['reuseProof'] = save('reuse-proof.json', proof)
                with self.assertRaises(publication.ops.PublishError): publication.verify_unit_reuse(unit, frozen, reference, command, {})

    def test_prior_backend_must_retain_the_same_actual_unit_command_reference(self):
        with self.workspace() as (_, _, save):
            unit, frozen, reference, command, proof = self.unit_fixture(save)
            prior = {'status': 'backend-frozen-targeted-accepted', 'frozen': proof['previousFrozen'], 'module14parity': frozen['module14parity'], 'testAssemblySha256': frozen['testAssemblySha256'], 'unit': {**unit, 'command': save('invented-rerun.json', {})}}
            proof['previousAcceptedBackend'] = save('prior-acceptance.json', prior); unit['reuseProof'] = save('reuse-proof.json', proof)
            with self.assertRaises(publication.ops.PublishError): publication.verify_unit_reuse(unit, frozen, reference, command, {})

    def build_fixture(self, root, save):
        refs = {}
        for name, project in {'api': 'backend/src/Shop.Api', 'unit': 'backend/tests/Shop.Tests', 'sql': 'backend/tests/Shop.SqlTests'}.items():
            log = root / 'artifacts/checks' / name / 'output.log'; log.parent.mkdir(parents=True); log.write_text('Build succeeded. 0 Warning(s) 0 Error(s)')
            refs[name] = save(name + '/command.json', {'status': 'completed', 'returnCode': 0, 'cwd': str(root), 'termination': {'processGroupEmpty': True}, 'logSha256': publication.ops.sha(log), 'argv': ['dotnet', 'build', project, '--no-restore', '--disable-build-servers', '-m:1', '-v:minimal']})
        return {'builds': refs}

    def test_build_command_and_log_bytes_are_both_bound(self):
        with self.workspace() as (root, _, save):
            backend = self.build_fixture(root, save); captured = {}; publication.verify_build_commands(backend, captured); self.assertEqual(len(captured), 6)
            (root / 'artifacts/checks/sql/output.log').write_text('changed')
            with self.assertRaises(publication.ops.PublishError): publication.verify_build_commands(backend, {})

    def test_fresh_hashed_build_record_cannot_select_an_unrelated_project_or_failed_command(self):
        for fault in ('project', 'failed', 'live-group'):
            with self.subTest(fault=fault), self.workspace() as (root, _, save):
                backend = self.build_fixture(root, save); record = json.loads((root / backend['builds']['api']['path']).read_text())
                if fault == 'project': record['argv'][2] = 'unrelated/project'
                elif fault == 'failed': record['returnCode'] = 1
                else: record['termination']['processGroupEmpty'] = False
                backend['builds']['api'] = save('api/command.json', record)
                with self.assertRaises(publication.ops.PublishError): publication.verify_build_commands(backend, {})

    def wire_fixture(self, save):
        kinds = ['quote3'] * 54 + ['quote4', 'quote5', 'create1', 'create2', 'history1', 'history2']; hashes = {}
        for index, kind in enumerate(kinds):
            name = format(index, '032x'); meta = {'actualSqlHttpResponse': True, 'syntheticQaOnly': True, 'status': 200, 'method': 'POST', 'cacheControl': 'private, no-store'}
            if kind.startswith('quote'):
                version = int(kind[-1]); body = {'schemaVersion': version}; meta['path'] = '/api/cart/en/' + ('quote' if version == 3 else 'v2/quote' if version == 4 else 'v2/order-quote')
            else:
                order = {'summary': {'id': 'a' * 32}}
                if kind != 'create1': order.update(taxBreakdownKnown=False, taxRial=None, taxIncluded=True)
                if kind in ('create2', 'history1'): order.update(shippingMode='postpaid', shippingRequired=True, shippingRial='0')
                if kind.endswith('2'): order.update(schemaVersion=2, originalSnapshotVersion=2)
                body = {'order': order} if kind.startswith('create') else order
                meta['path'] = '/api/orders' + ('/v2' if kind.endswith('2') else '') + ('/' + 'a' * 32 if kind.startswith('history') else '')
                if kind.startswith('history'): meta['method'] = 'GET'
            reference = save('wire/' + name + '.json', body); hashes[name + '.json'] = reference['sha256']; save('wire/' + name + '.meta.json', meta)
        report = {'passed': 60, 'counts': dict(Counter(kinds)), 'unitemizedOrders': 3, 'postpaidOrders': 2, 'knownHistoricalOrders': 1, 'syntheticQaOnly': True, 'sha256': hashes}
        return save('wire/frontend-contract-report.json', report), report

    def test_all_sixty_body_and_companion_meta_hashes_are_captured_and_counters_recomputed(self):
        with self.workspace() as (_, _, save):
            reference, _ = self.wire_fixture(save); captured = {}; publication.verify_commerce_wires(reference, captured); self.assertEqual(len(captured), 121)

    def test_wire_missing_synthetic_marker_body_corruption_counter_or_path_escape_is_rejected(self):
        for fault in ('synthetic', 'body', 'counter', 'path'):
            with self.subTest(fault=fault), self.workspace() as (root, _, save):
                reference, report = self.wire_fixture(save); first = next(iter(report['sha256']))
                if fault == 'synthetic':
                    meta_path = root / 'artifacts/checks/wire' / first.replace('.json', '.meta.json'); meta = json.loads(meta_path.read_text()); meta['syntheticQaOnly'] = False; meta_path.write_text(json.dumps(meta))
                elif fault == 'body': (root / 'artifacts/checks/wire' / first).write_text('{}')
                elif fault == 'counter': report['postpaidOrders'] = 1; reference = save('wire/frontend-contract-report.json', report)
                else: report['sha256']['../escape.json'] = report['sha256'].pop(first); reference = save('wire/frontend-contract-report.json', report)
                with self.assertRaises(publication.ops.PublishError): publication.verify_commerce_wires(reference, {})

    def schema_fixture(self, save):
        _, _, contract = snapshots(); contract['capture'] = save('schema/raw.json', contract['changedTablesMetadata'] + contract['newTablesMetadata'])
        contract['metadataSqlSource'] = {'path': 'scripts/publish-local-commerce-rma.py', 'sqlStringSha256': hashlib.sha256(publication.METADATA_SQL.encode()).hexdigest()}
        contract['testResult'] = save('schema/targeted.trx', {'synthetic': 'targeted TRX bytes'})
        names = ['Shop.SqlTests.CommerceRmaSchemaSqlTests.FullyMigratedSchema88HasNoModelDriftAndExportsExactNinePortableTablesWithTrustedChecks']
        return contract, {'trx': contract['testResult']}, names

    def test_schema_capture_exact_nine_tables_query_hash_and_targeted_trx_are_bound(self):
        with self.workspace() as (_, _, save):
            contract, target, names = self.schema_fixture(save); captured = {}; publication.verify_schema_capture(contract, target, names, captured); self.assertEqual(len(captured), 2)

    def test_schema_wrong_query_capture_table_or_trx_fact_cannot_pass_on_contract_marker_alone(self):
        for fault in ('query', 'table', 'trx', 'fact'):
            with self.subTest(fault=fault), self.workspace() as (_, _, save):
                contract, target, names = self.schema_fixture(save)
                if fault == 'query': contract['metadataSqlSource']['sqlStringSha256'] = '0' * 64
                elif fault == 'table': contract['capture'] = save('schema/raw.json', contract['changedTablesMetadata'] + contract['newTablesMetadata'][:-1])
                elif fault == 'trx': contract['testResult'] = save('schema/unrelated.trx', {})
                else: names = []
                with self.assertRaises(publication.ops.PublishError): publication.verify_schema_capture(contract, target, names, {})


if __name__ == '__main__': main()
