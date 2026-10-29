"""Verified private pre-upgrade backup of the fixed local Sayman database.

This is manual Development backup on the same host, not production/offsite
automation. It never restores a database, reads MFA values or prunes volumes.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import uuid

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--label', required=True)
parser.add_argument('--report', required=True)
args = parser.parse_args()
if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,47}', args.label):
    raise SystemExit('Use a short lowercase backup label.')
report_path = (root / args.report).resolve()
if not report_path.is_relative_to(root / 'artifacts/checks') or report_path.exists():
    raise SystemExit('Use a new report file under artifacts/checks.')
if shutil.disk_usage(root).free < 10 * 2**30:
    raise SystemExit('At least 10 GiB free host space is required.')
key_source = root / 'tmp/identity-keys'
if not key_source.is_dir() or key_source.is_symlink() or any(p.is_symlink() for p in key_source.rglob('*')):
    raise SystemExit('The local key ring must be an existing non-symlink directory.')
keys = [p for p in key_source.rglob('*') if p.is_file()]
if not keys:
    raise SystemExit('The local key ring is empty; preserve the database and investigate.')
config = dict(line.split('=', 1) for line in (root / '.env').read_text().splitlines()
              if line and not line.startswith('#'))
sql_environment = os.environ.copy()
sql_environment['SQLCMDPASSWORD'] = config['SQL_SA_PASSWORD']

def sql(query, timeout=30):
    result = subprocess.run(['docker', 'exec', '-e', 'SQLCMDPASSWORD', 'sayman-local-sqlserver-1',
                             '/opt/mssql-tools18/bin/sqlcmd', '-S', 'localhost', '-U', 'sa', '-C',
                             '-b', '-h', '-1', '-W', '-s', '|', '-Q', 'SET NOCOUNT ON; ' + query],
                            env=sql_environment, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(result.stderr or result.stdout)
    return result.stdout.strip()

state = sql("SELECT state_desc FROM sys.databases WHERE name=N'Sayman'")
if state != 'ONLINE':
    raise SystemExit('The fixed local database must be ONLINE.')
tag = args.label + '-' + uuid.uuid4().hex
directory = root / 'tmp/local-backups' / tag
directory.mkdir(parents=True, mode=0o700)
directory.chmod(0o700)
shutil.copytree(key_source, directory / 'identity-keys')
for path in [directory / 'identity-keys', *(directory / 'identity-keys').rglob('*')]:
    path.chmod(0o700 if path.is_dir() else 0o600)
baseline = sql("""USE [Sayman];
SELECT 'users',COUNT(*) FROM [identity].[AspNetUsers];
SELECT 'stock',COUNT(*),SUM(OnHand),SUM(Reserved) FROM [inventory].[Stock];
SELECT 'variants',COUNT(*),CONVERT(varchar(64),HASHBYTES('SHA2_256',(SELECT Id,Sku,PriceRial,CompareAtPriceRial FROM [catalog].[Variants] ORDER BY Id FOR JSON PATH)),2) FROM [catalog].[Variants];
SELECT 'cms',Locale,Revision,CONVERT(varchar(64),HASHBYTES('SHA2_256',DraftJson),2),CONVERT(varchar(64),HASHBYTES('SHA2_256',PublishedJson),2) FROM [cms].[Documents] WHERE [Key]='site';
""")
(directory / 'baseline.txt').write_text(baseline + '\n')
(directory / 'baseline.txt').chmod(0o600)
remote = '/var/opt/mssql/data/' + tag + '.bak'
sql("BACKUP DATABASE [Sayman] TO DISK=N'" + remote + "' WITH COPY_ONLY,CHECKSUM; RESTORE VERIFYONLY FROM DISK=N'" + remote + "' WITH CHECKSUM;", 120)
subprocess.run(['docker', 'cp', 'sayman-local-sqlserver-1:' + remote, str(directory / 'Sayman.bak')],
               check=True, capture_output=True, text=True)
backup = directory / 'Sayman.bak'
backup.chmod(0o600)
with backup.open('rb') as stream:
    digest = hashlib.file_digest(stream, 'sha256').hexdigest()
if not backup.stat().st_size:
    raise RuntimeError('The private backup copy is empty; preserve both copies.')
# Remove only this invocation's exact container file after retaining its host copy.
subprocess.run(['docker', 'exec', 'sayman-local-sqlserver-1', 'rm', '--', remote],
               check=True, capture_output=True, text=True)
report = {'passed': True, 'database': 'Sayman', 'privateDirectory': str(directory.relative_to(root)),
          'backupBytes': backup.stat().st_size, 'backupSha256': digest, 'keyFilesCopiedWithoutParsing': len(keys),
          'copyOnly': True, 'checksumVerifyOnly': True, 'scope': 'Manual local Development backup retained on the same host; no restore, offsite or production automation'}
report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({key: value for key, value in report.items() if key != 'privateDirectory'}))
