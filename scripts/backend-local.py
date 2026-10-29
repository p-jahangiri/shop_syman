"""Start the local API or apply explicit migrations/seed without printing secrets."""
from pathlib import Path
import argparse,os,subprocess,sys
parser=argparse.ArgumentParser(add_help=False)
parser.add_argument('--runtime-dir')
options,application_args=parser.parse_known_args()
root=Path(__file__).resolve().parent.parent
config={}
for line in (root/'.env').read_text().splitlines():
 if line and not line.startswith('#'):
  key,value=line.split('=',1);config[key]=value
environment=os.environ.copy()
environment.update({'ASPNETCORE_ENVIRONMENT':'Development','ASPNETCORE_URLS':'http://127.0.0.1:5080','ConnectionStrings__Shop':f"Server=127.0.0.1,11433;Database=Sayman;User Id=sa;Password={config['SQL_SA_PASSWORD']};TrustServerCertificate=True;Connect Timeout=5",'Auth__SigningKey':config['AUTH_SIGNING_KEY'],'Bootstrap__AdminPassword':config['BOOTSTRAP_ADMIN_PASSWORD']})
environment.update({f'Cors__Origins__{i}':origin for i,origin in enumerate(['http://127.0.0.1:5173','http://127.0.0.1:3173','http://127.0.0.1:3000','http://127.0.0.1:3100'])})
environment.update({'Cors__AdminOrigins__0':'http://127.0.0.1:5173','Cors__AdminOrigins__1':'http://127.0.0.1:3173'})
if options.runtime_dir:
 runtime=(root/options.runtime_dir).resolve()
 if not runtime.is_relative_to((root/'tmp').resolve()) or not runtime.name.startswith('api-runtime-') or application_args or not (runtime/'Shop.Api.dll').is_file() or not (runtime/'Shop.Api.runtimeconfig.json').is_file():
  raise SystemExit('Use an existing project tmp/api-runtime-* artifact without migration or seed arguments.')
 environment['ASPNETCORE_CONTENTROOT']=str(root/'backend/src/Shop.Api')
 environment['DataProtection__KeyDirectory']=str(root/'tmp/identity-keys')
 command=['dotnet',str(runtime/'Shop.Api.dll')]
else:
 command=['dotnet','run','--no-build','--project',str(root/'backend/src/Shop.Api'),'--']+application_args
raise SystemExit(subprocess.call(command,cwd=root,env=environment))
