"""Start only a freshly owned GUID SQL phone harness; never use the main database."""
raise SystemExit('D44: persistent phone preview launch is retired. Use the single Main local shop at http://127.0.0.1:3000 and admin at http://127.0.0.1:3173. Historical harness/test sources and reports are retained.')

from pathlib import Path
import os,subprocess
root=Path(__file__).resolve().parent.parent
config={}
for line in (root/'.env').read_text().splitlines():
 if line and not line.startswith('#') and '=' in line:
  name,value=line.split('=',1);config[name]=value.strip().strip('"').strip("'")
password=config.get('SQL_SA_PASSWORD')
if not password:raise SystemExit('Local SQL configuration is missing.')
environment=os.environ.copy()
environment.update(SHOP_PHONE_QA_ROOT=str(root),SHOP_TEST_SQL_CONNECTION=f'Server=127.0.0.1,11433;Database=master;User Id=sa;Password={password};TrustServerCertificate=True;Connect Timeout=8')
environment.update({'Cors__Origins__0':'http://sayman-phone-ui.localhost:3108','Cors__Origins__1':'http://sayman-phone-admin.localhost:3178','Cors__AdminOrigins__0':'http://sayman-phone-admin.localhost:3178','PhoneDiscovery__AutomaticNotificationsEnabled':'true','Credit__AutomaticRemindersEnabled':'false','Sales__ExpiryEnabled':'false','Inventory__ExpiryEnabled':'false','Inventory__AllocationExpiryEnabled':'false','Market__OrderProjectionEnabled':'false'})
environment.pop('SHOP_UI_ROOT',None)
command=['dotnet',str(root/'backend/tests/Shop.PhoneHarness/bin/Debug/net10.0/Shop.PhoneHarness.dll')]
raise SystemExit(subprocess.call(command,cwd=root,env=environment))
