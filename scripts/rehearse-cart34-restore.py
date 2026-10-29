"""Restore rehearsal for an explicitly preserved fresh Cart2 GUID QA run.

No migration/seed/product write. Source stays intact; only this invocation's new
restore copy/files are removed. --cleanup-source is a separate deliberate action.
The older source21 rehearse-qa-restore.py behavior is unchanged.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import shutil
import socket
import stat
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parent.parent
CONTAINER = 'sayman-local-sqlserver-1'
UI_NAME = re.compile(r'SaymanTest_Ui_[a-f0-9]{32}\Z')
RESTORE_NAME = re.compile(r'SaymanTest_Restore_[a-f0-9]{32}\Z')
SCHEMAS = {'identity': 3, 'payments': 1, 'credit': 2, 'cms': 1, 'catalog': 8,
           'inventory': 6, 'sales': 8, 'market': 5}


def require(value, stage):
    if not value:
        raise RuntimeError(stage)


def literal(value):
    return "N'" + value.replace("'", "''") + "'"


def command(args, stage, *, env=None, timeout=120):
    result = subprocess.run(args, env=env, capture_output=True, text=True, timeout=timeout)
    require(result.returncode == 0, stage)
    return result.stdout


def private_tree(path):
    require(path.is_dir() and not path.is_symlink(), 'private_directory_required')
    for item in [path, *path.rglob('*')]:
        info = item.lstat()
        require(not stat.S_ISLNK(info.st_mode) and info.st_uid == os.getuid(), 'owned_non_symlink_private_tree_required')
        require(stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode), 'regular_private_files_required')
        require(stat.S_IMODE(info.st_mode) == (0o700 if item.is_dir() else 0o600), 'exact_private_permissions_required')
        require(item.is_dir() or info.st_nlink == 1, 'hardlinked_private_file_rejected')


def owned_source(name):
    require(UI_NAME.fullmatch(name), 'source_must_be_disposable_ui_qa')
    for parent in [ROOT / 'tmp', ROOT / 'tmp/ui-cart']:
        require(parent.is_dir() and not parent.is_symlink(), 'source_parent_symlink_rejected')
    source = ROOT / 'tmp/ui-cart' / name
    private_tree(source)
    marker = json.loads((source / 'preserved-cart34.json').read_text())
    require(marker.get('schemaVersion') == 1 and marker.get('sourceSchema') == 34 and
            marker.get('database') == name and marker.get('qaOnly') is True and
            marker.get('mainPromoted') is False and marker.get('freshRun') is True and
            marker.get('state') == 'stopped-preserved' and marker.get('apiPort') == 5181,
            'explicit_stopped_cart34_marker_required')
    metadata = json.loads((source / 'cart2.json').read_text())
    require(metadata.get('SchemaVersion') == 1 and metadata.get('Database') == name and
            metadata.get('QaOnly') is True and metadata.get('MainPromoted') is False,
            'fresh_cart2_metadata_required')
    for field in ['RequestId', 'TaskId', 'OfferId', 'AcceptanceId', 'AgreementId', 'CartId', 'VariantId']:
        require(re.fullmatch(r'[a-f0-9]{32}', metadata.get(field, '')), 'canonical_cart2_binding_required')
    require(re.fullmatch(r'[a-f0-9-]{36}', metadata.get('CustomerId', '')) and
            re.fullmatch(r'[a-f0-9-]{36}', metadata.get('WarehouseId', '')), 'generated_qa_identity_ids_required')
    for file, prefix in [('customer.json', 'cartui'), ('inventory.json', 'inventoryui')]:
        value = json.loads((source / file).read_text())
        require(re.fullmatch(prefix + r'[a-f0-9]{32}', value.get('Username', '')) and
                isinstance(value.get('Password'), str) and len(value['Password']) >= 32,
                'generated_qa_credentials_required')
    require(list((source / 'keys').glob('*.xml')), 'original_qa_key_ring_required')
    for port in [5181, 5182, 3105, 3175]:
        with socket.socket() as probe:
            probe.settimeout(1)
            require(probe.connect_ex(('127.0.0.1', port)) != 0, 'stop_all_owned_qa_listeners_before_snapshot')
    return source, metadata


# Exact row fingerprints for EVERY user table, including EF histories,
# rowversions, immutable snapshots, receipts, audit and identity ciphertext.
# Raw rows never leave SQL; only table/count/SHA256 are returned. PK ordering
# is mandatory so no arbitrary unordered aggregate can hide a difference.
FINGERPRINT_SQL = r"""
DECLARE @schema sysname,@table sysname,@object int,@columns nvarchar(max),@keys nvarchar(max),@query nvarchar(max);
CREATE TABLE #fingerprints([schema] sysname,[table] sysname,[count] bigint,[sha256] varchar(64));
DECLARE tables_cursor CURSOR LOCAL FAST_FORWARD FOR
 SELECT SCHEMA_NAME(schema_id),name,object_id FROM sys.tables WHERE is_ms_shipped=0 ORDER BY SCHEMA_NAME(schema_id),name;
OPEN tables_cursor; FETCH NEXT FROM tables_cursor INTO @schema,@table,@object;
WHILE @@FETCH_STATUS=0 BEGIN
 SELECT @columns=STRING_AGG(CONVERT(nvarchar(max),QUOTENAME(name)),N',') WITHIN GROUP(ORDER BY column_id) FROM sys.columns WHERE object_id=@object;
 SELECT @keys=STRING_AGG(CONVERT(nvarchar(max),QUOTENAME(c.name)),N',') WITHIN GROUP(ORDER BY ic.key_ordinal)
 FROM sys.indexes i JOIN sys.index_columns ic ON i.object_id=ic.object_id AND i.index_id=ic.index_id
 JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id WHERE i.object_id=@object AND i.is_primary_key=1;
 IF @keys IS NULL THROW 51000,'Restore QA requires a deterministic primary key for every user table.',1;
 SET @query=N'INSERT #fingerprints SELECT @s,@t,(SELECT COUNT_BIG(*) FROM '+QUOTENAME(@schema)+N'.'+QUOTENAME(@table)+N'),CONVERT(varchar(64),HASHBYTES(''SHA2_256'',CONVERT(varbinary(max),COALESCE((SELECT '+@columns+N' FROM '+QUOTENAME(@schema)+N'.'+QUOTENAME(@table)+N' ORDER BY '+@keys+N' FOR JSON PATH,INCLUDE_NULL_VALUES),N''[]''))),2);';
 EXEC sys.sp_executesql @query,N'@s sysname,@t sysname',@s=@schema,@t=@table;
 SET @keys=NULL;FETCH NEXT FROM tables_cursor INTO @schema,@table,@object;
END;
CLOSE tables_cursor;DEALLOCATE tables_cursor;
SELECT (SELECT [schema],[table],[count],[sha256] FROM #fingerprints ORDER BY [schema],[table] FOR JSON PATH) AS Payload;
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-run', required=True, help='Exact owned preserved Cart2 QA basename')
    parser.add_argument('--cleanup-source', action='store_true', help='Deliberately delete only this stopped preserved QA source after acceptance; no restore is run')
    parser.add_argument('--preflight-only', action='store_true', help='Check local source/permissions/listeners/capacity only; never read .env, connect to SQL, build or run verifier')
    args = parser.parse_args()
    require(not (args.cleanup_source and args.preflight_only), 'choose_one_qa_action')
    source, metadata = owned_source(args.source_run)
    require(shutil.disk_usage(ROOT).free >= 10 * 1024**3, 'ten_gib_free_required')
    if args.preflight_only:
        print('Cart34 local preflight PASS; SQL, restore, verifier and cleanup were not run.')
        return 0
    config = dict(line.split('=', 1) for line in (ROOT / '.env').read_text().splitlines() if line and not line.startswith('#'))
    sql_env = os.environ.copy()
    sql_env['SQLCMDPASSWORD'] = config['SQL_SA_PASSWORD']

    def sql(query, stage, database='master'):
        return command(['docker', 'exec', '-e', 'SQLCMDPASSWORD', CONTAINER,
                        '/opt/mssql-tools18/bin/sqlcmd', '-S', 'localhost', '-U', 'sa', '-C', '-d', database,
                        '-b', '-w', '65535', '-y', '0', '-s', '|', '-Q', 'SET NOCOUNT ON; ' + query], stage, env=sql_env)

    def payload(query, stage, database):
        rows = [line.strip() for line in sql(query, stage, database).splitlines() if line.strip().startswith(('{', '['))]
        require(len(rows) == 1, stage + '_bounded_json_result')
        return json.loads(rows[0])

    def migrations(database):
        found = payload("SELECT (SELECT SCHEMA_NAME(schema_id) [schema] FROM sys.tables WHERE name=N'__EFMigrationsHistory' ORDER BY SCHEMA_NAME(schema_id) FOR JSON PATH) Payload", 'migration_schemas', database)
        require({row['schema'] for row in found} == set(SCHEMAS), 'exact_eight_migration_schemas_required')
        union = ' UNION ALL '.join("SELECT " + literal(schema) + " [schema],MigrationId,ProductVersion FROM [" + schema + "].__EFMigrationsHistory" for schema in sorted(SCHEMAS))
        return payload('SELECT (SELECT * FROM (' + union + ') h ORDER BY [schema],MigrationId FOR JSON PATH) Payload', 'exact_migration_history', database)

    def snapshot(database):
        result = payload(FINGERPRINT_SQL, 'all_table_fingerprints', database)
        require(len(result) >= 50 and all(re.fullmatch(r'[A-F0-9]{64}', row['sha256']) for row in result), 'complete_table_fingerprint_required')
        return result

    def facts(database):
        m = metadata
        query = f"""SELECT (SELECT
 (SELECT COUNT(*) FROM sales.SourcingConversions) conversions,
 (SELECT COUNT(*) FROM sales.SourcingConversions WHERE AcceptanceId={literal(m['AcceptanceId'])} AND CartId={literal(m['CartId'])} AND OwnerId={literal(m['CustomerId'])}) ownedConversions,
 (SELECT COUNT(*) FROM sales.CartOfferCommandReceipts WHERE Operation='convert') convertReceipts,
 (SELECT COUNT(*) FROM sales.CartOfferCommandReceipts WHERE Operation='remove') removeReceipts,
 (SELECT COUNT(*) FROM sales.CartOfferLines) offerLines,
 (SELECT COUNT(*) FROM market.SourcingSupplyEvents WHERE ReasonCode='cart_converted' AND TaskId={literal(m['TaskId'])}) conversionEvents,
 (SELECT COUNT(*) FROM sales.CartLines WHERE CartId={literal(m['CartId'])} AND Quantity=1 AND VariantId={literal(m['VariantId'])}) ordinaryLines,
 (SELECT COUNT(*) FROM sales.CartSourcingLines WHERE CartId={literal(m['CartId'])} AND Quantity=1) inquiryLines,
 (SELECT CONVERT(varchar(19),PriceRial) FROM catalog.Variants WHERE Id={literal(m['VariantId'])}) publicPriceRial,
 (SELECT CONVERT(varchar(19),UnitPriceRial) FROM sales.SourcingPriceAgreementLines WHERE AgreementId={literal(m['AgreementId'])}) acceptedUnitPriceRial,
 (SELECT CONVERT(varchar(19),LineTotalRial) FROM sales.SourcingPriceAgreementLines WHERE AgreementId={literal(m['AgreementId'])}) acceptedTotalRial,
 (SELECT OnHand FROM inventory.Stock WHERE VariantId={literal(m['VariantId'])}) onHand,
 (SELECT Reserved FROM inventory.Stock WHERE VariantId={literal(m['VariantId'])}) reserved,
 (SELECT SourcingReserved FROM inventory.Stock WHERE VariantId={literal(m['VariantId'])}) sourcingReserved,
 (SELECT COUNT(*) FROM inventory.SerialUnits WHERE VariantId={literal(m['VariantId'])} AND State='available') physicalUnits,
 (SELECT COUNT(*) FROM inventory.SerialUnitClaims WHERE VariantId={literal(m['VariantId'])} AND IsActive=1 AND State='AllocationHeld') activeClaims,
 (SELECT COUNT(*) FROM sales.Orders) orders,(SELECT COUNT(*) FROM sales.CheckoutQuotes) quotes,
 (SELECT COUNT(*) FROM inventory.Reservations) reservations,(SELECT COUNT(*) FROM sales.CheckoutOrderSettings) settings,
 (SELECT COUNT(*) FROM sales.CheckoutChargePolicies) policies
 FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) Payload;"""
        value = payload(query, 'cart34_physical_financial_facts', database)
        require(value['conversions'] == value['ownedConversions'] == value['convertReceipts'] == value['conversionEvents'] == 1, 'actual_cart34_conversion_history_required')
        require(value['removeReceipts'] in (0, 1) and value['offerLines'] == 1 - value['removeReceipts'], 'exact_live_cart34_group_state_required')
        require(value['ordinaryLines'] == value['inquiryLines'] == 1 and value['publicPriceRial'] == '123' and
                value['acceptedUnitPriceRial'] == '9007199254740993' and value['acceptedTotalRial'] == '18014398509481986', 'independent_exact_cart34_prices_required')
        require(value['onHand'] == value['physicalUnits'] == 3 and value['reserved'] == 0 and
                value['sourcingReserved'] in (0, 2) and value['activeClaims'] == value['sourcingReserved'], 'physical_cart34_invariants_required')
        require(all(value[key] == 0 for key in ['orders', 'quotes', 'reservations', 'settings', 'policies']), 'no_financial_purchase_configuration_or_order_allowed')
        return value

    main_history = migrations('Sayman')
    require(len(main_history) == 31, 'main_must_still_be_schema31')
    main_before = snapshot('Sayman')
    source_history = migrations(args.source_run)
    require(len(source_history) == 34 and {schema: sum(row['schema'] == schema for row in source_history) for schema in SCHEMAS} == SCHEMAS and
            any(row['MigrationId'] == '20261024025922_CartAcceptedOffers' and row['schema'] == 'sales' for row in source_history), 'exact_cart34_migration_history_required')
    source_before = snapshot(args.source_run)
    source_facts = facts(args.source_run)
    run_id = uuid.uuid4().hex
    report_path = ROOT / 'artifacts/checks' / (('cart34-owned-source-cleanup-' if args.cleanup_source else 'cart34-restore-') + run_id + '.json')
    require(not report_path.exists(), 'report_must_be_new')
    if args.cleanup_source:
        # Revalidate immediately before deliberate deletion; no wildcard names,
        # owner credentials, extra directory traversal or database REPLACE.
        owned_source(args.source_run)
        sql('ALTER DATABASE [' + args.source_run + '] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [' + args.source_run + '];', 'drop_only_explicit_owned_source')
        shutil.rmtree(source)
        require(migrations('Sayman') == main_history and snapshot('Sayman') == main_before, 'main_unchanged_after_owned_source_cleanup')
        report_path.write_text(json.dumps({'passed': True, 'sourceDatabase': args.source_run, 'sourceDatabaseRemoved': True, 'sourcePrivateFilesRemoved': not source.exists(), 'mainSchema31Unchanged': True}, indent=2) + '\n')
        print('Cart34 owned source cleanup PASS; report: ' + str(report_path.relative_to(ROOT)))
        return 0
    files = payload('SELECT (SELECT name,type FROM sys.database_files ORDER BY type FOR JSON PATH) Payload', 'source_logical_files', args.source_run)
    require(len(files) == 2 and [row['type'] for row in files] == [0, 1], 'single_data_and_log_files_required')
    restored = 'SaymanTest_Restore_' + run_id
    require(RESTORE_NAME.fullmatch(restored), 'restore_name_guard')
    parent = ROOT / 'tmp/restore'
    parent.mkdir(mode=0o700, exist_ok=True)
    require(not parent.is_symlink(), 'restore_parent_symlink_rejected')
    directory = parent / restored
    directory.mkdir(mode=0o700)
    backup = '/var/opt/mssql/data/' + restored + '.bak'
    data = '/var/opt/mssql/data/' + restored + '.mdf'
    log = '/var/opt/mssql/data/' + restored + '_log.ldf'
    report = {'sourceDatabase': args.source_run, 'restoredDatabase': restored, 'qaOnly': True, 'sourceSchema': 34, 'mainSchema': 31,
              'scope': 'Same-host Development full SQL restore + generated QA auth/copied keys only; no production, native Linux, offsite or RTO acceptance',
              'sourceFacts': source_facts, 'sourceTableFingerprints': source_before, 'migrationHistory': source_history,
              'checks': [], 'cleanup': {}, 'passed': False}
    backup_attempted = restore_attempted = failed = False
    started = time.monotonic()
    try:
        private_before = {str(p.relative_to(source)): hashlib.sha256(p.read_bytes()).hexdigest() for p in source.rglob('*') if p.is_file()}
        shutil.copytree(source / 'keys', directory / 'keys')
        for file in ['customer.json', 'inventory.json', 'cart2.json']:
            shutil.copyfile(source / file, directory / file)
        expected = {'sourceDatabase': args.source_run, 'metadata': metadata, 'facts': source_facts}
        (directory / 'expected-cart34.json').write_text(json.dumps(expected))
        for path in directory.rglob('*'):
            path.chmod(0o700 if path.is_dir() else 0o600)
        private_tree(directory)
        require(payload('SELECT (SELECT DB_ID(' + literal(restored) + ') id FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER) Payload', 'new_restore_database', 'master')['id'] is None, 'restore_database_must_be_new')
        for path in [backup, data, log]:
            command(['docker', 'exec', CONTAINER, 'test', '!', '-e', path], 'restore_paths_must_be_new')
        backup_attempted = True
        sql('BACKUP DATABASE [' + args.source_run + '] TO DISK=' + literal(backup) + ' WITH COPY_ONLY,CHECKSUM;', 'copy_only_checksum_backup')
        report['checks'].append('copy_only_checksum_backup')
        sql('RESTORE VERIFYONLY FROM DISK=' + literal(backup) + ' WITH CHECKSUM;', 'restore_verifyonly_checksum')
        report['checks'].append('restore_verifyonly_checksum')
        report['backupSha256'] = command(['docker', 'exec', CONTAINER, 'sha256sum', backup], 'backup_digest').split()[0]
        restore_attempted = True
        sql('RESTORE DATABASE [' + restored + '] FROM DISK=' + literal(backup) + ' WITH MOVE ' + literal(files[0]['name']) + ' TO ' + literal(data) + ', MOVE ' + literal(files[1]['name']) + ' TO ' + literal(log) + ',CHECKSUM,RECOVERY;', 'restore_to_new_database_without_replace')
        report['checks'].append('restore_to_new_database_without_replace')
        sql('DBCC CHECKDB ([' + restored + ']) WITH NO_INFOMSGS;', 'full_checkdb_without_repair')
        report['checks'].append('full_checkdb_without_repair')
        require(migrations(restored) == source_history and snapshot(restored) == source_before and facts(restored) == source_facts, 'exact_restored_schema_tables_and_cart34_history')
        report['checks'].append('every_table_count_row_hash_and_exact_migration_history_preserved')
        verify_env = os.environ.copy()
        for flag in list(verify_env):
            if flag.startswith('SHOP_UI_') or flag.startswith('SHOP_RESTORE_'):
                verify_env.pop(flag)
        password = config['SQL_SA_PASSWORD'].replace('"', '""')
        verify_env.update(SHOP_UI_ROOT=str(ROOT), SHOP_UI_VERIFY_CART34_RESTORE='1', SHOP_RESTORE_DIRECTORY=str(directory),
                          SHOP_RESTORE_SQL_CONNECTION='Server=127.0.0.1,11433;Database=' + restored + ';User Id=sa;Password="' + password + '";TrustServerCertificate=True;Connect Timeout=8')
        verification = subprocess.run(['dotnet', 'run', '--no-build', '--project', str(ROOT / 'backend/tests/Shop.UiHarness')], env=verify_env, capture_output=True, text=True, timeout=120)
        # Never persist raw exception output: a provider exception can include
        # SQL/connection details. The verifier writes only a sanitized report.
        if verification.returncode != 0:
            stage = re.search(r'System\.InvalidOperationException: ([a-z][a-z0-9_]{2,100})(?:\r?\n|\s*$)', verification.stderr)
            if stage:
                report['verifierFailureStage'] = stage.group(1)
        require(verification.returncode == 0, 'restored_testserver_auth_keys_and_read_verification')
        verified = json.loads((directory / 'verified-cart34.json').read_text())
        require(verified.get('passed') is True, 'restored_verifier_report')
        report['verification'] = verified
        after_auth = snapshot(restored)
        require([r for r in after_auth if r['schema'] != 'identity'] == [r for r in source_before if r['schema'] != 'identity'] and facts(restored) == source_facts, 'testserver_changed_no_business_or_physical_table')
        report['checks'].append('generated_auth_mutations_confined_to_restored_identity_schema')
        require(snapshot(args.source_run) == source_before and migrations(args.source_run) == source_history and facts(args.source_run) == source_facts, 'source_database_preserved_exactly')
        require(private_before == {str(p.relative_to(source)): hashlib.sha256(p.read_bytes()).hexdigest() for p in source.rglob('*') if p.is_file()}, 'source_private_files_preserved_exactly')
        report['checks'].append('source_database_and_private_files_preserved_exactly')
        report['passed'] = True
    except Exception as error:
        failed = True
        report['failure'] = str(error) if isinstance(error, RuntimeError) else type(error).__name__
    finally:
        if restore_attempted:
            try:
                sql('IF DB_ID(' + literal(restored) + ') IS NOT NULL BEGIN ALTER DATABASE [' + restored + '] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [' + restored + ']; END;', 'drop_only_owned_restored_database')
                report['cleanup']['restoredDatabaseRemoved'] = True
            except Exception:
                report['cleanup']['restoredDatabaseRemoved'] = False
                failed = True
        if report['cleanup'].get('restoredDatabaseRemoved', True):
            try:
                if backup_attempted:
                    command(['docker', 'exec', CONTAINER, 'rm', '-f', '--', backup, data, log], 'remove_only_this_invocations_restore_files')
                shutil.rmtree(directory)
                report['cleanup']['restoreFilesRemoved'] = True
            except Exception:
                report['cleanup']['restoreFilesRemoved'] = False
                failed = True
        try:
            require(migrations('Sayman') == main_history and snapshot('Sayman') == main_before, 'main_schema31_all_tables_unchanged')
            report['checks'].append('main_schema31_all_tables_unchanged')
        except Exception:
            failed = True
            report['mainPreservationFailed'] = True
        report['cleanup']['sourcePreserved'] = source.exists()
        report['elapsedSeconds'] = round(time.monotonic() - started, 2)
        report['passed'] = report['passed'] and not failed
        report_path.write_text(json.dumps(report, indent=2) + '\n')
    print('Cart34 restore ' + ('PASS' if report['passed'] else 'FAILED') + '; report: ' + str(report_path.relative_to(ROOT)))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (RuntimeError, OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        print('Cart34 restore preflight failed: ' + (str(error) if isinstance(error, RuntimeError) else type(error).__name__))
        sys.exit(1)
