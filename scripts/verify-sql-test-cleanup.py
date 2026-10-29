"""Read-only check for leftover disposable test databases. Never deletes a database.

Run after the owning SQL test process exits. During another active test run a
nonzero count is expected and must not be repaired by deleting its databases.
This checks SQL cleanup only; it is not an offsite backup or key-restore check.
"""
from pathlib import Path
import os,re,subprocess

root=Path(__file__).resolve().parent.parent
try:
    config=dict(line.split('=',1)for line in(root/'.env').read_text().splitlines()if line and not line.startswith('#'))
    password=config['SQL_SA_PASSWORD']
except(OSError,KeyError,ValueError):
    raise SystemExit('SQL cleanup was not verified: the private local SQL configuration is unavailable.')
environment=os.environ.copy();environment['SQLCMDPASSWORD']=password;config.clear();password=''
try:
    result=subprocess.run(['docker','compose','--profile','backend','exec','-T','-e','SQLCMDPASSWORD','sqlserver','/opt/mssql-tools18/bin/sqlcmd','-S','localhost','-U','sa','-C','-b','-d','master','-h','-1','-W','-Q',"SET NOCOUNT ON; SELECT COUNT(*) FROM sys.databases WHERE name LIKE 'SaymanTest[_]%';"],cwd=root,env=environment,capture_output=True,text=True,timeout=30)
except(OSError,subprocess.TimeoutExpired):
    raise SystemExit('SQL cleanup was not verified: the isolated SQL service could not be inspected.')
raw=result.stdout.strip()
if result.returncode!=0 or not re.fullmatch('[0-9]+',raw):
    raise SystemExit('SQL cleanup was not verified: no valid disposable-database count was returned.')
remaining=int(raw)
if remaining:
    raise SystemExit(f'SQL cleanup incomplete: {remaining} disposable test database(s) remain. Active runs and unknown databases were preserved.')
print('SQL cleanup verified: zero SaymanTest_* databases remain. No data was deleted.')
