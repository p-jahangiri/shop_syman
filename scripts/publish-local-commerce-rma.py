"""One guarded canonical D60 cutover: Sayman86/223 ->88/229 and both min88 UIs.

Importing performs no operation. Prepare is read-only except a new private plan.
Apply is explicit: package accepted bytes, stop only the three selected owned
writers, verify a private COPY_ONLY/CHECKSUM backup, migrate without seeding,
and immediately select all three compatible artifacts. Never Down/restore or
fall back to API/UI86 after the schema change. No business policy is applied.
"""
from collections import Counter
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
import re
import shutil
import signal
import subprocess
import time
import uuid


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


photo = load('commerce_rma_photo_primitives', 'publish_local_used_photos.py')
verify = load('commerce_rma_manifest_primitives', 'verify-local-business-release.py')
ops, runner = photo.ops, photo.runner
ROOT, CHECKS, AGGREGATE = photo.ROOT, photo.CHECKS, photo.AGGREGATE
from local_shop_ops import api_environment, snapshot, payload, sql, FINGERPRINT_SQL

KIND = 'commerce-rma-canonical88-plan'
MIGRATIONS = {('sales', '20261030190000_PostpaidShipping'), ('sales', '20261030200000_PrivateReturnRequests')}
NEW_TABLES = {'sales.' + name for name in ('RmaPolicyRevisions', 'RmaCases', 'RmaPolicyCommands', 'RmaCaseLines', 'RmaCaseEvents', 'RmaCaseCommands')}
CHANGED_TABLES = {'sales.CheckoutChargePolicies', 'sales.CheckoutQuotes', 'sales.Orders'}
DESCRIPTORS = {name: ROOT / f'tmp/{name}-runtime-current.json' for name in ('api', 'storefront', 'admin')}
PORTS = {'api': 5080, 'storefront': 3000, 'admin': 3173}
URLS = {name: f'http://127.0.0.1:{port}' for name, port in PORTS.items()}
POLICY = 'Compatible88 recovery only after cutover; never select86, SQL Down, restore or invent business policy.'
PENDING = {'shippingTaxPolicy': True, 'reservationAndOpenOrderSettings': True, 'returnRequestPolicy': True,
           'method': 'Normal authorized admin CAS; no raw SQL settings writes.'}
DEFAULTS = {'backendAcceptance': 'artifacts/checks/commerce-rma-backend/acceptance.json',
            'sqlProof': 'artifacts/checks/commerce-rma-sql-final/proof.json',
            'frontendAcceptance': 'artifacts/checks/commerce-rma-frontend-final/acceptance.json',
            'schemaContract': 'artifacts/checks/commerce-rma-backend/schema-contract.json',
            'frontendBuild': 'tmp/frontend-quality-build.json'}


def require(value, message):
    ops.require(value, message)


def stamp():
    return datetime.now(timezone.utc).isoformat()


def relative(path):
    return str(path.relative_to(ROOT))


def owned_path(value, parent=CHECKS):
    require(isinstance(value, str) and value and '..' not in Path(value).parts, 'Use an owned workspace-relative path.')
    return verify.workspace_path(value, parent)


def selection(values=None):
    selected = {**DEFAULTS, **(values or {})}
    require(set(selected) == set(DEFAULTS), 'Unexpected evidence selection field.')
    for key, value in selected.items():
        owned_path(value, ROOT / 'tmp' if key == 'frontendBuild' else CHECKS)
    return selected


def bind(record, captured):
    path = owned_path(record['path'])
    require(ops.sha(path) == record['sha256'], 'Accepted evidence changed.')
    captured[relative(path)] = record['sha256']
    return path


def command(path, captured):
    return photo.command(path, captured)


def command_record(record, captured, path_key='log', hash_key='logSha256'):
    return photo.command_record(record, captured, path_key, hash_key)


def positive_count(value):
    require(type(value) is int and value > 0, 'An exact positive discovered/executed case count is required.')
    return value


def verify_build_commands(backend, captured):
    projects = {'api': 'backend/src/Shop.Api', 'unit': 'backend/tests/Shop.Tests', 'sql': 'backend/tests/Shop.SqlTests'}
    require(set(backend['builds']) == set(projects), 'All three accepted build commands are required.')
    for name, project in projects.items():
        value = command(bind(backend['builds'][name], captured), captured)
        require(value['argv'] == ['dotnet', 'build', project, '--no-restore', '--disable-build-servers', '-m:1', '-v:minimal'], 'A build record selected a different project or command.')


def verify_unit_reuse(unit, frozen, current_reference, unit_command, captured):
    reused = unit.get('reusedFromRound3', False)
    require(type(reused) is bool, 'Unit reuse must be an explicit boolean.')
    require(unit_command['argv'][:3] == ['dotnet', 'test', 'backend/tests/Shop.Tests']
            and '--no-build' in unit_command['argv'] and '--filter' not in unit_command['argv']
            and not any(arg.startswith('--filter=') for arg in unit_command['argv']), 'The actual unit command must run the complete unit suite without rebuilding or filtering.')
    if not reused:
        require('reuseProof' not in unit, 'A reuse proof cannot be silently treated as a new unit run.')
        return
    proof = ops.read(bind(unit['reuseProof'], captured))
    artifacts = {name: digest for name, digest in frozen['testAssemblySha256'].items() if name.startswith('backend/tests/Shop.Tests/')}
    expected = {'backend/tests/Shop.Tests/bin/Debug/net10.0/' + name for name in ('Shop.Tests.dll', 'Shop.Tests.deps.json', 'Shop.Tests.runtimeconfig.json')}
    require(set(artifacts) == expected and proof.get('accepted') is True and proof.get('unitPassed') == unit['total']
            and type(proof.get('unitPassed')) is int and proof.get('module14parity') == frozen['module14parity']
            and proof.get('unitArtifacts') == artifacts
            and proof.get('unitTrx') == unit['trx']['path'] and proof.get('unitTrxSha256') == unit['trx']['sha256'], 'Reused units must bind the original TRX, all fourteen current modules and all three exact unit artifacts.')
    require(proof.get('currentFrozen') == current_reference and proof.get('previousFrozen') != current_reference, 'Unit reuse must explicitly bind distinct prior and current frozen records.')
    require(ops.read(bind(proof['currentFrozen'], captured)) == frozen, 'Current reuse frozen contents differ.')
    previous = ops.read(bind(proof['previousFrozen'], captured))
    prior_acceptance = ops.read(bind(proof['previousAcceptedBackend'], captured))
    require(prior_acceptance.get('status') == 'backend-frozen-targeted-accepted' and prior_acceptance.get('frozen') == proof['previousFrozen']
            and prior_acceptance.get('module14parity') == previous['module14parity']
            and prior_acceptance.get('testAssemblySha256') == previous['testAssemblySha256']
            and prior_acceptance['unit']['trx'] == unit['trx'] and prior_acceptance['unit']['command'] == unit['command']
            and prior_acceptance['unit']['total'] == unit['total'] and prior_acceptance['unit']['failed'] == prior_acceptance['unit']['skipped'] == 0,
            'The previous backend acceptance must bind the actual original passing unit command/TRX without a claimed rerun.')
    old_artifacts = {name: digest for name, digest in previous['testAssemblySha256'].items() if name.startswith('backend/tests/Shop.Tests/')}
    delta = sorted(name for name in set(previous['sourceSha256']) | set(frozen['sourceSha256']) if previous['sourceSha256'].get(name) != frozen['sourceSha256'].get(name))
    require(previous['module14parity'] == frozen['module14parity'] and old_artifacts == artifacts and bool(delta)
            and proof.get('sourceDelta') == delta and all(name.startswith('backend/tests/Shop.SqlTests/') and '..' not in Path(name).parts for name in delta),
            'Unit reuse permits only the exact proven SQL-test source delta; product and unit inputs must be unchanged.')


def wire_kind(meta, body):
    path, method = meta['path'], meta['method']
    for suffix, kind, version in (('/quote', 'quote3', 3), ('/v2/quote', 'quote4', 4), ('/v2/order-quote', 'quote5', 5)):
        if re.fullmatch(r'/api/cart/(fa|en)' + suffix, path):
            require(method == 'POST' and body.get('schemaVersion') == version, 'Quote wire route/method/version differs.'); return kind, None
    if method == 'POST' and path in ('/api/orders', '/api/orders/v2'):
        kind, order = ('create1' if path == '/api/orders' else 'create2'), body.get('order')
    elif method == 'GET' and re.fullmatch('/api/orders/v2/[a-f0-9]{32}', path): kind, order = 'history2', body
    elif method == 'GET' and re.fullmatch('/api/orders/[a-f0-9]{32}', path): kind, order = 'history1', body
    else: raise ops.PublishError('Unexpected route in the accepted commerce wire manifest.')
    require(isinstance(order, dict) and isinstance(order.get('summary'), dict), 'A complete order wire is required.')
    if kind in ('create2', 'history2'): require(order.get('schemaVersion') == 2 and order.get('originalSnapshotVersion') in (1, 2), 'Order2 wire version differs.')
    return kind, order


def verify_commerce_wires(reference, captured):
    path = bind(reference, captured); report = ops.read(path)
    kinds = {'quote3', 'quote4', 'quote5', 'create1', 'create2', 'history1', 'history2'}
    require(report.get('syntheticQaOnly') is True and type(report.get('passed')) is int and report['passed'] == 60
            and isinstance(report.get('sha256'), dict) and len(report['sha256']) == report['passed']
            and set(report.get('counts', {})) == kinds and all(type(n) is int and n > 0 for n in report['counts'].values())
            and all(type(report.get(key)) is int and report[key] > 0 for key in ('unitemizedOrders', 'postpaidOrders', 'knownHistoricalOrders'))
            and sum(report['counts'].values()) == report['passed'], 'The accepted sixty-response commerce wire coverage/counters are incomplete.')
    counts = Counter(); unitemized = postpaid = known = 0
    for name, digest in report['sha256'].items():
        require(isinstance(name, str) and re.fullmatch('[a-f0-9]{32}\\.json', name) and isinstance(digest, str) and re.fullmatch('[a-f0-9]{64}', digest), 'Use bounded synthetic wire filenames and SHA256 hashes.')
        body_path = owned_path(relative(path.parent / name)); meta_path = owned_path(relative(path.parent / (name[:-5] + '.meta.json')))
        require(body_path.stat().st_size <= 1048576 and meta_path.stat().st_size <= 16384 and ops.sha(body_path) == digest, 'Commerce wire body bytes or bounds differ.')
        captured[relative(body_path)] = digest; captured[relative(meta_path)] = ops.sha(meta_path)
        meta, body = ops.read(meta_path), ops.read(body_path)
        require(meta.get('actualSqlHttpResponse') is True and meta.get('syntheticQaOnly') is True
                and type(meta.get('status')) is int and 200 <= meta['status'] < 300, 'Only successful actual synthetic SQL HTTP responses may be accepted.')
        kind, order = wire_kind(meta, body); counts[kind] += 1
        if order is not None:
            if order.get('taxBreakdownKnown') is False:
                require('taxRial' in order and order['taxRial'] is None and order.get('taxIncluded') is True, 'Unknown included tax must remain explicit null.'); unitemized += 1
            else: known += 1
            if order.get('shippingMode') == 'postpaid':
                require(order.get('shippingRequired') is True and order.get('shippingRial') == '0', 'Postpaid history must disclose zero merchant collection for physical delivery.'); postpaid += 1
    require(dict(counts) == report['counts'] and unitemized == report.get('unitemizedOrders') and known == report.get('knownHistoricalOrders')
            and postpaid == report.get('postpaidOrders') and min(unitemized, known, postpaid) > 0, 'Commerce wire route/disclosure counters differ from the hashed actual bodies.')


def verify_schema_capture(contract, target, names, captured):
    require(contract.get('metadataSqlSource') == {'path': relative(Path(__file__).resolve()), 'sqlStringSha256': hashlib.sha256(METADATA_SQL.encode()).hexdigest()}, 'Schema capture used different metadata SQL.')
    raw = ops.read(bind(contract['capture'], captured))
    require(isinstance(raw, list) and len(raw) == 9 and table_map(raw) == table_map(contract['changedTablesMetadata'] + contract['newTablesMetadata']), 'The exact nine captured metadata tables differ from the accepted contract.')
    for row in raw:
        require(all(isinstance(row.get(key), list) for key in ('columns', 'indexes', 'foreignKeys', 'checks')), 'Captured metadata arrays may not be omitted.')
    fact = 'Shop.SqlTests.CommerceRmaSchemaSqlTests.FullyMigratedSchema88HasNoModelDriftAndExportsExactNinePortableTablesWithTrustedChecks'
    require(contract.get('testResult') == target['trx'] and Counter(names)[fact] == 1, 'Schema provenance must bind the exact passing targeted TRX and schema capture fact.')
    bind(contract['testResult'], captured)


def accepted_evidence(values=None):
    chosen, captured = selection(values), {}
    backend_path = owned_path(chosen['backendAcceptance']); backend = ops.read(backend_path)
    captured[relative(backend_path)] = ops.sha(backend_path)
    require(backend['status'] == 'backend-frozen-targeted-accepted'
            and all(backend.get(key) is True for key in ('commerceChargePolicyAccepted', 'privateReturnRequestsAccepted',
                     'privateAdminHeadersAccepted', 'physicalFulfillmentCapacityAccepted', 'customerLoginContinuityAccepted')),
            'Fresh explicit D60 backend and retained business-feature acceptances are required.')
    frozen = ops.read(bind(backend['frozen'], captured))
    require(runner.freeze('Debug') == frozen and backend['module14parity'] == frozen['module14parity']
            and backend['testAssemblySha256'] == frozen['testAssemblySha256'], 'Frozen backend source/modules/tests changed.')
    modules = {name: row['api'] for name, row in frozen['module14parity'].items()}
    require(len(modules) == 14 and 'Shop.Api.dll' in modules and all(
        Path(name).name == name and re.fullmatch('[a-f0-9]{64}', value)
        and frozen['module14parity'][name] == {'api': value, 'unit': value, 'sql': value}
        for name, value in modules.items()), 'Exact fourteen-module API/unit/SQL parity is required.')
    require({path.name for path in ops.API_BIN.glob('Shop.*.dll')} == set(modules), 'Unexpected product module file identity in the API package.')
    verify_build_commands(backend, captured)
    unit = backend['unit']; unit_count = positive_count(unit['total'])
    require(unit['failed'] == unit['skipped'] == 0, 'Complete passing unit evidence is required.')
    ops.accepted_trx(bind(unit['trx'], captured), unit_count); unit_command = command(bind(unit['command'], captured), captured)
    verify_unit_reuse(unit, frozen, backend['frozen'], unit_command, captured)
    target = backend['sql']; target_count = positive_count(target['targetedCaseCount'])
    require(target['failed'] == target['skipped'] == 0 and target['exactDiscoveryTrxCounter'] is True, 'Targeted SQL evidence is incomplete.')
    names = ops.accepted_trx(bind(target['trx'], captured), target_count)
    result = ops.read(bind(target['results'], captured)); command_record(result['command'], captured, 'path', 'sha256')
    plan = ops.read(bind(target['plan'], captured))
    require(plan['frozen'] == frozen and Counter(names) == Counter(plan['selectedNames']) == Counter(result['trx']['names']),
            'Targeted discovery, frozen inputs and TRX differ.')
    command_record(target['cleanupAfter'], captured, 'path', 'sha256')
    require(target['cleanupAfter']['disposableDatabasesRemaining'] == 0, 'Targeted fixtures were not cleaned.')
    full_path = owned_path(chosen['sqlProof']); full = ops.read(full_path); captured[relative(full_path)] = ops.sha(full_path)
    count = positive_count(full['total'])
    require(full['status'] == 'passed' and full['acceptanceMode'] == 'complete-class-batches'
            and all(full[key] is True for key in ('fullSuite', 'fullCoverage', 'exactDiscoveryExecutionMatch',
                     'allSelectedClassCasesIncluded', 'sourceUnchanged', 'module14Unchanged'))
            and count == full['expectedCount'] == full['executedCount'] == full['passed'] == target['fullDiscoveryCount']
            and full['failed'] == full['skipped'] == full['disposableDatabasesRemaining'] == 0
            and all(full[key] == value for key, value in frozen.items()), 'Fresh complete-class SQL coverage differs from the frozen discovery.')
    full_plan_path = owned_path(full['plan']); require(ops.sha(full_plan_path) == full['planSha256'], 'Full SQL plan changed.')
    captured[relative(full_plan_path)] = ops.sha(full_plan_path); full_plan = ops.read(full_plan_path)
    require(full_plan['runId'] == full['runId'] and full_plan['frozen'] == frozen
            and full_plan['batches'] == runner.plan_batches(full_plan['discovery']['names'], full_plan['targetCases']), 'Full classes were split or omitted.')
    discovery = full['discovery']; raw = owned_path(discovery['path'])
    require(discovery == full_plan['discovery'] and discovery['fullSuite'] is True and discovery['filterApplied'] is False
            and ops.sha(raw) == discovery['sha256'] and len(discovery['names']) == count
            and Counter(runner.parse_discovery(raw.read_text())) == Counter(discovery['names']), 'Unfiltered raw SQL discovery differs.')
    discovered = command_record(discovery, captured, 'path', 'sha256')
    require(discovered['argv'][1:] == [str(ROOT / 'scripts/test-sql-local.py'), '--no-build', '--configuration', 'Debug', '--list-tests', '--', 'xUnit.MaxParallelThreads=1'], 'Unexpected discovery command.')
    batches = runner.verified_prefix(full_plan, full, full_plan_path); require(len(batches) == len(full_plan['batches']), 'Incomplete full SQL prefix.')
    executed = []
    for batch, planned in zip(batches, full_plan['batches']):
        run = command_record(batch, captured); trx = owned_path(batch['trx']); captured[relative(trx)] = ops.sha(trx)
        require(run['argv'][1:] == [str(ROOT / 'scripts/test-sql-local.py'), '--no-build', '--configuration', 'Debug', '--filter', planned['filter'], '--logger', 'trx;LogFileName=batch.trx', '--results-directory', str(trx.parent), '--', 'xUnit.MaxParallelThreads=1'], 'Unexpected batch execution command.')
        clean = command_record(batch['cleanup'], captured, 'path', 'sha256')
        require(clean['argv'][1:] == [str(ROOT / 'scripts/verify-sql-test-cleanup.py')], 'Unexpected cleanup command.')
        executed.extend(batch['names'])
    require(len(executed) == count and Counter(executed) == Counter(discovery['names'])
            and dict(Counter(executed)) == full['caseCounter'], 'Each discovered SQL case must execute exactly once.')
    final = full['finalCleanup']; clean = command_record(final, captured, 'path', 'sha256')
    require(final['disposableDatabasesRemaining'] == 0 and clean['argv'][1:] == [str(ROOT / 'scripts/verify-sql-test-cleanup.py')], 'Final fixture cleanup is not zero.')
    frontend_path, build_path = owned_path(chosen['frontendAcceptance']), owned_path(chosen['frontendBuild'], ROOT / 'tmp')
    frontend, build = ops.read(frontend_path), ops.read(build_path)
    captured.update({relative(frontend_path): ops.sha(frontend_path), relative(build_path): ops.sha(build_path)})
    require(frontend['sourceFrozen'] is True and build['passed'] is True and build['sourceStableDuringBuild'] is True
            and build['apiMinimumMigrationCount'] == 88 and set(build['targets']) == {'storefront', 'admin'}, 'Both freshly accepted UIs must require API88.')
    photo.verify_frontend_sources(frontend, build)
    require(set(frontend['checks']) == {'fullStorefront', 'fullAdmin', 'storefrontTypeScript', 'adminTypeScript', 'globalEslint', 'globalPrettier'}
            and len(frontend['logSha256']) >= 6 and all(row['exitCode'] == 0 for row in frontend['checks'].values()), 'Complete UI acceptance is required.')
    for name, digest in frontend['logSha256'].items():
        path = frontend_path.parent / name; require(Path(name).name == name and ops.sha(path) == digest, 'UI acceptance log changed.'); captured[relative(path)] = digest
    for check in [*frontend['checks'].values(), frontend['adminProxy']]:
        require(check['exitCode'] == 0, 'An accepted frontend command failed.'); command_record(check['command'], captured, 'path', 'sha256')
    schema_path = owned_path(chosen['schemaContract'])
    require(backend.get('schemaContract') == {'path': relative(schema_path), 'sha256': ops.sha(schema_path)}, 'Backend acceptance must bind the disposable-fixture schema contract.')
    captured[relative(schema_path)] = ops.sha(schema_path); contract = ops.read(schema_path)
    validate_contract(contract, frozen)
    verify_schema_capture(contract, target, names, captured)
    verify_commerce_wires(backend['commerceWireContracts'], captured)
    return {'selection': chosen, 'files': captured, 'modules': modules, 'frozen': frozen, 'frozenRecord': backend['frozen'],
            'unitPassed': unit_count, 'targetedSqlPassed': target_count, 'fullSqlPassed': count,
            'frontendBuild': build, 'schemaContract': contract, 'unitReusedFromRound3': unit.get('reusedFromRound3', False), 'unitActualCommand': unit['command']}


def table_map(rows):
    result = {row['schema'] + '.' + row['table']: row for row in rows}
    require(len(result) == len(rows), 'Duplicate table evidence is forbidden.')
    return result


def validate_contract(contract, frozen):
    require(contract.get('schemaVersion') == 1 and contract.get('status') == 'disposable-schema88-accepted'
            and contract.get('frozen') == frozen and contract.get('sourceMigrationCount') == 88
            and set(table_map(contract['newTablesMetadata'])) == NEW_TABLES
            and set(table_map(contract['changedTablesMetadata'])) == CHANGED_TABLES,
            'An accepted source-bound fixture schema88 metadata contract is required.')


def source_migrations():
    values = set()
    for path in (ROOT / 'backend/src/Shop.Api/Migrations').rglob('*.cs'):
        for name in re.findall(r'\[Migration\("([0-9A-Za-z_]+)"\)\]', path.read_text()):
            item = (path.parent.name.lower(), name); require(item not in values, 'Duplicate source migration.'); values.add(item)
    require(len(values) == 88 and MIGRATIONS <= values, 'Exactly the frozen88 source migrations are required.')
    return values


def histories(rows):
    result = {(row['schema'], row['MigrationId'], row['ProductVersion']) for row in rows}
    require(len(result) == len(rows), 'Duplicate migration history evidence.')
    return result


def pending(before):
    applied = {(row['schema'], row['MigrationId']) for row in before['histories']}
    require(len(applied) == 86 and source_migrations() - applied == MIGRATIONS and applied <= source_migrations(), 'Only Sales87 and88 may be pending.')


# This portable structured metadata deliberately uses referenced table/column
# names rather than object IDs, so accepted GUID-fixture88 metadata binds main.
METADATA_SQL = r"""SELECT SCHEMA_NAME(t.schema_id) [schema],t.name [table],
 JSON_QUERY(COALESCE((SELECT c.name,c.column_id,c.system_type_id,c.user_type_id,c.max_length,c.precision,c.scale,c.is_nullable,c.collation_name,c.is_identity,c.is_computed,cc.definition computedDefinition,dc.definition defaultDefinition
 FROM sys.columns c LEFT JOIN sys.computed_columns cc ON cc.object_id=c.object_id AND cc.column_id=c.column_id LEFT JOIN sys.default_constraints dc ON dc.object_id=c.default_object_id WHERE c.object_id=t.object_id ORDER BY c.column_id FOR JSON PATH,INCLUDE_NULL_VALUES),N'[]')) columns,
 JSON_QUERY(COALESCE((SELECT i.name,i.index_id,i.type,i.is_unique,i.is_primary_key,i.is_unique_constraint,i.has_filter,i.filter_definition,i.is_disabled,ic.index_column_id,c.name columnName,ic.key_ordinal,ic.is_descending_key,ic.is_included_column
 FROM sys.indexes i LEFT JOIN sys.index_columns ic ON i.object_id=ic.object_id AND i.index_id=ic.index_id LEFT JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id WHERE i.object_id=t.object_id ORDER BY i.index_id,ic.index_column_id FOR JSON PATH,INCLUDE_NULL_VALUES),N'[]')) indexes,
 JSON_QUERY(COALESCE((SELECT f.name,OBJECT_SCHEMA_NAME(f.referenced_object_id) referencedSchema,OBJECT_NAME(f.referenced_object_id) referencedTable,f.delete_referential_action,f.update_referential_action,f.is_disabled,f.is_not_trusted,fc.constraint_column_id,pc.name parentColumn,rc.name referencedColumn
 FROM sys.foreign_keys f JOIN sys.foreign_key_columns fc ON f.object_id=fc.constraint_object_id JOIN sys.columns pc ON pc.object_id=fc.parent_object_id AND pc.column_id=fc.parent_column_id JOIN sys.columns rc ON rc.object_id=fc.referenced_object_id AND rc.column_id=fc.referenced_column_id WHERE f.parent_object_id=t.object_id ORDER BY f.name,fc.constraint_column_id FOR JSON PATH,INCLUDE_NULL_VALUES),N'[]')) foreignKeys,
 JSON_QUERY(COALESCE((SELECT c.name,c.definition,c.is_disabled,c.is_not_trusted FROM sys.check_constraints c WHERE c.parent_object_id=t.object_id ORDER BY c.name FOR JSON PATH,INCLUDE_NULL_VALUES),N'[]')) checks
 FROM sys.tables t WHERE t.is_ms_shipped=0 ORDER BY [schema],[table] FOR JSON PATH;"""


def database_snapshot():
    value = snapshot()
    needle = 'FROM sys.columns WHERE object_id=@object;'
    require(FINGERPRINT_SQL.count(needle) == 1, 'Original fingerprint SQL contract changed.')
    value['tables'] = payload(FINGERPRINT_SQL.replace(needle, "FROM sys.columns WHERE object_id=@object AND NOT (@schema=N'sales' AND @table=N'Orders' AND name=N'TaxBreakdownKnown');"))
    value['metadata'] = payload(METADATA_SQL)
    value['legacyUnknownTaxRows'] = payload("DECLARE @n bigint=0;IF COL_LENGTH(N'sales.Orders',N'TaxBreakdownKnown') IS NOT NULL EXEC sys.sp_executesql N'SELECT @x=COUNT_BIG(*) FROM [sales].[Orders] WHERE [TaxBreakdownKnown]<>1',N'@x bigint OUTPUT',@x=@n OUTPUT;SELECT @n [count] FOR JSON PATH,WITHOUT_ARRAY_WRAPPER;")['count']
    return value


def preserved_metadata(before_rows, after_rows, contract):
    old, new = table_map(before_rows), table_map(after_rows)
    require(len(old) == 223 and len(new) == 229 and set(new) - set(old) == NEW_TABLES, 'Unexpected metadata table delta.')
    approved = table_map(contract['changedTablesMetadata']); added = table_map(contract['newTablesMetadata'])
    require(all(new[name] == row for name, row in added.items()), 'New RMA metadata differs from accepted fixture88.')
    allowed_checks = {'sales.CheckoutChargePolicies': {'CK_ChargePolicy_Shipping', 'CK_ChargePolicy_Tax'},
                      'sales.CheckoutQuotes': set(), 'sales.Orders': {'CK_Order_Amounts', 'CK_Order_TaxDisclosure'}}
    for name, row in old.items():
        current = new[name]
        if name not in CHANGED_TABLES:
            require(row == current, 'An unrelated original table metadata changed.'); continue
        require(current == approved[name], 'Changed table differs from accepted exact fixture metadata.')
        require(row['indexes'] == current['indexes'] and row['foreignKeys'] == current['foreignKeys'], 'Existing indexes/FKs must remain identical.')
        prior, after = {c['name']: c for c in row['columns']}, {c['name']: c for c in current['columns']}
        require(set(after) - set(prior) == ({'TaxBreakdownKnown'} if name == 'sales.Orders' else set()), 'Unexpected original-column addition/removal.')
        for key, column in prior.items():
            wanted = dict(column)
            if name in {'sales.CheckoutChargePolicies', 'sales.CheckoutQuotes'} and key == 'TaxMode':
                require(column['max_length'] == 16, 'Original TaxMode must be varchar16.'); wanted['max_length'] = 24
            if name == 'sales.Orders' and key == 'TaxRial':
                require(column['is_nullable'] is False, 'Original TaxRial must be nonnullable.'); wanted['is_nullable'] = True
            require(after.get(key) == wanted, 'An unapproved original-column metadata field changed.')
        if name == 'sales.Orders':
            flag = after['TaxBreakdownKnown']; require(flag['system_type_id'] == flag['user_type_id'] == 104 and flag['max_length'] == 1
                and flag['is_nullable'] is False and flag['is_identity'] is False and flag['is_computed'] is False
                and flag['column_id'] == max(c['column_id'] for c in prior.values()) + 1 and flag['defaultDefinition'] is not None,
                'The sole appended order field must be nonnullable bit with the accepted DEFAULT1 definition.')
            require(re.sub(r'[\s()\[\]]', '', flag['defaultDefinition']).lower() in {'1', 'convertbit,1', 'cast1asbit'}, 'The new flag must explicitly default to true; unknown/false defaults are forbidden.')
        old_checks, new_checks = {c['name']: c for c in row['checks']}, {c['name']: c for c in current['checks']}
        require(set(new_checks) - set(old_checks) == ({'CK_Order_TaxDisclosure'} if name == 'sales.Orders' else set())
                and set(old_checks) <= set(new_checks), 'Unexpected CHECK addition/removal.')
        require(all(new_checks.get(key) == check for key, check in old_checks.items() if key not in allowed_checks[name]), 'An unrelated CHECK changed.')
        require(all(c['is_disabled'] is False and c['is_not_trusted'] is False for c in current['checks']), 'All resulting CHECKs must remain enabled and trusted.')


def preserved_database(before, after, contract):
    require(before['database'] == after['database'] == 'Sayman', 'Only canonical Sayman may be compared.')
    old, new = table_map(before['tables']), table_map(after['tables'])
    require(len(old) == 223 and len(new) == 229 and set(new) - set(old) == NEW_TABLES
            and all(new[name]['count'] == 0 for name in NEW_TABLES), 'Only six initially empty RMA tables may be added.')
    require(all(new.get(name) == row for name, row in old.items() if name != 'sales.__EFMigrationsHistory'),
            'An old business value, rowversion or JSON changed; only the new default flag is excluded from the row projection.')
    a, b = histories(before['histories']), histories(after['histories'])
    require(len(a) == 86 and len(b) == 88 and a <= b and {(s, m) for s, m, _ in b - a} == MIGRATIONS, 'Unexpected migration history delta.')
    require(before['configuration'] == after['configuration'] and before['legacyUnknownTaxRows'] == after['legacyUnknownTaxRows'] == 0,
            'Keys/configuration or original known-tax flags changed.')
    preserved_metadata(before['metadata'], after['metadata'], contract)


def shape():
    value = payload('SELECT (SELECT SUM(n) FROM (' + ' UNION ALL '.join('SELECT COUNT_BIG(*) n FROM [' + name + '].__EFMigrationsHistory' for name in ops.SCHEMAS) + ') h) migrationCount,(SELECT COUNT(*) FROM sys.tables WHERE is_ms_shipped=0) tableCount FOR JSON PATH,WITHOUT_ARRAY_WRAPPER')
    require(value in ({'migrationCount': 86, 'tableCount': 223}, {'migrationCount': 87, 'tableCount': 223}, {'migrationCount': 88, 'tableCount': 229}), 'Unexpected canonical schema; preserve state and recover forward.')
    return value


def runtime(name, state):
    require(name in PORTS and state.get('api') == URLS['api']
            and state.get('sourceMigrationCount') == state.get('databaseMigrationCount')
            and (state['databaseMigrationCount'], state.get('tableCount')) in ((86, 223), (88, 229)), 'Unexpected canonical runtime descriptor.')
    directory, _, _ = verify.manifest(state, name)
    if name == 'api':
        require(len(state['moduleSha256']) == 14 and all(ops.sha(directory / key) == digest for key, digest in state['moduleSha256'].items()), 'Selected API module hashes changed.')
    return directory


def listener(name):
    result = subprocess.run(['lsof', '-nP', '-tiTCP:' + str(PORTS[name]), '-sTCP:LISTEN'], capture_output=True, text=True, timeout=10)
    values = set(result.stdout.split()); require(result.returncode in {0, 1} and len(values) <= 1 and all(v.isdecimal() for v in values), 'Unexpected canonical listeners.')
    return int(next(iter(values))) if values else None


def owned_process(name, state):
    directory = runtime(name, state); pid = state['apiPid' if name == 'api' else 'pid' if name == 'storefront' else 'adminPid']
    require(type(pid) is int and pid > 1 and listener(name) == pid, 'Selected canonical process identity changed.')
    command_line = subprocess.check_output(['ps', '-p', str(pid), '-o', 'command='], text=True, timeout=10).strip()
    cwd = subprocess.check_output(['lsof', '-a', '-p', str(pid), '-d', 'cwd', '-Fn'], text=True, timeout=10).splitlines()
    started = subprocess.check_output(['ps', '-p', str(pid), '-o', 'lstart='], text=True, timeout=10).strip()
    wanted = directory / 'apps/storefront' if name == 'storefront' else ROOT
    valid = command_line == 'dotnet ' + str(directory / 'Shop.Api.dll') if name == 'api' else 'next-server' in command_line if name == 'storefront' else 'scripts/serve-main-admin.mjs' in command_line
    require(valid and 'n' + str(wanted) in cwd and started, 'Process command/cwd/start identity differs from its selected artifact.')
    return {'pid': pid, 'command': command_line, 'started': started}


def stop_owned(name, state, expected):
    require(owned_process(name, state) == expected, 'Process ownership changed immediately before stop.')
    os.kill(expected['pid'], signal.SIGTERM); deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        if listener(name) is None:
            try: os.kill(expected['pid'], 0)
            except ProcessLookupError: return
        time.sleep(.25)
    raise ops.PublishError('Owned process did not stop; no forced termination or SQL operation is allowed.')


def helper_hashes():
    names = ('publish-local-commerce-rma.py', 'test_publish_local_commerce_rma.py', 'publish_local_used_photos.py',
             'publish-local-frontends.py', 'publish-local-media-backend.py', 'local_shop_ops.py', 'test-sql-batches.py',
             'serve-main-api.py', 'serve-main-storefront.py', 'serve-main-admin.mjs', 'verify-local-business-release.py', 'verify-commerce-policy-wire.mts')
    return {relative(ROOT / 'scripts' / name): ops.sha(ROOT / 'scripts' / name) for name in names}


def build_inputs(build):
    paths = {'standalone': owned_path(build['nextDirectory'], ROOT / 'apps/storefront') / 'standalone',
             'static': owned_path(build['nextDirectory'], ROOT / 'apps/storefront') / 'static',
             'public': ROOT / 'apps/storefront/public', 'admin': owned_path(build['adminDirectory'], ROOT / 'tmp')}
    result = {key: {'path': relative(path), 'files': photo.tree(path)} for key, path in paths.items()}
    result['adminProxy'] = {'path': 'apps/admin/server.mjs', 'sha256': ops.sha(ROOT / 'apps/admin/server.mjs')}
    build_id = owned_path(build['nextDirectory'], ROOT / 'apps/storefront') / 'BUILD_ID'
    result['buildId'] = {'sha256': ops.sha(build_id), 'value': build_id.read_text().strip()}
    return result


def prepare(values=None):
    accepted = accepted_evidence(values); source_migrations()
    require(shape() == {'migrationCount': 86, 'tableCount': 223}, 'Read-only prepare requires canonical86/223.')
    previous, processes, descriptor_hashes = {}, {}, {}
    for name, path in DESCRIPTORS.items():
        state = ops.read(path); require(state.get('databaseMigrationCount') == 86 and state.get('tableCount') == 223, 'All three previous runtimes must be finalized86.')
        previous[name], processes[name], descriptor_hashes[name] = state, owned_process(name, state), ops.sha(path)
    aggregate = ops.read(AGGREGATE)
    require(aggregate.get('database') == 'Sayman' and aggregate.get('databaseMigrationCount') == 86
            and aggregate.get('tableCount') == 223 and aggregate.get('canonicalUrls') == URLS, 'Aggregate must identify only the canonical86 shop.')
    pending(snapshot())
    return {'schemaVersion': 1, 'kind': KIND, 'runId': uuid.uuid4().hex, 'preparedAtUtc': stamp(), 'readOnlyPrepared': True,
            'accepted': accepted, 'helpers': helper_hashes(), 'previous': previous, 'processes': processes,
            'descriptorSha256': descriptor_hashes, 'aggregate': aggregate, 'aggregateSha256': ops.sha(AGGREGATE),
            'preservedFiles': photo.preserved_files(), 'space': photo.measured_space(),
            'apiFiles': photo.tree(ops.API_BIN), 'frontendInputs': build_inputs(accepted['frontendBuild']),
            'rollbackPolicy': POLICY, 'policyConfigurationPending': PENDING}


def retain(source, target):
    retained = photo.tree(source)
    for name, digest in retained.items():
        file = target / name
        if file.exists(): require(ops.sha(file) == digest, 'Retained frontend asset collision.')
        else: file.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(source / name, file)
    return retained


def copy_projection(source, target, prepared):
    shutil.copytree(source, target, dirs_exist_ok=True)
    require(photo.tree(target) == prepared['files'], 'Copied frontend projection differs from its prepared accepted bytes.')


def api_release_fields(accepted):
    return {'apiPid': None, 'moduleSha256': accepted['modules'], 'healthCheckPassed': False, 'mainSeedPerformed': False,
            'codeOnly': False, 'newMigrations': 2, 'newTables': 6, 'unitPassed': accepted['unitPassed'],
            'fullSqlPassed': accepted['fullSqlPassed'], 'sqlPassed': accepted['fullSqlPassed'],
            'sqlAcceptanceMode': 'complete-class-batches', 'fullSqlSingleRunPassed': False}


def package(plan, report_path):
    candidates = {}; run = plan['runId']; build = plan['accepted']['frontendBuild']
    for name in ('api', 'storefront', 'admin'):
        directory = ROOT / 'tmp' / (name + '-runtime-commerce-rma-' + run); require(not directory.exists(), 'Candidate runtime already exists.')
        old = runtime(name, plan['previous'][name]); state = {**plan['previous'][name], 'sourceMigrationCount': 88, 'databaseMigrationCount': 88, 'tableCount': 229,
            'runtimeDirectory': relative(directory), 'previousRuntimeDirectory': plan['previous'][name]['runtimeDirectory'],
            'slice': 'D60 commerce policy and private return requests', 'localReleaseEvidence': relative(report_path), 'fullProjectComplete': False,
            'commerceRmaAccepted': False, 'commerceRmaRecoveryRequired': False, 'policyConfigurationPending': PENDING}
        if name != 'api': state.update(apiMinimumMigrationCount=88, frontendBuildRun=build['run'])
        if name == 'api':
            shutil.copytree(ops.API_BIN, directory); require(photo.tree(directory) == plan['apiFiles'], 'API copy differs from prepared bytes.')
            state.update(api_release_fields(plan['accepted']))
            manifest = {'algorithm': 'SHA-256', 'files': photo.tree(directory)}
        elif name == 'storefront':
            next_dir = owned_path(build['nextDirectory'], ROOT / 'apps/storefront'); dist = next_dir.name
            copy_projection(next_dir / 'standalone', directory, plan['frontendInputs']['standalone']); app = directory / 'apps/storefront'
            copy_projection(next_dir / 'static', app / dist / 'static', plan['frontendInputs']['static']); copy_projection(ROOT / 'apps/storefront/public', app / 'public', plan['frontendInputs']['public'])
            retained = retain(old / 'apps/storefront' / state['distDirectory'] / 'static', app / dist / 'static')
            state.update(pid=None, distDirectory=dist, buildId=plan['frontendInputs']['buildId']['value'], serverSha256=ops.sha(app / 'server.js'), browserAcceptancePending=True, retainedPriorAssets=retained)
            manifest = {'runtimeDirectory': relative(directory), 'artifacts': photo.tree(directory), 'retainedPriorAssets': retained}
        else:
            copy_projection(owned_path(build['adminDirectory'], ROOT / 'tmp'), directory, plan['frontendInputs']['admin']); shutil.copy2(ROOT / 'apps/admin/server.mjs', directory / 'server.mjs')
            require(ops.sha(directory / 'server.mjs') == plan['frontendInputs']['adminProxy']['sha256'], 'Copied admin proxy differs from accepted bytes.')
            retained = retain(old / 'assets', directory / 'assets')
            state.update(adminPid=None, proxyModuleSha256=ops.sha(directory / 'server.mjs'))
            state['retainedPriorAssets'] = retained
            manifest = {'runtimeDirectory': relative(directory), 'artifacts': photo.tree(directory), 'retainedPriorAssets': retained}
        path = CHECKS / (directory.name + '-artifacts.json'); require(not path.exists(), 'Candidate manifest already exists.'); ops.write(path, manifest)
        state.update(artifactManifest=relative(path), artifactManifestSha256=ops.sha(path)); runtime(name, state); candidates[name] = state
    return candidates


def verified_backup(run, preserved):
    require(re.fullmatch('[a-f0-9]{32}', run), 'Invalid backup identity.'); capacity = photo.measured_space()
    directory = ROOT / 'tmp/local-backups' / ('commerce-rma-' + run); directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    for source, target in ((ROOT / '.env', directory / 'environment.private'), (ROOT / 'tmp/identity-keys', directory / 'identity-keys'),
                           (ROOT / 'tmp/public-media-local.json', directory / 'public-media-local.private.json'), (photo.MEDIA, directory / 'public-media-objects')):
        photo.private_copy(source, target)
    require(photo.preserved_files() == preserved, 'Private configuration, keys or media changed during stopped backup.')
    remote = '/var/opt/mssql/data/commerce-rma-' + run + '.bak'
    sql("BACKUP DATABASE [Sayman] TO DISK=N'" + remote + "' WITH COPY_ONLY,CHECKSUM; RESTORE VERIFYONLY FROM DISK=N'" + remote + "' WITH CHECKSUM;", timeout=180)
    checked = subprocess.run(['docker', 'compose', '--profile', 'backend', 'exec', '-T', 'sqlserver', 'sha256sum', remote], cwd=ROOT, capture_output=True, text=True, timeout=30)
    digest = checked.stdout.split()[0] if checked.stdout.split() else ''; require(checked.returncode == 0 and re.fullmatch('[a-f0-9]{64}', digest), 'Remote backup hash is unavailable.')
    subprocess.run(['docker', 'compose', '--profile', 'backend', 'cp', 'sqlserver:' + remote, str(directory / 'Sayman.bak')], cwd=ROOT, check=True, capture_output=True, timeout=180)
    backup = directory / 'Sayman.bak'; backup.chmod(0o600); require(backup.stat().st_size > 0 and ops.sha(backup) == digest, 'Copied backup bytes differ; retain both copies.')
    subprocess.run(['docker', 'compose', '--profile', 'backend', 'exec', '-T', 'sqlserver', 'rm', '--', remote], cwd=ROOT, check=True, capture_output=True, timeout=20)
    proof = {'passed': True, 'database': 'Sayman', 'sourceSchema': 86, 'privateDirectory': relative(directory), 'backupSha256': digest,
             'backupBytes': backup.stat().st_size, 'copyOnly': True, 'checksumVerifyOnly': True, 'localRemoteSha256Equal': True,
             'privateEnvironmentKeysAndMediaCopied': True, 'offsiteOrRestoreAccepted': False, 'measuredCapacity': capacity}
    ops.write(directory / 'backup-proof.json', proof, private=True); return proof


class Assets(HTMLParser):
    def __init__(self): super().__init__(); self.paths = set()
    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key in ('href', 'src') and value and value.startswith(('/assets/', '/_next/static/')): self.paths.add(value)


def smoke(name, state):
    paths = ('/health/ready', '/health/live') if name == 'api' else ('/fa', '/en/market', '/fa/account') if name == 'storefront' else ('/',)
    results = []; directory = runtime(name, state)
    for path in paths:
        with ops.HTTP.open(URLS[name] + path, timeout=15) as response:
            body = response.read(8 * 1024 * 1024 + 1); require(response.status == 200 and len(body) <= 8 * 1024 * 1024, 'Canonical public GET probe failed.')
        results.append({'path': path, 'status': 200, 'bodySha256': hashlib.sha256(body).hexdigest()})
        if name != 'api' and path == paths[0]:
            parser = Assets(); parser.feed(body.decode('utf-8')); require(parser.paths, 'Public HTML must reference immutable assets.')
            for url in sorted(parser.paths):
                asset = urlsplit(url).path
                local = directory / 'apps/storefront' / state['distDirectory'] / 'static' / asset.removeprefix('/_next/static/') if name == 'storefront' else directory / asset.lstrip('/')
                require(local.resolve().is_relative_to(directory.resolve()), 'Referenced asset escaped runtime.')
                with ops.HTTP.open(URLS[name] + url, timeout=10) as response: require(response.status == 200 and hashlib.sha256(response.read()).hexdigest() == ops.sha(local), 'Served asset differs from accepted bytes.')
                results.append({'path': asset, 'status': 200, 'artifactExact': True})
    return results


class OwnedStartupIncomplete(ops.PublishError): pass


# Exactly the six EF selection predicates in CatalogQuery.RepairSearchFieldsAsync;
# compare strings with =N'' rather than LEN/DATALENGTH or invented normalization.
SEARCH_REPAIR_SQL = """SELECT
 (SELECT COUNT_BIG(*) FROM [catalog].[Brands] WHERE [SearchName]=N'') brands,
 (SELECT COUNT_BIG(*) FROM [catalog].[ProductTranslation] WHERE [SearchName]=N'') translations,
 (SELECT COUNT_BIG(*) FROM [catalog].[Variants] WHERE [SearchSku]=N'') variants,
 (SELECT COUNT_BIG(*) FROM [catalog].[AttributeOptions] WHERE [FacetSearch]=N'') options,
 (SELECT COUNT_BIG(*) FROM [catalog].[ProductAttributeValue] WHERE ([ValueTextFa] IS NOT NULL OR [ValueTextEn] IS NOT NULL) AND [FacetSearch] IS NULL) productValues,
 (SELECT COUNT_BIG(*) FROM [catalog].[VariantAttributeValue] WHERE ([ValueTextFa] IS NOT NULL OR [ValueTextEn] IS NOT NULL) AND [FacetSearch] IS NULL) variantValues
 FOR JSON PATH,WITHOUT_ARRAY_WRAPPER;"""


def search_repair_ready():
    require(all(listener(name) is None for name in PORTS), 'Search preflight requires all three writers stopped.')
    counts = payload(SEARCH_REPAIR_SQL)
    require(set(counts) == {'brands', 'translations', 'variants', 'options', 'productValues', 'variantValues'}
            and all(type(value) is int and value >= 0 for value in counts.values())
            and all(value == 0 for value in counts.values()), 'Search/facet repair would rewrite old rows; migration must not start.')
    require(all(listener(name) is None for name in PORTS), 'A writer started during stopped search preflight.')
    return {'readOnly': True, 'candidateCounts': counts, 'repairWillWrite': False}


def start_selected(name, state, log):
    require(listener(name) is None, 'Existing listener prevents another startup.'); runtime(name, state); ops.write(DESCRIPTORS[name], state)
    argv = ['python3', 'scripts/serve-main-api.py'] if name == 'api' else ['python3', 'scripts/serve-main-storefront.py'] if name == 'storefront' else ['node', 'scripts/serve-main-admin.mjs']
    with log.open('ab') as stream: process = subprocess.Popen(argv, cwd=ROOT, stdout=stream, stderr=stream, start_new_session=True)
    try:
        for attempt in range(80):
            try:
                active = ops.read(DESCRIPTORS[name]); checks = smoke(name, active); identity = owned_process(name, active)
                require(identity['pid'] == process.pid, 'Started child differs from selected listener.'); return active, checks, identity
            except Exception:
                if process.poll() is not None or attempt == 79: raise
                time.sleep(.25)
    except Exception:
        if process.poll() is None:
            try: process.terminate(); process.wait(timeout=15)
            except ProcessLookupError: pass
            except Exception: raise OwnedStartupIncomplete('Our child termination is unproved; retain its descriptor and never start a second child.') from None
        raise


def verify_selected(candidates, identities):
    require(set(identities) == set(PORTS), 'Every selected component needs its exact startup fingerprint.')
    states = {}
    for name, candidate in candidates.items():
        active = ops.read(DESCRIPTORS[name]); runtime(name, active)
        require(active['runtimeDirectory'] == candidate['runtimeDirectory'] and owned_process(name, active) == identities[name], 'A selected PID/listener/command/start fingerprint changed after startup.')
        states[name] = active
    return states


def unchanged86(before, after):
    require(before is not None and before['database'] == after['database'] == 'Sayman'
            and len(table_map(before['tables'])) == len(table_map(after['tables'])) == 223
            and table_map(before['tables']) == table_map(after['tables'])
            and table_map(before['metadata']) == table_map(after['metadata'])
            and len(histories(before['histories'])) == 86 and histories(before['histories']) == histories(after['histories'])
            and before['configuration'] == after['configuration']
            and before['legacyUnknownTaxRows'] == after['legacyUnknownTaxRows'] == 0,
            'Previous86 recovery requires the exact untouched stopped rows, rowversions, metadata, history and configuration.')


def recover_before_migration(plan, before, report, report_path):
    require(report.get('migrationCommandStarted') is False and shape() == {'migrationCount': 86, 'tableCount': 223}, 'Old86 recovery is forbidden after any migration command starts.')
    unchanged86(before, database_snapshot())
    require(photo.preserved_files() == plan['preservedFiles'] and ops.sha(AGGREGATE) == plan['aggregateSha256']
            and all(listener(name) is None for name in PORTS), 'Changed private state or any unproved listener prevents pre-migration recovery.')
    for name, previous in plan['previous'].items(): runtime(name, previous)
    identities = {}; report['recoveryServices'] = {}
    for name in ('api', 'storefront', 'admin'):
        active, checks, identities[name] = start_selected(name, plan['previous'][name], CHECKS / ('commerce-rma-' + report['runId'] + '-' + name + '-previous86.log'))
        report['recoveryServices'][name] = {'runtimeDirectory': active['runtimeDirectory'], 'healthy': True, 'httpChecks': checks, 'process': identities[name]}
    unchanged86(before, database_snapshot()); require(photo.preserved_files() == plan['preservedFiles'], 'Previous86 startup changed preserved private state.')
    verify_selected(plan['previous'], identities)
    report.update(recovery='previous86-before-migration-command-only', sqlDowngradedOrRestored=False, forwardRecoveryRequired=False)
    ops.write(report_path, report)


def recover_forward(plan, candidates, report, report_path, identities):
    report['sqlDowngradedOrRestored'] = False; current = shape()
    require(current == {'migrationCount': 88, 'tableCount': 229}, 'Incomplete86/87 schema requires manual forward repair; no old86 service is automatically selected.')
    report['recovery'] = 'compatible88-forward-only'; report['recoveryServices'] = {}
    for name in ('api', 'storefront', 'admin'):
        selected = {**candidates[name], 'commerceRmaAccepted': False, 'commerceRmaRecoveryRequired': True}
        present = listener(name)
        if present is None: active, checks, identities[name] = start_selected(name, selected, CHECKS / ('commerce-rma-' + report['runId'] + '-' + name + '-recovery.log'))
        else:
            active = ops.read(DESCRIPTORS[name]); require(name in identities and active['runtimeDirectory'] == selected['runtimeDirectory'] and owned_process(name, active) == identities[name], 'Foreign listener/descriptor/start fingerprint preserved; no replacement is allowed.')
            checks = smoke(name, active); active.update(commerceRmaAccepted=False, commerceRmaRecoveryRequired=True); ops.write(DESCRIPTORS[name], active)
        report['recoveryServices'][name] = {'runtimeDirectory': active['runtimeDirectory'], 'healthy': True, 'httpChecks': checks}
    verify_selected(candidates, identities)
    ops.write(report_path, report)
    aggregate = ops.read(AGGREGATE)
    require(aggregate == plan['aggregate'] or aggregate.get('componentReleaseEvidence', {}).get('api') == relative(report_path), 'An unrelated aggregate was preserved; reconcile forward manually.')
    aggregate.update(sourceMigrationCount=88, databaseMigrationCount=88, tableCount=229, updatedAtUtc=stamp(), commerceRmaAccepted=False, commerceRmaRecoveryRequired=True, policyConfigurationPending=PENDING)
    aggregate['componentReleaseEvidence'] = {**aggregate.get('componentReleaseEvidence', {}), **{name: relative(report_path) for name in PORTS}}
    aggregate['previousSchemaReleaseEvidence'] = aggregate.get('schemaReleaseEvidence')
    aggregate['schemaReleaseEvidence'] = aggregate['lastComponentReleaseEvidence'] = {'path': relative(report_path), 'sha256': ops.sha(report_path)}
    ops.write(AGGREGATE, aggregate)


def apply(plan):
    require(plan.get('schemaVersion') == 1 and plan.get('kind') == KIND and re.fullmatch('[a-f0-9]{32}', plan.get('runId', '')), 'Invalid prepared cutover plan.')
    def accepted_now(): return accepted_evidence(plan['accepted']['selection']) == plan['accepted']
    require(accepted_now() and helper_hashes() == plan['helpers'] and build_inputs(plan['accepted']['frontendBuild']) == plan['frontendInputs']
            and photo.tree(ops.API_BIN) == plan['apiFiles'], 'Accepted source, evidence, helpers or candidate bytes changed.')
    require(ops.sha(AGGREGATE) == plan['aggregateSha256'] and photo.preserved_files() == plan['preservedFiles']
            and shape() == {'migrationCount': 86, 'tableCount': 223}, 'Canonical state changed after prepare.')
    for name, path in DESCRIPTORS.items(): require(ops.sha(path) == plan['descriptorSha256'][name] and owned_process(name, plan['previous'][name]) == plan['processes'][name], 'Canonical ownership changed after prepare.')
    report_path = CHECKS / ('commerce-rma-' + plan['runId'] + '-main-release.json'); require(not report_path.exists(), 'Release report already exists.')
    candidates = package(plan, report_path)
    report = {'passed': False, 'runId': plan['runId'], 'database': 'Sayman', 'startedAtUtc': stamp(), 'newMigrations': 2, 'newTables': 6,
              'rollbackPolicy': POLICY, 'policyConfigurationPending': PENDING, 'mainSeedPerformed': False, 'providerActivated': False,
              'refundActivated': False, 'sqlDowngradedOrRestored': False, 'fullProjectComplete': False, 'acceptedEvidence': plan['accepted']['files']}
    stopped = False; before = None; identities = {}; report['migrationCommandStarted'] = False
    try:
        ops.write(report_path, report)
        # Both UIs are stopped too: no old strict decoder may consume nullable
        # tax/RMA88 responses while the compatible API is being brought up.
        for name in ('storefront', 'admin', 'api'):
            stopped = True; stop_owned(name, plan['previous'][name], plan['processes'][name])
        require(all(listener(name) is None for name in PORTS), 'All three owned writers must be stopped before backup.')
        before = database_snapshot(); pending(before); before_path = CHECKS / ('commerce-rma-' + plan['runId'] + '-stopped-before.json'); ops.write(before_path, before, private=True)
        report['beforeSnapshot'] = {'path': relative(before_path), 'sha256': ops.sha(before_path)}
        report['backup'] = verified_backup(plan['runId'], plan['preservedFiles']); ops.write(report_path, report)
        require(accepted_now() and photo.preserved_files() == plan['preservedFiles'] and all(listener(n) is None for n in PORTS), 'Stopped cutover inputs changed during backup.')
        log = CHECKS / ('commerce-rma-' + plan['runId'] + '-migration.log')
        with log.open('xb') as stream:
            os.fchmod(stream.fileno(), 0o600)
            report['searchRepairPreflight'] = search_repair_ready()
            report['migrationCommandStarted'] = True; ops.write(report_path, report)
            subprocess.run(['dotnet', str(ROOT / candidates['api']['runtimeDirectory'] / 'Shop.Api.dll'), '--migrate'], cwd=ROOT, env=api_environment(), stdout=stream, stderr=subprocess.STDOUT, timeout=180, check=True)
        after = database_snapshot(); preserved_database(before, after, plan['accepted']['schemaContract'])
        require(shape() == {'migrationCount': 88, 'tableCount': 229} and photo.preserved_files() == plan['preservedFiles'], 'Migrated schema or private files differ.')
        after_path = CHECKS / ('commerce-rma-' + plan['runId'] + '-stopped-after.json'); ops.write(after_path, after, private=True)
        report.update(afterSnapshot={'path': relative(after_path), 'sha256': ops.sha(after_path)}, migrationLogSha256=ops.sha(log), original223BusinessFieldsAndRowversionsPreserved=True, metadataAllowlistVerified=True)
        services = {}
        for name in ('api', 'storefront', 'admin'):
            active, checks, identities[name] = start_selected(name, candidates[name], CHECKS / ('commerce-rma-' + plan['runId'] + '-' + name + '.log'))
            services[name] = {'runtimeDirectory': active['runtimeDirectory'], 'pid': identities[name]['pid'], 'process': identities[name], 'httpChecks': checks}
        # Startup must not seed or rewrite any old history. No exclusions for
        # contacts, credentials, policies, money, workers or mutable rowversions.
        startup = database_snapshot(); preserved_database(before, startup, plan['accepted']['schemaContract']); photo.preserve_existing_files(plan['preservedFiles'], photo.preserved_files())
        require(ops.sha(AGGREGATE) == plan['aggregateSha256'], 'An unrelated aggregate change must be preserved.')
        verify_selected(candidates, identities)
        for name, path in DESCRIPTORS.items():
            active = ops.read(path); runtime(name, active); require(active['runtimeDirectory'] == candidates[name]['runtimeDirectory'], 'Selected candidate changed during cutover.')
            active.update(commerceRmaAccepted=True, commerceRmaRecoveryRequired=False, healthCheckPassed=True, promotedAtUtc=stamp(), policyConfigurationPending=PENDING); ops.write(path, active)
        verify_selected(candidates, identities)
        report.update(passed=True, finishedAtUtc=stamp(), databaseMigrationCount=88, tableCount=229, services=services,
                      unitPassed=plan['accepted']['unitPassed'], targetedSqlPassed=plan['accepted']['targetedSqlPassed'], fullSqlPassed=plan['accepted']['fullSqlPassed'],
                      bothCompatibleFrontendsPromoted=True, startupOriginalBusinessFieldsPreserved=True)
        ops.write(report_path, report)
        aggregate = {**plan['aggregate'], 'sourceMigrationCount': 88, 'databaseMigrationCount': 88, 'tableCount': 229, 'updatedAtUtc': stamp(),
                     'commerceRmaAccepted': True, 'commerceRmaRecoveryRequired': False, 'policyConfigurationPending': PENDING}
        aggregate['componentReleaseEvidence'] = {**aggregate.get('componentReleaseEvidence', {}), **{name: relative(report_path) for name in PORTS}}
        aggregate['previousSchemaReleaseEvidence'] = plan['aggregate'].get('schemaReleaseEvidence')
        aggregate['schemaReleaseEvidence'] = aggregate['lastComponentReleaseEvidence'] = {'path': relative(report_path), 'sha256': ops.sha(report_path)}; ops.write(AGGREGATE, aggregate)
        return report
    except Exception as failure:
        report.update(passed=False, failureType=type(failure).__name__, failedAtUtc=stamp(), forwardRecoveryRequired=True)
        if isinstance(failure, OwnedStartupIncomplete): report['recovery'] = 'unproved-owned-child-retained-no-second-start'
        elif stopped:
            try:
                if report['migrationCommandStarted']: recover_forward(plan, candidates, report, report_path, identities)
                else: recover_before_migration(plan, before, report, report_path)
            except Exception as recovery: report.update(recoveryIncomplete=True, recoveryFailureType=type(recovery).__name__)
        ops.write(report_path, report); raise


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('action', choices=('prepare', 'apply')); parser.add_argument('--plan', required=True)
    for key in DEFAULTS: parser.add_argument('--' + re.sub(r'([A-Z])', r'-\1', key).lower())
    args = parser.parse_args(); path = owned_path(args.plan); require(path.suffix == '.json', 'Plan must be an owned JSON evidence file.')
    lock = ROOT / 'tmp/commerce-rma-publication.lock'
    with lock.open('a') as stream:
        fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        supplied = {key: getattr(args, re.sub(r'([A-Z])', r'_\1', key).lower()) for key in DEFAULTS}
        supplied = {key: value for key, value in supplied.items() if value is not None}
        if args.action == 'prepare':
            require(not path.exists(), 'Prepared plan already exists.'); value = prepare(supplied); ops.write(path, value, private=True)
            print(json.dumps({'readOnlyPrepared': True, 'plan': relative(path), 'policyConfigurationPending': True})); return 0
        plan = ops.read(path); require(all(plan['accepted']['selection'][key] == value for key, value in supplied.items()), 'Apply evidence differs from prepared selection.')
        report = apply(plan); print(json.dumps({'passed': report['passed'], 'databaseMigrationCount': 88, 'tableCount': 229, 'policyConfigurationPending': True})); return 0


if __name__ == '__main__':
    try: raise SystemExit(main())
    except Exception as error:
        print(json.dumps({'passed': False, 'failureType': type(error).__name__, 'message': str(error) if isinstance(error, ops.PublishError) else 'Cutover failed; private configuration/SQL details omitted.'}))
        raise SystemExit(1) from None
