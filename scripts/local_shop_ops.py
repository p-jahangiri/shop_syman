"""Scoped helpers for the one authorized local Sayman database; never starts Docker."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import os
import subprocess

ROOT = Path(__file__).resolve().parent.parent
SCHEMAS = ['identity', 'payments', 'credit', 'cms', 'catalog', 'inventory', 'sales', 'market', 'reviews', 'support', 'notifications', 'files']


def sha(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


def settings():
    return dict(line.split('=', 1) for line in (ROOT / '.env').read_text().splitlines()
                if line and not line.startswith('#'))


def sql(query, database='Sayman', timeout=90):
    if database not in ['Sayman', 'master']:
        raise ValueError('Only canonical Sayman and read-only master inspection are supported.')
    environment = os.environ.copy()
    environment['SQLCMDPASSWORD'] = settings()['SQL_SA_PASSWORD']
    result = subprocess.run(['docker', 'compose', '--profile', 'backend', 'exec', '-T', '-e', 'SQLCMDPASSWORD',
        'sqlserver', '/opt/mssql-tools18/bin/sqlcmd', '-S', 'localhost', '-U', 'sa', '-C', '-b', '-d', database,
        '-w', '65535', '-y', '0', '-Q', 'SET NOCOUNT ON; ' + query], cwd=ROOT, env=environment,
        capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError('Scoped local SQL operation failed; credentials are omitted.')
    return result.stdout


def payload(query, database='Sayman'):
    return json.loads(''.join(sql(query, database).splitlines()).strip())


def configuration_hashes():
    keys = ROOT / 'tmp/identity-keys'
    if not keys.is_dir() or keys.is_symlink() or not any(keys.glob('*.xml')) or any(file.is_symlink() for file in keys.rglob('*')):
        raise RuntimeError('The existing private identity key ring is required.')
    return {'environmentFileSha256': sha(ROOT / '.env'),
            'keyring': {str(file.relative_to(keys)): sha(file) for file in sorted(keys.rglob('*')) if file.is_file()}}


def api_environment():
    values = settings()
    environment = os.environ.copy()
    environment.update(ASPNETCORE_ENVIRONMENT='Development', ASPNETCORE_URLS='http://127.0.0.1:5080',
        ASPNETCORE_CONTENTROOT=str(ROOT / 'backend/src/Shop.Api'), DataProtection__KeyDirectory=str(ROOT / 'tmp/identity-keys'),
        ConnectionStrings__Shop=f"Server=127.0.0.1,11433;Database=Sayman;User Id=sa;Password={values['SQL_SA_PASSWORD']};TrustServerCertificate=True;Connect Timeout=8",
        Auth__SigningKey=values['AUTH_SIGNING_KEY'], Bootstrap__AdminPassword=values['BOOTSTRAP_ADMIN_PASSWORD'],
        Files__Storage='Disabled', PhoneDiscovery__AutomaticNotificationsEnabled='true',
        Cors__AdminOrigins__0='http://127.0.0.1:5173', Cors__AdminOrigins__1='http://127.0.0.1:3173')
    for index, origin in enumerate(['http://127.0.0.1:5173', 'http://127.0.0.1:3173', 'http://127.0.0.1:3000', 'http://127.0.0.1:3100']):
        environment[f'Cors__Origins__{index}'] = origin
    return environment


def snapshot(exclude_staff_flags=False):
    query = FINGERPRINT_SQL
    if exclude_staff_flags:
        needle = 'FROM sys.columns WHERE object_id=@object;'
        assert query.count(needle) == 1
        query = query.replace(needle, "FROM sys.columns WHERE object_id=@object AND NOT (@schema=N'identity' AND @table=N'AspNetUsers' AND name IN (N'ProvisionedByAdministrator',N'MustChangePassword'));")
    tables = payload(query)
    histories = payload('SELECT (SELECT * FROM (' + ' UNION ALL '.join(
        "SELECT N'" + name + "' [schema],MigrationId,ProductVersion FROM [" + name + '].__EFMigrationsHistory' for name in SCHEMAS)
        + ') h ORDER BY [schema],MigrationId FOR JSON PATH) Payload')
    return {'atUtc': datetime.now(timezone.utc).isoformat(), 'database': 'Sayman', 'tables': tables,
            'histories': histories, 'configuration': configuration_hashes()}


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
