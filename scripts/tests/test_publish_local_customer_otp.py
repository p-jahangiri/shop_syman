"""Synthetic offline guard/fault tests only: no API, SQL, secrets or process runs."""
from collections import Counter
from contextlib import ExitStack
from copy import deepcopy
from email.message import Message
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import TestCase, main
from unittest.mock import patch
import hashlib
import importlib.util
import io

from scripts.tests.script_loader import load_script


p = load_script('customer_otp_publisher', 'publish-local-customer-otp.py')


def column(name='Id', ordinal=1, **values):
    return {'name': name, 'column_id': ordinal, 'system_type_id': 56, 'user_type_id': 56,
        'max_length': 4, 'precision': 10, 'scale': 0, 'is_nullable': False, 'collation_name': None,
        'is_identity': False, 'is_computed': False, 'computedDefinition': None, 'defaultDefinition': None, **values}


def index(table='Synthetic', name=None, **values):
    return {'name': name or 'PK_' + table, 'index_id': 1, 'type': 1, 'is_unique': True,
        'is_primary_key': True, 'is_unique_constraint': False, 'has_filter': False,
        'filter_definition': None, 'is_disabled': False, 'index_column_id': 1, 'columnName': 'Id',
        'key_ordinal': 1, 'is_descending_key': False, 'is_included_column': False, **values}


def metadata(name):
    schema, table = name.split('.')
    return {'schema': schema, 'table': table, 'columns': [column()], 'indexes': [index(table)], 'checks': [], 'foreignKeys': []}


def snapshots(frozen=None):
    names = ['identity.AspNetUsers', 'identity.__EFMigrationsHistory'] + ['synthetic.T' + str(n) for n in range(227)]
    before = {'database': 'Sayman', 'tables': [{'schema': name.split('.')[0], 'table': name.split('.')[1], 'count': 3, 'sha256': 'old-' + name} for name in names],
        'metadata': [metadata(name) for name in names], 'histories': [{'schema': 'identity', 'MigrationId': 'old' + str(n), 'ProductVersion': '10.0.12'} for n in range(88)],
        'configuration': {'environment': 'same', 'keyring': 'same'},
        'canonicalBindings': {'provenance': p.canonical_queries()['provenance'],
            'expected': {'count': 0, 'sha256': 'e' * 64, 'collisionCount': 0},
            'actual': {'count': 0, 'sha256': 'e' * 64}}}
    after = deepcopy(before)
    users = p.table_map(after['metadata'])[p.CHANGED_TABLE]
    users['columns'].append(column('CanonicalPhone', 2, system_type_id=167, user_type_id=167, max_length=13,
        precision=0, scale=0, is_nullable=True, collation_name='Latin1_General_100_BIN2'))
    users['indexes'].append(index(name='IX_AspNetUsers_CanonicalPhone', index_id=2, type=2,
        is_primary_key=False, has_filter=True, filter_definition='([CanonicalPhone] IS NOT NULL)', columnName='CanonicalPhone'))
    for name in sorted(p.NEW_TABLES):
        schema, table = name.split('.')
        after['tables'].append({'schema': schema, 'table': table, 'count': 0, 'sha256': 'empty'})
        after['metadata'].append(metadata(name))
    p.table_map(after['tables'])['identity.__EFMigrationsHistory'].update(count=4, sha256='new-history')
    after['histories'].append({'schema': 'identity', 'MigrationId': p.MIGRATION, 'ProductVersion': '10.0.12'})
    contract = {'schemaVersion': 1, 'status': 'disposable-schema89-accepted', 'sourceMigrationCount': 89,
        'frozen': frozen or {'source': 'frozen'}, 'newTablesMetadata': [deepcopy(p.table_map(after['metadata'])[name]) for name in sorted(p.NEW_TABLES)],
        'changedTablesMetadata': [deepcopy(users)],
        'metadataSqlSource': {'path': 'scripts/publish-local-commerce-rma.py', 'sqlStringSha256': hashlib.sha256(p.rma.METADATA_SQL.encode()).hexdigest()},
        'testResultName': p.SCHEMA_CLASS + '.Schema89ExportsPortableMetadata'}
    return before, after, contract


class OfflineGuards(TestCase):
    def setUp(self):
        self.boundaries = ExitStack(); self.addCleanup(self.boundaries.close)
        # Fail closed at every live boundary, including helpers imported through
        # historical publishers. Individual tests replace only their fake input.
        for module, name in ((p.subprocess, 'run'), (p.subprocess, 'Popen'), (p.subprocess, 'check_output'),
            (p.os, 'kill'), (p.ops.HTTP, 'open'), (p.rma, 'sql'), (p.rma, 'payload'),
            (p.rma, 'snapshot'), (p.rma, 'api_environment'), (p.ops, 'read'), (p.ops, 'write'),
            (p.ops, 'sha'), (p.runner, 'freeze'), (p.photo, 'preserved_files'), (p.photo, 'measured_space')):
            self.boundaries.enter_context(patch.object(module, name, side_effect=AssertionError('Live boundary forbidden: ' + name)))

    def state(self):
        return {'api': p.ops.API_URL, 'sourceMigrationCount': 88, 'databaseMigrationCount': 88, 'tableCount': 229,
            'commerceRmaAccepted': True, 'commerceRmaPolicyConfigured': True, 'commerceRmaRecoveryRequired': False,
            'policyConfigurationPending': {name: False for name in ('shippingTaxPolicy', 'reservationAndOpenOrderSettings', 'returnRequestPolicy')},
            'catalogPriceHistoryApiAccepted': True, 'catalogPriceHistoryBackendEvidence': 'historical-d65',
            'imageLibraryApiAccepted': True, 'imageLibraryBackendEvidence': p.relative(p.BASELINE),
            'storeIdentityApiAccepted': True, 'storeIdentityAccepted': True, 'storeIdentityExamplesConfigured': False,
            'usedInspectionPhotosApiAccepted': True, 'privateAdminHeadersAccepted': True, 'customerLoginContinuityAccepted': True,
            'privateAdminQaPending': True, 'catalogPriceHistoryPrivateAdminQaPending': True, 'futureMarker': {'retain': True},
            'runtimeDirectory': 'tmp/api-runtime-d66-old', 'apiPid': 100}

    def aggregate(self):
        return {**self.state(), 'database': 'Sayman', 'canonicalUrls': p.rma.URLS,
            'componentReleaseEvidence': {name: 'old-' + name for name in p.rma.URLS}}

    def fixture(self):
        names = ['Shop.Api.dll', 'Shop.Modules.Identity.dll', 'Shop.SharedKernel.dll'] + ['Shop.Modules.Guard' + str(n) + '.dll' for n in range(11)]
        old_modules = {name: {kind: 'old-' + name for kind in ('api', 'unit', 'sql')} for name in names}
        modules = {name: {kind: 'new-' + name for kind in ('api', 'unit', 'sql')} for name in names}
        baseline = {'passed': True, 'schemaChanges': 0, 'frozen': {'module14parity': old_modules,
            'sourceSha256': {**{name: 'old' for name in p.ALLOWED}, 'backend/unchanged.cs': 'same'}}}
        frozen = {'sourceSha256': {**baseline['frozen']['sourceSha256'], **{name: 'new' for name in p.ALLOWED}, p.SCHEMA_SOURCE: 'new'},
            'module14parity': modules, 'testAssemblySha256': {'unit': 'frozen-unit', 'sql': 'frozen-sql'}}
        classes = p.SQL_CLASSES | {p.SCHEMA_CLASS}
        sql_names = [name + '.WholeClassCase' for name in sorted(classes)] + [p.SCHEMA_CLASS + '.Schema89ExportsPortableMetadata']
        units = ['Shop.Tests.FullUnit.Case' + str(n) for n in range(p.MIN_UNIT)]
        def record(name): return {'path': 'artifacts/checks/d67-offline-' + name, 'sha256': 'hash', 'exitCode': 0}
        accepted = {'passed': True, 'schemaChanges': 1, 'frozen': frozen, 'build': record('build.log'),
            'unit': {**record('unit.trx'), 'passed': len(units), 'names': units},
            'sql': {**record('sql.trx'), 'passed': len(sql_names), 'names': sql_names, 'classes': sorted(classes), 'exactDiscoveryCounter': True},
            'cleanup': record('cleanup.log'), 'sqlDiscovery': record('discovery.json'),
            'sqlClassesExpected': sorted(classes), 'schemaContract': record('schema.json')}
        discovery = {'allCases': 1100, 'selectedClasses': sorted(classes), 'selected': sql_names.copy()}
        actual = {'unit.trx': units.copy(), 'sql.trx': sql_names.copy()}
        contract = snapshots(frozen)[2]
        return accepted, baseline, discovery, actual, contract

    def check_acceptance(self, mutate=None, cleanup=None):
        accepted, baseline, discovery, actual, contract = self.fixture()
        if mutate: mutate(accepted, baseline, discovery, actual, contract)
        def read(path):
            if path == p.ACCEPTANCE: return accepted
            if path == p.BASELINE: return baseline
            if path == p.ROOT / accepted['sqlDiscovery']['path']: return discovery
            if path == p.ROOT / accepted['schemaContract']['path']: return contract
            raise AssertionError('Unexpected evidence read')
        with patch.object(p.ops, 'read', side_effect=read), patch.object(p.ops, 'sha', return_value='hash'), \
            patch.object(p.runner, 'freeze', return_value=accepted['frozen']), \
            patch.object(p.ops, 'accepted_trx', side_effect=lambda file, count: actual['unit.trx' if file.name.endswith('unit.trx') else 'sql.trx']), \
            patch.object(Path, 'read_text', return_value=p.CLEANUP_ZERO if cleanup is None else cleanup):
            return p.acceptance()

    def test_import_is_inert(self):
        spec = importlib.util.spec_from_file_location('customer_otp_import_only', Path(p.__file__))
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        self.assertEqual(module.KIND, p.KIND)

    def test_only_the_exact_finalized_d66_baseline_is_current(self):
        _, baseline, _, _, _ = self.fixture()
        state = self.state(); state['moduleSha256'] = {name: value['api'] for name, value in baseline['frozen']['module14parity'].items()}
        with patch.object(p.ops, 'read', return_value=baseline):
            p.current_d66(state)
            for key, value in [('api', 'http://127.0.0.1:5180'), ('tableCount', 228), ('databaseMigrationCount', 87),
                ('imageLibraryApiAccepted', False), ('imageLibraryBackendEvidence', 'other'),
                ('commerceRmaPolicyConfigured', False), ('moduleSha256', {})]:
                changed = deepcopy(state); changed[key] = value
                with self.subTest(key=key), self.assertRaises(Exception): p.current_d66(changed)

    def test_complete_bound_unit_sql_schema_evidence_is_required(self):
        accepted = self.check_acceptance()
        self.assertEqual(accepted['unit']['passed'], 1700)
        self.assertEqual(len(accepted['sql']['classes']), 7)
        self.assertEqual(accepted['schemaChanges'], 1)

    def test_source_module_hash_counts_and_schema_provenance_fail_closed(self):
        for mutation in [
            lambda a,b,d,t,c: a.update(passed=False), lambda a,b,d,t,c: a.update(schemaChanges=0),
            lambda a,b,d,t,c: a['frozen']['sourceSha256'].update({'backend/unreviewed.cs': 'new'}),
            lambda a,b,d,t,c: a['frozen']['sourceSha256'].pop(p.SCHEMA_SOURCE),
            lambda a,b,d,t,c: a['frozen']['module14parity']['Shop.Api.dll'].update(unit='other'),
            lambda a,b,d,t,c: a['frozen']['module14parity'].pop('Shop.SharedKernel.dll'),
            lambda a,b,d,t,c: a['unit'].update(passed=1699), lambda a,b,d,t,c: a['build'].update(exitCode=1),
            lambda a,b,d,t,c: a['sqlDiscovery'].update(sha256='stale'),
            lambda a,b,d,t,c: a['schemaContract'].update(sha256='stale'),
            lambda a,b,d,t,c: c.update(frozen={'other': 'source'}),
            lambda a,b,d,t,c: c.update(testResultName=p.SCHEMA_CLASS + '.NotExecuted'),
            lambda a,b,d,t,c: c['metadataSqlSource'].update(sqlStringSha256='other'),
        ]:
            with self.subTest(mutation=mutation), self.assertRaises(Exception): self.check_acceptance(mutation)
        with self.assertRaises(Exception): self.check_acceptance(cleanup='One database remains.')

    def test_whole_class_discovery_trx_counter_never_accepts_missing_or_duplicate_cases(self):
        for mutation in [
            lambda a,b,d,t,c: d['selected'].pop(), lambda a,b,d,t,c: t['sql.trx'].pop(),
            lambda a,b,d,t,c: d['selected'].append(d['selected'][0]),
            lambda a,b,d,t,c: a['sql']['classes'].pop(),
            lambda a,b,d,t,c: a['sql'].update(exactDiscoveryCounter=False),
            lambda a,b,d,t,c: a['sql']['classes'].append('Shop.SqlTests.Other'),
        ]:
            with self.subTest(mutation=mutation), self.assertRaises(Exception): self.check_acceptance(mutation)

    def test_only_one_nullable_user_column_index_and_three_empty_tables_are_additive(self):
        before, after, contract = snapshots()
        p.preserved_database(before, after, contract)
        p.validate_contract(contract, contract['frozen'], [contract['testResultName']])
        self.assertIn("name=N'CanonicalPhone'", self.snapshot_query())
        self.assertNotIn('TaxBreakdownKnown', self.snapshot_query())

    def snapshot_query(self):
        captured = []
        before, _, _ = snapshots()
        def payload(query):
            captured.append(query)
            if 'CREATE TABLE #fingerprints' in query: return before['tables']
            if 'DECLARE @TrimCharacters' in query: return before['canonicalBindings']['expected']
            if 'DECLARE @projection' in query: return before['canonicalBindings']['actual']
            return before['metadata']
        with patch.object(p.rma, 'snapshot', return_value=deepcopy(before)), patch.object(p.rma, 'payload', side_effect=payload):
            p.database_snapshot()
        return next(query for query in captured if 'CREATE TABLE #fingerprints' in query)

    def test_original_values_rowversions_history_versions_keys_and_unexpected_canonical_bindings_are_never_exempt(self):
        for mutation in [
            lambda a: p.table_map(a['tables'])['identity.AspNetUsers'].update(sha256='new-user-data'),
            lambda a: p.table_map(a['tables'])['synthetic.T17'].update(count=4),
            lambda a: a['histories'][0].update(ProductVersion='other'),
            lambda a: a['configuration'].update(keyring='rotated'),
            lambda a: a['canonicalBindings']['actual'].update(count=1),
            lambda a: a['canonicalBindings']['actual'].update(sha256='a' * 64),
            lambda a: a['tables'][-1].update(count=1),
            lambda a: a['metadata'].append(deepcopy(a['metadata'][0])),
            lambda a: a['histories'][-1].update(MigrationId='OtherMigration'),
        ]:
            before, after, contract = snapshots(); mutation(after)
            with self.subTest(mutation=mutation), self.assertRaises(Exception): p.preserved_database(before, after, contract)

    def test_valid_non_null_legacy_contact_backfill_matches_only_exact_ordered_id_and_phone_digest(self):
        before, after, contract = snapshots()
        expected = {'count': 7, 'sha256': 'a' * 64, 'collisionCount': 0}
        before['canonicalBindings']['expected'] = deepcopy(expected)
        after['canonicalBindings']['expected'] = deepcopy(expected)
        after['canonicalBindings']['actual'] = {'count': 7, 'sha256': 'a' * 64}
        p.preserved_database(before, after, contract)
        for mutation in (
            lambda value: value['actual'].update(count=6),
            lambda value: value['actual'].update(sha256='b' * 64),
            lambda value: value['expected'].update(sha256='b' * 64),
            lambda value: value['provenance'].update(expectedSqlSha256='b' * 64),
        ):
            changed = deepcopy(after); mutation(changed['canonicalBindings'])
            with self.subTest(mutation=mutation), self.assertRaises(Exception): p.preserved_database(before, changed, contract)

    def test_canonical_collisions_refuse_before_the_cutover_and_no_raw_contact_fields_are_accepted_in_evidence(self):
        before = snapshots()[0]
        source = {(row['schema'], row['MigrationId']) for row in before['histories']} | {('identity', p.MIGRATION)}
        before['canonicalBindings']['expected'].update(count=2, collisionCount=1)
        with patch.object(p, 'source_migrations', return_value=source), self.assertRaisesRegex(Exception, 'collision'):
            p.pending(before)
        for value in ({'count': 0, 'sha256': 'e' * 64, 'mobile': 'synthetic-not-for-artifacts'},
            {'count': -1, 'sha256': 'e' * 64}, {'count': True, 'sha256': 'e' * 64}, {'count': 0, 'sha256': 'bad'}):
            with self.subTest(value=value), self.assertRaises(Exception): p.binding_summary(value)

    def test_expected_query_reuses_exact_migration_cte_without_business_writes_or_transaction_lock_hint(self):
        queries = p.canonical_queries()
        raw = (p.ROOT / p.MIGRATION_SOURCE).read_bytes()
        source = raw.decode('utf-8-sig')
        original = source.split('DECLARE @TrimCharacters nvarchar(32)=', 1)[1].split('\n                IF EXISTS', 1)[0].rstrip()
        original = 'DECLARE @TrimCharacters nvarchar(32)=' + original
        self.assertTrue(queries['expectedSql'].startswith(original.replace('WITH (TABLOCKX,HOLDLOCK)', '') + '\n'))
        self.assertEqual(queries['provenance']['migrationSourceSha256'], hashlib.sha256(raw).hexdigest())
        self.assertEqual(queries['provenance']['normalizerSqlSha256'], hashlib.sha256(original.encode()).hexdigest())
        self.assertEqual(queries['provenance']['expectedSqlSha256'], hashlib.sha256(queries['expectedSql'].encode()).hexdigest())
        self.assertNotIn('@@TRANCOUNT', queries['expectedSql']); self.assertNotIn('TABLOCKX', queries['expectedSql'])
        self.assertNotIn('UPDATE Users', queries['expectedSql']); self.assertIn('[collisionCount]', queries['expectedSql'])
        self.assertIn('ORDER BY [Id] FOR JSON PATH,INCLUDE_NULL_VALUES', queries['actualSql'])
        self.assertIn('[Canonical] AS [CanonicalPhone]', queries['expectedSql'])
        tampered = raw.replace(b';WITH Normalized AS', b'UPDATE [identity].[AspNetUsers] SET [IsActive]=0;\n;WITH Normalized AS')
        with patch.object(Path, 'read_bytes', return_value=tampered), self.assertRaises(Exception): p.canonical_queries()

    def test_a_matching_forged_schema_contract_cannot_weaken_old_columns_or_expand_the_index_allowlist(self):
        for change in ('old-column', 'new-column', 'index-unique', 'index-filter', 'old-index', 'foreign-key', 'check'):
            before, after, contract = snapshots()
            for rows in (after['metadata'], contract['changedTablesMetadata']):
                users = p.table_map(rows)[p.CHANGED_TABLE]
                if change == 'old-column': users['columns'][0]['is_nullable'] = True
                elif change == 'new-column': users['columns'][-1]['defaultDefinition'] = "('invented')"
                elif change == 'index-unique': users['indexes'][-1]['is_unique'] = False
                elif change == 'index-filter': users['indexes'][-1]['filter_definition'] = '[CanonicalPhone] IS NOT NULL OR 1=1'
                elif change == 'old-index': users['indexes'][0]['is_disabled'] = True
                elif change == 'foreign-key': users['foreignKeys'].append({'new': 'unapproved'})
                else: users['checks'].append({'new': 'unapproved'})
            with self.subTest(change=change), self.assertRaises(Exception): p.preserved_database(before, after, contract)

    def test_only_new_canonical_index_numeric_allocation_is_portable_between_fixture_and_existing_database(self):
        before, after, contract = snapshots()
        actual = p.table_map(after['metadata'])[p.CHANGED_TABLE]
        approved = contract['changedTablesMetadata'][0]
        actual['indexes'][-1]['index_id'] = 15
        approved['indexes'][-1]['index_id'] = 5
        p.preserved_database(before, after, contract)
        for change in ('old-index-id', 'new-index-id-collision', 'new-index-filter', 'new-index-type', 'new-column'):
            changed = deepcopy(after); users = p.table_map(changed['metadata'])[p.CHANGED_TABLE]
            if change == 'old-index-id': users['indexes'][0]['index_id'] = 14
            elif change == 'new-index-id-collision': users['indexes'][-1]['index_id'] = users['indexes'][0]['index_id']
            elif change == 'new-index-filter': users['indexes'][-1]['filter_definition'] = '[CanonicalPhone] IS NOT NULL OR 1=1'
            elif change == 'new-index-type': users['indexes'][-1]['type'] = 1
            else: users['columns'][-1]['max_length'] = 14
            with self.subTest(change=change), self.assertRaises(Exception): p.preserved_database(before, changed, contract)

    def test_pending_schema_and_history_must_be_exactly88_plus_the_single_identity_migration(self):
        before = snapshots()[0]
        source = {(row['schema'], row['MigrationId']) for row in before['histories']} | {('identity', p.MIGRATION)}
        with patch.object(p, 'source_migrations', return_value=source):
            p.pending(before)
            changed = deepcopy(before); changed['histories'].pop()
            with self.assertRaises(Exception): p.pending(changed)
        with patch.object(p, 'source_migrations', return_value=source | {('sales', 'Unreviewed')}), self.assertRaises(Exception): p.pending(before)

    def test_candidate_inherits_every_business_browser_and_unknown_marker_without_claiming_provider_or_full_sql(self):
        old = self.state(); accepted = self.fixture()[0]
        plan = {'previous': old, 'accepted': accepted, 'runtimeDirectory': 'tmp/api-runtime-customer-otp-' + 'a' * 32,
            'artifactManifest': 'artifacts/checks/fake-manifest.json', 'artifactManifestSha256': 'hash'}
        candidate = p.candidate(plan, p.CHECKS / 'fake-release.json')
        for key in ('commerceRmaAccepted', 'commerceRmaPolicyConfigured', 'policyConfigurationPending', 'catalogPriceHistoryApiAccepted',
            'imageLibraryApiAccepted', 'storeIdentityApiAccepted', 'usedInspectionPhotosApiAccepted', 'privateAdminHeadersAccepted',
            'customerLoginContinuityAccepted', 'privateAdminQaPending', 'catalogPriceHistoryPrivateAdminQaPending', 'futureMarker'):
            self.assertEqual(candidate[key], old[key])
        self.assertEqual((candidate['sourceMigrationCount'], candidate['tableCount']), (89, 232))
        self.assertFalse(candidate['customerOtpProviderActivated']); self.assertFalse(candidate['customerOtpApiAccepted'])
        self.assertFalse(candidate['mainSeedPerformed']); self.assertFalse(candidate['fullSqlRunThisRelease'])
        self.assertTrue(candidate['customerOtpBrowserQaPending']); self.assertTrue(candidate['newBackupCreated'])

    def test_package_keeps_exact_dependencies_and_accepts_only_product_module_and_pdb_delta(self):
        modules = self.fixture()[0]['frozen']['module14parity']
        before = {**{name: 'old' for name in modules}, 'Shop.Api.pdb': 'old', 'Shop.Api.deps.json': 'same'}
        valid = {**before, **{name: 'new' for name in modules}, 'Shop.Api.pdb': 'new'}
        self.assertEqual(p.package_delta(before, valid, modules), set(modules) | {'Shop.Api.pdb'})
        for changed in ({**valid, 'Shop.Api.deps.json': 'new'}, {**valid, 'new.dll': 'new'}, before):
            with self.assertRaises(Exception): p.package_delta(before, changed, modules)

    def test_invalid_or_stale_plan_refuses_before_stop_or_sql(self):
        for plan in ({}, {'kind': p.KIND, 'run': '../outside'}, {'kind': p.KIND, 'run': 'z' * 32}):
            with patch.object(p, 'acceptance') as acceptance, patch.object(p, 'stop_owned') as stop:
                with self.assertRaises(Exception): p.apply(plan)
                acceptance.assert_not_called(); stop.assert_not_called()
        plan = {'kind': p.KIND, 'run': 'a' * 32, 'accepted': {}, 'helpers': {}}
        with patch.object(p, 'acceptance', return_value={'changed': True}), patch.object(p, 'stop_owned') as stop:
            with self.assertRaises(Exception): p.apply(plan)
            stop.assert_not_called()

    def test_descriptor_race_refuses_before_api_stop_or_any_database_boundary(self):
        plan = {'kind': p.KIND, 'run': 'a' * 32, 'accepted': {}, 'helpers': {}, 'descriptors': {'api': 'old'}}
        with patch.object(p, 'acceptance', return_value={}), patch.object(p, 'helpers', return_value={}), \
            patch.object(p, 'descriptor_hashes', return_value={'api': 'new'}), patch.object(p, 'stop_owned') as stop, \
            patch.object(p, 'shape') as shape:
            with self.assertRaises(Exception): p.apply(plan)
            stop.assert_not_called(); shape.assert_not_called()

    def test_process_identity_requires_exact_current_descriptor_command_cwd_start_and_listener(self):
        state = self.state(); directory = p.ROOT / 'tmp/api-runtime-d66-old'
        def output(argv, **kwargs):
            return ('dotnet ' + str(directory / 'Shop.Api.dll')) if 'command=' in argv else ('p100\nn' + str(p.ROOT) + '\n') if '-Fn' in argv else 'Sat Oct 31 20:00:00 2026'
        with patch.object(p, 'runtime', return_value=directory), patch.object(p.ops, 'read', return_value=state), \
            patch.object(p.rma, 'listener', return_value=100), patch.object(p.subprocess, 'check_output', side_effect=output):
            self.assertEqual(p.owned_process(state)['pid'], 100)
            with patch.object(p.ops, 'read', return_value={**state, 'apiPid': 999}), self.assertRaises(Exception): p.owned_process(state)
            with patch.object(p.rma, 'listener', return_value=999), self.assertRaises(Exception): p.owned_process(state)
            for bad in ('dotnet /other/Shop.Api.dll', ''):
                with patch.object(p.subprocess, 'check_output', return_value=bad), self.assertRaises(Exception): p.owned_process(state)

    def test_same_pid_reuse_with_different_start_identity_never_receives_a_signal(self):
        with patch.object(p, 'owned_process', return_value={'pid': 100, 'started': 'new'}), patch.object(p.os, 'kill') as kill:
            with self.assertRaises(Exception): p.stop_owned(self.state(), {'pid': 100, 'started': 'old'})
            kill.assert_not_called()

    def response(self, headers=None, status=401, body=b''):
        values = {'Cache-Control': 'private, no-store', 'Vary': 'Origin, Cookie, Authorization', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff'}
        values.update(headers or {}); message = Message()
        for key, value in values.items(): message[key] = value
        response = io.BytesIO(body); response.status = status; response.headers = message
        return response

    def test_new_private_probes_are_only_anonymous_bounded_gets_with_strict_headers(self):
        for path in ('/api/admin/sms/settings', '/api/auth/me'):
            with patch.object(p.ops.HTTP, 'open', return_value=self.response()) as opened:
                self.assertTrue(p.private_probe(path)['privateHeadersAccepted'])
                opened.assert_called_once_with(p.ops.API_URL + path, timeout=10)
            for headers in ({'Cache-Control': 'no-store'}, {'Vary': 'Authorization'}, {'X-Robots-Tag': ''},
                {'X-Content-Type-Options': ''}, {'Set-Cookie': 'unexpected=1'}, {'Location': '/login'}):
                with patch.object(p.ops.HTTP, 'open', return_value=self.response(headers)), self.assertRaises(Exception): p.private_probe(path)
        for response in (self.response(status=200), self.response(body=b'x' * 32769)):
            with patch.object(p.ops.HTTP, 'open', return_value=response), self.assertRaises(Exception): p.private_probe('/api/admin/sms/settings')
        with patch.object(p.ops.HTTP, 'open') as opened, self.assertRaises(Exception): p.private_probe('/api/auth/otp')
        opened.assert_not_called()

    def test_expected401_http_exception_is_still_inspected_and_no_provider_is_probed(self):
        response = self.response()
        error = p.HTTPError(p.ops.API_URL + '/api/admin/sms/settings', 401, 'Unauthorized', response.headers, io.BytesIO(b''))
        with patch.object(p.ops.HTTP, 'open', side_effect=error): self.assertTrue(p.private_probe('/api/admin/sms/settings')['privateHeadersAccepted'])

    def test_backup_checksum_mismatch_retains_remote_and_local_copies_without_removal(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary); (root / 'tmp/local-backups').mkdir(parents=True); calls = []
            def run(argv, **kwargs):
                calls.append(argv)
                if 'sha256sum' in argv: return SimpleNamespace(returncode=0, stdout='a' * 64 + ' owned.bak\n')
                if 'cp' in argv:
                    Path(argv[-1]).write_bytes(b'synthetic-backup')
                    return SimpleNamespace(returncode=0)
                raise AssertionError('No remote removal after checksum mismatch')
            with patch.object(p, 'ROOT', root), patch.object(p.photo, 'measured_space', return_value={}), \
                patch.object(p.photo, 'private_copy'), patch.object(p.photo, 'preserved_files', return_value={}), \
                patch.object(p.rma, 'sql') as sql, patch.object(p.subprocess, 'run', side_effect=run), \
                patch.object(p.ops, 'sha', return_value='b' * 64):
                with self.assertRaises(Exception): p.verified_backup('a' * 32, {})
            self.assertTrue((root / 'tmp/local-backups' / ('customer-otp-' + 'a' * 32) / 'Sayman.bak').exists())
            self.assertFalse(any('rm' in argv for argv in calls))
            self.assertIn('COPY_ONLY,CHECKSUM', sql.call_args.args[0]); self.assertIn('RESTORE VERIFYONLY', sql.call_args.args[0])

    def cutover(self, fault=None):
        accepted, _, _, _, contract = self.fixture(); before, after, _ = snapshots(accepted['frozen'])
        queries = p.canonical_queries()
        previous = self.state(); hashes = {name: name + '-hash' for name in p.rma.DESCRIPTORS}
        plan = {'kind': p.KIND, 'run': 'a' * 32, 'accepted': accepted, 'helpers': {}, 'previous': previous,
            'descriptors': hashes, 'aggregateSha256': 'aggregate-hash', 'preservedFiles': {}, 'process': {'pid': 100},
            'runtimeDirectory': 'tmp/api-runtime-customer-otp-' + 'a' * 32, 'artifactManifest': 'artifacts/checks/fake-manifest.json',
            'artifactManifestSha256': 'manifest-hash', 'apiFiles': {}}
        state = {'migrated': False, 'listener': 100, 'descriptor': deepcopy(previous), 'startAttempts': 0}; events = []; writes = []
        active = {**p.candidate(plan, p.CHECKS / 'fake.json'), 'apiPid': 200}
        def sha(path):
            if path == p.AGGREGATE: return 'aggregate-hash'
            for name, file in p.rma.DESCRIPTORS.items():
                if file == path: return hashes[name]
            return 'hash'
        def read(path):
            if path == p.AGGREGATE: return self.aggregate()
            if path == p.CURRENT: return deepcopy(state['descriptor'])
            if path == p.ROOT / accepted['schemaContract']['path']: return contract
            raise AssertionError('Unexpected evidence read')
        def stop(selected, expected):
            events.append('stop:' + str(expected['pid'])); self.assertEqual(expected['pid'], state['listener']); state['listener'] = None
        def backup(*_):
            events.append('backup')
            if fault == 'backup': raise RuntimeError('injected backup failure')
            return {'passed': True}
        def migrate(argv, **kwargs):
            events.append('migrate'); self.assertEqual(argv[-1], '--migrate-customer-otp')
            self.assertNotIn('--migrate', argv); self.assertNotIn('--seed-dev', argv)
            if fault == 'migration': raise RuntimeError('injected migration invocation failure')
            state['migrated'] = True
        def start(selected, _log):
            events.append('start:' + str(selected['databaseMigrationCount']))
            state['startAttempts'] += 1
            value = {**selected, 'apiPid': 100 + 100 * state['startAttempts']}; state['listener'] = value['apiPid']
            state['descriptor'] = deepcopy(value)
            if fault == 'startup-clean' and state['startAttempts'] == 1:
                state['listener'] = None
                raise p.KnownStoppedStartup(value, value['apiPid'])
            return value, [], {'pid': value['apiPid']}
        def snapshot():
            value = deepcopy(after if state['migrated'] else before)
            if fault == 'old-data' and state['migrated']: value['tables'][0]['sha256'] = 'unapproved'
            return value
        def write(path, value, **kwargs):
            writes.append((path, deepcopy(value)))
            if path == p.CURRENT: state['descriptor'] = deepcopy(value)
            if fault == 'aggregate' and path == p.AGGREGATE and value.get('customerOtpApiAccepted') is True: raise RuntimeError('injected aggregate failure')
        stack = ExitStack()
        for module, name, options in [
            (p, 'acceptance', {'return_value': accepted}), (p, 'helpers', {'return_value': {}}),
            (p, 'descriptor_hashes', {'return_value': hashes}), (p, 'current_d66', {'return_value': None}),
            (p, 'aggregate88', {'return_value': None}), (p, 'runtime', {'return_value': Path('/unused')}),
            (p, 'owned_process', {'side_effect': lambda selected: {'pid': selected['apiPid']}}),
            (p, 'stop_owned', {'side_effect': stop}), (p, 'start_selected', {'side_effect': start}),
            (p, 'pending', {'return_value': None}), (p, 'database_snapshot', {'side_effect': snapshot}),
            (p, 'canonical_queries', {'return_value': queries}),
            (p, 'verified_backup', {'side_effect': backup}), (p.rma, 'listener', {'side_effect': lambda _: state['listener']}),
            (p, 'shape', {'side_effect': lambda: {'migrationCount': 89, 'tableCount': 232} if state['migrated'] else {'migrationCount': 88, 'tableCount': 229}}),
            (p.ops, 'read', {'side_effect': read}), (p.ops, 'write', {'side_effect': write}), (p.ops, 'sha', {'side_effect': sha}),
            (p.photo, 'tree', {'return_value': {}}), (p.photo, 'preserved_files', {'return_value': {}}),
            (p.rma, 'api_environment', {'return_value': {}}), (p.subprocess, 'run', {'side_effect': migrate}),
            (Path, 'exists', {'return_value': False}), (Path, 'open', {'return_value': io.BytesIO()}),
        ]: stack.enter_context(patch.object(module, name, **options))
        if fault == 'foreign-descriptor':
            def changed_probe():
                state['descriptor'] = {'runtimeDirectory': 'tmp/foreign-selection', 'apiPid': 999}
                raise RuntimeError('injected concurrent descriptor change')
            stack.enter_context(patch.object(p, 'readonly_smoke', side_effect=changed_probe))
        elif fault in ('probe', 'aggregate'):
            stack.enter_context(patch.object(p, 'readonly_smoke', **({'side_effect': RuntimeError('injected probe failure')} if fault == 'probe' else {'return_value': []})))
        else: stack.enter_context(patch.object(p, 'readonly_smoke', return_value=[]))
        return stack, plan, writes, events, state

    def test_success_orders_only_owned_api_stop_backup_scoped_migrate_and_compatible89_start(self):
        stack, plan, writes, events, state = self.cutover()
        with stack: report = p.apply(plan)
        self.assertTrue(report['passed']); self.assertEqual(events, ['stop:100', 'backup', 'migrate', 'start:89'])
        self.assertTrue(state['migrated'])
        descriptor = [value for path, value in writes if path == p.CURRENT][-1]
        self.assertTrue(descriptor['customerOtpApiAccepted']); self.assertFalse(descriptor['customerOtpProviderActivated'])
        self.assertTrue(descriptor['imageLibraryApiAccepted']); self.assertTrue(descriptor['privateAdminQaPending'])

    def test_backup_failure_can_recover_only_exact_untouched_previous88_before_any_migration_invocation(self):
        stack, plan, writes, events, state = self.cutover('backup')
        with stack, self.assertRaisesRegex(RuntimeError, 'backup failure'): p.apply(plan)
        self.assertEqual(events, ['stop:100', 'backup', 'start:88']); self.assertFalse(state['migrated'])
        report = [value for path, value in writes if path.name.endswith('-main-release.json')][-1]
        self.assertTrue(report['recoveredUnchangedPrevious88']); self.assertFalse(report['migrationCommandStarted'])

    def test_any_migration_invocation_forbids_api88_even_when_database_remains88(self):
        stack, plan, writes, events, _ = self.cutover('migration')
        with stack, self.assertRaisesRegex(RuntimeError, 'migration invocation failure'): p.apply(plan)
        self.assertEqual(events, ['stop:100', 'backup', 'migrate'])
        report = [value for path, value in writes if path.name.endswith('-main-release.json')][-1]
        self.assertTrue(report['migrationCommandStarted']); self.assertTrue(report['recoveryRequired'])

    def test_failed_post_migration_probe_recovers_only_compatible89_and_marks_aggregate_unaccepted(self):
        stack, plan, writes, events, _ = self.cutover('probe')
        with stack, self.assertRaisesRegex(RuntimeError, 'probe failure'): p.apply(plan)
        self.assertEqual(events, ['stop:100', 'backup', 'migrate', 'start:89', 'stop:200', 'start:89'])
        report = [value for path, value in writes if path.name.endswith('-main-release.json')][-1]
        self.assertFalse(report['passed']); self.assertTrue(report['recoveredCompatible89'])
        aggregate = [value for path, value in writes if path == p.AGGREGATE][-1]
        self.assertEqual(aggregate['databaseMigrationCount'], 89); self.assertFalse(aggregate['customerOtpApiAccepted'])
        self.assertTrue(aggregate['customerOtpRecoveryRequired'])

    def test_data_change_after_migration_blocks_startup_and_any_automatic_recovery(self):
        stack, plan, writes, events, _ = self.cutover('old-data')
        with stack, self.assertRaises(Exception): p.apply(plan)
        self.assertEqual(events, ['stop:100', 'backup', 'migrate'])
        report = [value for path, value in writes if path.name.endswith('-main-release.json')][-1]
        self.assertTrue(report['recoveryRequired'])

    def test_late_aggregate_failure_rewrites_success_report_failed_and_never_falls_back88(self):
        stack, plan, writes, events, _ = self.cutover('aggregate')
        with stack, self.assertRaisesRegex(RuntimeError, 'aggregate failure'): p.apply(plan)
        reports = [value for path, value in writes if path.name.endswith('-main-release.json')]
        self.assertTrue(any(value['passed'] for value in reports)); self.assertFalse(reports[-1]['passed'])
        self.assertTrue(reports[-1]['recoveredCompatible89']); self.assertNotIn('start:88', events)

    def test_a_foreign_descriptor_after_start_is_preserved_and_never_terminated_or_overwritten_for_recovery(self):
        stack, plan, writes, events, state = self.cutover('foreign-descriptor')
        with stack, self.assertRaisesRegex(RuntimeError, 'concurrent descriptor change'): p.apply(plan)
        self.assertEqual(events, ['stop:100', 'backup', 'migrate', 'start:89'])
        self.assertEqual(state['descriptor']['apiPid'], 999)
        report = [value for path, value in writes if path.name.endswith('-main-release.json')][-1]
        self.assertTrue(report['recoveryRequired'])

    def test_clean_own_candidate_startup_failure_hands_off_its_descriptor_for_forward89_recovery(self):
        stack, plan, writes, events, state = self.cutover('startup-clean')
        with stack, self.assertRaises(p.KnownStoppedStartup): p.apply(plan)
        self.assertEqual(events, ['stop:100', 'backup', 'migrate', 'start:89', 'start:89'])
        self.assertEqual(state['descriptor']['apiPid'], 300)
        report = [value for path, value in writes if path.name.endswith('-main-release.json')][-1]
        self.assertFalse(report['passed']); self.assertTrue(report['recoveredCompatible89'])
        self.assertEqual(report['knownStoppedStartupPid'], 200); self.assertEqual(report['recoveryApiPid'], 300)

    def test_real_startup_cleanup_only_hands_off_after_proved_child_exit_and_exact_candidate_descriptor(self):
        accepted = self.fixture()[0]
        plan = {'previous': self.state(), 'accepted': accepted,
            'runtimeDirectory': 'tmp/api-runtime-customer-otp-' + 'a' * 32,
            'artifactManifest': 'artifacts/checks/fake-manifest.json', 'artifactManifestSha256': 'hash'}
        selected = p.candidate(plan, p.CHECKS / 'fake-release.json')
        for fault in ('clean', 'foreign-descriptor', 'unproved-exit'):
            record = {'selected': deepcopy(selected)}
            class Child:
                pid = 200
                stopped = False
                termination_requested = False
                def poll(self): return 0 if self.stopped else None
                def terminate(self): self.termination_requested = True
                def wait(self, timeout):
                    if fault == 'unproved-exit': raise TimeoutError('Synthetic unproved child termination')
                    self.stopped = True
                    return 0
            child = Child()
            def started(*args, **kwargs):
                record['selected'] = {**selected, 'apiPid': 999 if fault == 'foreign-descriptor' else child.pid}
                return child
            with self.subTest(fault=fault), patch.object(p, 'runtime', return_value=Path('/unused')), \
                patch.object(p.rma, 'listener', return_value=None), patch.object(p.ops, 'write'), \
                patch.object(p.subprocess, 'Popen', side_effect=started), patch.object(p.time, 'sleep'), \
                patch.object(p.ops, 'read', side_effect=lambda _: deepcopy(record['selected'])), \
                patch.object(p.ops, 'request', side_effect=RuntimeError('Synthetic not-ready response')), \
                patch.object(Path, 'open', return_value=io.BytesIO()):
                expected = p.KnownStoppedStartup if fault == 'clean' else p.rma.OwnedStartupIncomplete
                with self.assertRaises(expected) as caught: p.start_selected(selected, Path('/unused.log'))
                self.assertTrue(child.termination_requested)
                if fault == 'clean':
                    self.assertEqual(caught.exception.selected, {**selected, 'apiPid': 200})
                    self.assertEqual(caught.exception.child_pid, 200); self.assertTrue(child.stopped)


if __name__ == '__main__': main()
