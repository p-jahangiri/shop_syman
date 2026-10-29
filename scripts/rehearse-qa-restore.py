"""Rehearse SQL + key-ring recovery using only an existing disposable UI QA run.

Never targets Sayman or publishes CMS. Requires a built Shop.UiHarness, a healthy
local SQL container and private tmp/ui-cart/SaymanTest_Ui_<guid> files. The source
run is preserved; only this invocation's fresh restored DB/files are removed.
This is a local Development rehearsal, not a production backup service.
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


def require(value, stage):
    if not value:
        raise RuntimeError(stage)


def literal(value):
    return "N'" + value.replace("'", "''") + "'"


def command(args, stage, *, env=None, timeout=90):
    result = subprocess.run(args, env=env, capture_output=True, text=True, timeout=timeout)
    require(result.returncode == 0, stage)
    return result.stdout


def private_tree(path):
    require(path.is_dir() and not path.is_symlink(), 'private_directory_required')
    require(stat.S_IMODE(path.stat().st_mode) & 0o077 == 0, 'private_directory_permissions')
    require(not any(p.is_symlink() for p in path.rglob('*')), 'symlink_in_private_run')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-run', required=True, help='Exact basename of an owned disposable UI QA run')
    args = parser.parse_args()
    require(UI_NAME.fullmatch(args.source_run), 'source_must_be_disposable_ui_qa')
    source = ROOT / 'tmp' / 'ui-cart' / args.source_run
    private_tree(source)
    customer_file = source / 'customer.json'
    require(customer_file.is_file() and stat.S_IMODE(customer_file.stat().st_mode) & 0o077 == 0, 'private_customer_file_required')
    credentials = json.loads(customer_file.read_text())
    require(re.fullmatch(r'cartui[a-f0-9]{32}', credentials.get('Username', '')), 'generated_qa_customer_required')
    require(isinstance(credentials.get('Password'), str) and len(credentials['Password']) >= 32, 'generated_qa_password_required')
    require((source / 'keys').is_dir() and list((source / 'keys').glob('*.xml')), 'source_key_ring_required')
    staff_file = source / 'finance.json'
    require(staff_file.is_file() and stat.S_IMODE(staff_file.stat().st_mode) & 0o077 == 0, 'private_qa_staff_file_required')
    staff = json.loads(staff_file.read_text())
    require(re.fullmatch(r'financeui[a-f0-9]{32}', staff.get('Username', '')), 'generated_qa_staff_required')
    with socket.socket() as probe:
        probe.settimeout(1)
        require(probe.connect_ex(('127.0.0.1', 5181)) != 0, 'stop_owned_qa_api_before_snapshot')
    require(shutil.disk_usage(ROOT).free >= 10 * 1024**3, 'ten_gib_free_required')
    config = dict(line.split('=', 1) for line in (ROOT / '.env').read_text().splitlines() if line and not line.startswith('#'))
    sql_env = os.environ.copy()
    sql_env['SQLCMDPASSWORD'] = config['SQL_SA_PASSWORD']

    def sql(query, stage, database='master'):
        # Password is passed only in an environment variable, never an argument/log.
        return command(['docker', 'exec', '-e', 'SQLCMDPASSWORD', CONTAINER,
                        '/opt/mssql-tools18/bin/sqlcmd', '-S', 'localhost', '-U', 'sa', '-C',
                        '-d', database, '-b', '-w', '65535', '-y', '0', '-s', '|',
                        '-Q', 'SET NOCOUNT ON; ' + query], stage, env=sql_env)

    def lines(query, stage, database='master'):
        rows = [line.strip() for line in sql(query, stage, database).splitlines() if line.strip()]
        # sqlcmd disallows -h -1 with unlimited (-y 0) output. Keep the full
        # ciphertext and remove the one SELECT's heading/separator instead.
        separator = next((i for i, row in enumerate(rows) if re.fullmatch(r'[- |]+', row)), None)
        return rows[separator + 1:] if separator is not None else rows

    def migrations(database):
        allowed = {'identity', 'payments', 'credit', 'cms', 'catalog', 'inventory', 'sales', 'market'}
        found = lines("SELECT SCHEMA_NAME(schema_id) FROM sys.tables WHERE name=N'__EFMigrationsHistory' ORDER BY schema_id", 'migration_schemas', database)
        require(set(found).issubset(allowed) and len(found) >= 7, 'unexpected_migration_schemas')
        query = 'SELECT ' + '+'.join('(SELECT COUNT(*) FROM [' + schema + '].__EFMigrationsHistory)' for schema in found)
        return int(lines(query, 'migration_count', database)[0])

    require(lines('SELECT DB_ID(' + literal(args.source_run) + ')', 'source_database_exists')[0] != 'NULL', 'source_database_missing')
    main_before = migrations('Sayman')
    source_migrations = migrations(args.source_run)
    owner = lines('SELECT Id FROM [identity].AspNetUsers WHERE UserName=' + literal(credentials['Username']), 'source_identity', args.source_run)
    require(len(owner) == 1 and re.fullmatch(r'[a-fA-F0-9-]{32,36}', owner[0]), 'source_identity_binding')
    owner_literal = literal(owner[0])
    ciphers = lines('SELECT ProtectedData FROM sales.Addresses WHERE OwnerId=' + owner_literal + ' ORDER BY Id', 'source_ciphertext', args.source_run)
    require(len(ciphers) > 0, 'source_address_required')
    order_lines = lines('SELECT Id,[State],CONVERT(varchar(30),PayableTotalRial),CONVERT(varchar(30),ShippingRial),CONVERT(varchar(1),ShippingRequired) FROM sales.Orders WHERE OwnerId=' + owner_literal + ' ORDER BY Id', 'source_orders', args.source_run)
    orders = []
    for line in order_lines:
        row = [part.strip() for part in line.split('|')]
        require(len(row) == 5 and re.fullmatch(r'[a-f0-9]{32}', row[0]), 'source_order_shape')
        require(row[1] == 'Cancelled' and row[2].isdigit() and row[3].isdigit() and row[4] in ('0', '1'), 'source_must_have_only_cancelled_qa_orders')
        orders.append(dict(id=row[0], state=row[1], total=row[2], shipping=row[3], physical=row[4] == '1'))
    require(len(orders) > 0, 'source_orders_required')
    cms = [part.strip() for part in lines("SELECT Revision,CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),DraftJson)),2),CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),PublishedJson)),2) FROM cms.Documents WHERE [Key]='site' AND Locale='en'", 'source_cms_snapshot', args.source_run)[0].split('|')]
    require(len(cms) == 3 and cms[0].isdigit() and all(re.fullmatch(r'[A-F0-9]{64}', digest) for digest in cms[1:]), 'source_cms_shape')
    files = [line.split('|') for line in lines('SELECT name,type FROM sys.database_files ORDER BY type', 'source_logical_files', args.source_run)]
    require(len(files) == 2 and [int(f[1]) for f in files] == [0, 1], 'single_data_and_log_files_required')
    restored = 'SaymanTest_Restore_' + uuid.uuid4().hex
    require(RESTORE_NAME.fullmatch(restored), 'restore_name_guard')
    directory = ROOT / 'tmp' / 'restore' / restored
    directory.mkdir(parents=True, mode=0o700)
    os.chmod(directory, 0o700)
    backup = '/var/opt/mssql/data/' + restored + '.bak'
    data = '/var/opt/mssql/data/' + restored + '.mdf'
    log = '/var/opt/mssql/data/' + restored + '_log.ldf'
    report = {'date': time.strftime('%Y-%m-%d'), 'sourceDatabase': args.source_run, 'restoredDatabase': restored,
              'mainMigrationsBefore': main_before, 'sourceMigrations': source_migrations,
              'scope': 'Local Development SQL COPY_ONLY/CHECKSUM + copied QA keys; no CMS publish or production backup acceptance',
              'checks': [], 'cleanup': {}, 'passed': False}
    report_path = ROOT / 'artifacts' / 'checks' / 'qa-restore-report.json'
    backup_attempted = False
    restore_attempted = False
    failed = False
    started = time.monotonic()
    try:
        shutil.copytree(source / 'keys', directory / 'keys')
        shutil.copyfile(customer_file, directory / 'customer.json')
        shutil.copyfile(staff_file, directory / 'finance.json')
        for path in directory.rglob('*'):
            os.chmod(path, 0o700 if path.is_dir() else 0o600)
        expected = {'addressCount': len(ciphers), 'addressCipherDigest': hashlib.sha256('\n'.join(ciphers).encode()).hexdigest().upper(), 'orders': orders,
                    'cmsRevision': int(cms[0]), 'cmsDraftDigest': cms[1], 'cmsPublishedDigest': cms[2]}
        (directory / 'expected.json').write_text(json.dumps(expected))
        os.chmod(directory / 'expected.json', 0o600)
        command(['docker', 'exec', CONTAINER, 'test', '!', '-e', backup], 'backup_path_must_be_new')
        backup_attempted = True
        sql('BACKUP DATABASE [' + args.source_run + '] TO DISK=' + literal(backup) + ' WITH COPY_ONLY,CHECKSUM;', 'backup_checksum')
        report['checks'].append('copy_only_checksum_backup')
        sql('RESTORE VERIFYONLY FROM DISK=' + literal(backup) + ' WITH CHECKSUM;', 'backup_verifyonly')
        report['checks'].append('restore_verifyonly_checksum')
        report['backupSha256'] = command(['docker', 'exec', CONTAINER, 'sha256sum', backup], 'backup_digest').split()[0]
        restore_attempted = True
        sql('RESTORE DATABASE [' + restored + '] FROM DISK=' + literal(backup) + ' WITH MOVE ' + literal(files[0][0].strip()) + ' TO ' + literal(data) + ', MOVE ' + literal(files[1][0].strip()) + ' TO ' + literal(log) + ',CHECKSUM,RECOVERY;', 'restore_to_new_database')
        report['checks'].append('restore_with_new_files_without_replace')
        sql('DBCC CHECKDB ([' + restored + ']) WITH NO_INFOMSGS;', 'restored_checkdb')
        report['checks'].append('full_checkdb_no_repair')
        require(migrations(restored) == source_migrations, 'restored_migration_count')
        report['checks'].append('restored_migrations_match')
        verify_env = os.environ.copy()
        password = config['SQL_SA_PASSWORD'].replace('"', '""')
        verify_env.update(SHOP_UI_ROOT=str(ROOT), SHOP_UI_VERIFY_RESTORE='1', SHOP_RESTORE_DIRECTORY=str(directory),
                          SHOP_RESTORE_SQL_CONNECTION='Server=127.0.0.1,11433;Database=' + restored + ';User Id=sa;Password="' + password + '";TrustServerCertificate=True;Connect Timeout=8')
        verification = subprocess.run(['dotnet', 'run', '--no-build', '--project', str(ROOT / 'backend/tests/Shop.UiHarness')], env=verify_env, capture_output=True, text=True, timeout=90)
        # ASP.NET logs contain endpoint paths, never dump the connection/credentials/body.
        (ROOT / 'artifacts/checks/qa-restore-verifier.log').write_text(verification.stdout + verification.stderr)
        require(verification.returncode == 0, 'restored_http_key_verification')
        verified = json.loads((directory / 'verified.json').read_text())
        require(verified['passed'] is True, 'verifier_report')
        report['verification'] = verified
        report['mainMigrationsAfter'] = migrations('Sayman')
        require(report['mainMigrationsAfter'] == main_before, 'main_migrations_unchanged')
        report['checks'].append('main_migrations_unchanged')
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
        if backup_attempted and report['cleanup'].get('restoredDatabaseRemoved', True):
            try:
                command(['docker', 'exec', CONTAINER, 'rm', '-f', '--', backup], 'remove_only_owned_backup')
                report['cleanup']['backupRemoved'] = True
            except Exception:
                report['cleanup']['backupRemoved'] = False
                failed = True
        if report['cleanup'].get('restoredDatabaseRemoved', True):
            shutil.rmtree(directory)
            report['cleanup']['copiedPrivateDirectoryRemoved'] = not directory.exists()
        report['cleanup']['sourceRunPreservedForPendingCms'] = source.exists()
        report['elapsedSeconds'] = round(time.monotonic() - started, 2)
        report['passed'] = report['passed'] and not failed
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print('QA restore ' + ('PASS' if report['passed'] else 'FAILED') + '; report: artifacts/checks/qa-restore-report.json')
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (RuntimeError, OSError, ValueError) as error:
        # No credential values, SQL bodies or private payloads in terminal output.
        print('QA restore preflight failed: ' + (str(error) if isinstance(error, RuntimeError) else type(error).__name__))
        sys.exit(1)
