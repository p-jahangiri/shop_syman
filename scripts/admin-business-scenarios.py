"""Plan/test authored Development stories; main import is explicit and requires accepted schema85."""
from urllib.request import urlopen
import argparse
import json
import os
import subprocess
import uuid
from local_shop_ops import ROOT, settings, snapshot, sha

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('mode', choices=['plan', 'self-test', 'apply-main-development'])
args = parser.parse_args()
checks = ROOT / 'artifacts/checks'
prepared = json.loads((ROOT / 'tmp/admin-business85-backend-prepared.json').read_text())
runtime = ROOT / prepared['runtimeDirectory']
expected = prepared['moduleSha256']


def verify():
    for file, wanted in expected.items():
        if sha(runtime / file) != wanted:
            raise RuntimeError('A frozen product assembly changed.')


verify()
if args.mode == 'apply-main-development':
    state = json.loads((ROOT / 'tmp/api-runtime-current.json').read_text())
    release_file = checks / 'admin-business85-main-release.json'
    if not release_file.is_file():
        raise SystemExit('The accepted main schema85 release is required. No seed or migration ran.')
    release = json.loads(release_file.read_text())
    if not release.get('passed') or state['databaseMigrationCount'] != 85 or state['moduleSha256'] != expected:
        raise SystemExit('The accepted main schema85 release is required. No seed or migration ran.')
    with urlopen('http://127.0.0.1:5080/health/ready', timeout=10) as response:
        assert response.status == 200
output = ROOT / 'tmp/admin-business85-scenarios-build'
result = subprocess.run(['dotnet', 'build', str(ROOT / 'tools/admin-business-scenarios/AdminBusinessScenarios.csproj'),
    '-p:FrozenRuntime=' + str(runtime), '--source', str(ROOT / 'tmp/empty-nuget-source'),
    '--disable-build-servers', '-m:1', '-o', str(output)], cwd=ROOT, capture_output=True, text=True)
(checks / ('admin-business85-scenarios-' + args.mode + '-build.log')).write_text(result.stdout + result.stderr)
if result.returncode:
    raise SystemExit('Scenario tool build failed; main was not changed.')
verify()
command = ['dotnet', 'exec', '--depsfile', str(runtime / 'Shop.Api.deps.json'), '--runtimeconfig',
           str(runtime / 'Shop.Api.runtimeconfig.json'), str(output / 'AdminBusinessScenarios.dll')]
environment = os.environ.copy()
environment['DOTNET_ENVIRONMENT'] = 'Development'
database = None
before = None
if args.mode == 'plan':
    command += ['--plan']
else:
    database = 'SaymanTest_' + uuid.uuid4().hex if args.mode == 'self-test' else 'Sayman'
    values = settings()
    environment['ConnectionStrings__Shop'] = f"Server=127.0.0.1,11433;Database={database};User Id=sa;Password={values['SQL_SA_PASSWORD']};TrustServerCertificate=True;Connect Timeout=8"
    command += ['--self-test' if args.mode == 'self-test' else '--apply-main-development', str(ROOT)]
    if args.mode == 'apply-main-development':
        before = snapshot()
result = subprocess.run(command, cwd=ROOT, env=environment, capture_output=True, text=True)
if result.returncode:
    diagnostic = result.stderr
    if args.mode != 'plan':
        diagnostic = diagnostic.replace(values['SQL_SA_PASSWORD'], '[redacted]')
    (checks / ('admin-business85-scenarios-' + args.mode + '-errors.log')).write_text(diagnostic)
    raise SystemExit('Scenario command did not complete; inspect its scoped diagnostic. No policy was activated.')
verify()
body = json.loads(result.stdout)
report = {'passed': True, 'mode': args.mode, 'database': database, 'result': body,
          'toolDllSha256': sha(output / 'AdminBusinessScenarios.dll'), 'productDllsChanged': False,
          'mainChanged': args.mode == 'apply-main-development', 'financialPolicyChanged': False}
if before is not None:
    after = snapshot()
    old = {row['schema'] + '.' + row['table']: row for row in before['tables']}
    new = {row['schema'] + '.' + row['table']: row for row in after['tables']}
    allowed = {'identity.AspNetUsers', 'identity.Audit', 'support.Tickets', 'support.Messages', 'support.Events', 'support.Commands'}
    changed = [name for name in old if old[name] != new[name]]
    report['mainChanged'] = bool(changed)
    report['changedTables'] = changed
    report['unexpectedChangedTables'] = sorted(set(changed) - allowed)
    report['historiesPreserved'] = before['histories'] == after['histories']
    report['existingKeyFilesPreserved'] = all(after['configuration']['keyring'].get(file) == wanted for file, wanted in before['configuration']['keyring'].items())
    if report['unexpectedChangedTables'] or not report['historiesPreserved'] or not report['existingKeyFilesPreserved']:
        report['passed'] = False
        report['note'] = 'Unrelated concurrent changes require review; existing data was not rolled back.'
path = checks / ('admin-business85-scenarios-' + args.mode + '-' + uuid.uuid4().hex + '.json')
path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'passed': report['passed'], 'mode': args.mode, 'report': str(path.relative_to(ROOT)), 'mainChanged': report['mainChanged']}))
if args.mode == 'self-test':
    raise SystemExit(subprocess.call(['python3', 'scripts/verify-sql-test-cleanup.py'], cwd=ROOT))
if not report['passed']:
    raise SystemExit(1)
