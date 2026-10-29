"""Use a private connection to create and delete only isolated SaymanTest_* databases."""
from pathlib import Path
import os,subprocess,socket,sys
root=Path(__file__).resolve().parent.parent
config=dict(line.split('=',1) for line in (root/'.env').read_text().splitlines() if line and not line.startswith('#'))
try:
 with socket.create_connection(('127.0.0.1',11433),timeout=3):pass
except OSError:
 print('SQL Server on localhost:11433 is unavailable. No tests ran and no database was changed.')
 raise SystemExit(2)
environment=os.environ.copy();environment['SHOP_TEST_SQL_CONNECTION']=f"Server=127.0.0.1,11433;Database=master;User Id=sa;Password={config['SQL_SA_PASSWORD']};TrustServerCertificate=True;Connect Timeout=8"
raise SystemExit(subprocess.call(['dotnet','test',str(root/'backend/tests/Shop.SqlTests'),'--no-restore','--disable-build-servers','-m:1',*sys.argv[1:]],cwd=root,env=environment))
