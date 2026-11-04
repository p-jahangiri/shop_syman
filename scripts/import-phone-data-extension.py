"""Explicit Development-only addition of reviewed phone data to the one canonical shop.
Builds only a one-shot command against accepted frozen assemblies; never builds, runs
or migrates the in-progress backend checkout and never starts a second server.
"""
from pathlib import Path
import argparse, hashlib, json, os, subprocess, urllib.request
root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--apply-main-development', action='store_true', required=True)
parser.parse_args()
descriptor_path = root/'tmp/api-runtime-current.json'
descriptor_bytes = descriptor_path.read_bytes()
state = json.loads(descriptor_bytes)
if state['databaseMigrationCount'] != 83 or state['sourceMigrationCount'] != 83:
    raise SystemExit('This reviewed data command requires the accepted schema83 runtime.')
runtime = (root/state['runtimeDirectory']).resolve()
if not runtime.is_relative_to(root/'tmp'):
    raise SystemExit('Unexpected runtime directory.')
def verify():
    if descriptor_path.read_bytes() != descriptor_bytes:
        raise SystemExit('Canonical API descriptor changed; inspect before continuing.')
    for name, expected in state['moduleSha256'].items():
        if hashlib.sha256((runtime/name).read_bytes()).hexdigest() != expected:
            raise SystemExit('An accepted runtime assembly changed: '+name)
verify()
with urllib.request.urlopen('http://127.0.0.1:5080/health/ready', timeout=10) as response:
    if response.status != 200: raise SystemExit('Main API is not ready.')
project = root/'tools/development/phone-data-extension/PhoneDataExtension.csproj'
output = root/'tmp/phone-data-extension-build'
feed = root/'tmp/empty-nuget'; feed.mkdir(exist_ok=True)
build = subprocess.run(['dotnet','build',str(project),'-p:FrozenRuntime='+str(runtime),'--source',str(feed),'--nologo','-o',str(output)],capture_output=True,text=True)
(root/'artifacts/checks/phone-extension-build.log').write_text(build.stdout+build.stderr)
if build.returncode: raise SystemExit('Data command build failed; see phone-extension-build.log.')
verify()
settings = dict(line.split('=',1) for line in (root/'.env').read_text().splitlines() if line and not line.startswith('#'))
environment = os.environ.copy()
environment.update(DOTNET_ENVIRONMENT='Development',ConnectionStrings__Shop=f"Server=127.0.0.1,11433;Database=Sayman;User Id=sa;Password={settings['SQL_SA_PASSWORD']};TrustServerCertificate=True;Connect Timeout=8")
run = subprocess.run(['dotnet','exec','--depsfile',str(runtime/'Shop.Api.deps.json'),'--runtimeconfig',str(runtime/'Shop.Api.runtimeconfig.json'),str(output/'PhoneDataExtension.dll'),'--apply-main-development',str(root)],env=environment,capture_output=True,text=True)
(root/'artifacts/checks/phone-extension-import.log').write_text(run.stdout+run.stderr)
if run.returncode: raise SystemExit('Data command failed; see phone-extension-import.log.')
verify()
result = json.loads(run.stdout.strip())
(root/'artifacts/checks/phone-extension-main-applied.json').write_text(json.dumps({**result,'apiAssembliesUnchanged':True,'apiDescriptorUnchanged':True,'sourceKey':'development-samsung-phones-v2'},indent=2)+'\n')
print(json.dumps(result))
