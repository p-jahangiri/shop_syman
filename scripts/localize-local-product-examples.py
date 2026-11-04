"""Finish bilingual Development samples through accepted Catalog CAS commands.

Run after --seed-product-examples, then verify-local-product-examples.py.
Never builds/replaces the backend, reads staff credentials, or creates a host.
"""
from pathlib import Path
import importlib.util
import json
import os
import subprocess

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('d70_examples_helpers', ROOT / 'scripts/publish-local-product-workspace.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


def main():
    state = p.ops.read(p.m.CURRENT)
    p.owned_process(state)
    p.accepted(ROOT / 'artifacts/checks/d70-product-workspace/run2/acceptance.json')
    assert p.shape() == {'migrationCount': 93, 'tableCount': 244}
    directory = ROOT / 'tmp/d70-example-localization-build/bin/ExampleLocalization/debug'
    assert (directory / 'ExampleLocalization.dll').is_file(), 'Build the bounded operator first using the accepted API references.'
    for name, digest in state['moduleSha256'].items():
        assert p.ops.sha(directory / name) == digest, 'Operator references must be the accepted API bytes.'
    before = p.snapshot()
    private = p.photo.preserved_files()
    p.ops.write(ROOT / 'artifacts/checks/d70-product-workspace/examples-before-localization.private.json', before, private=True)
    values = p.previous.dbops.settings()
    env = os.environ.copy()
    env.update(ASPNETCORE_ENVIRONMENT='Development', ConnectionStrings__Shop=f"Server=127.0.0.1,11433;Database=Sayman;User Id=sa;Password={values['SQL_SA_PASSWORD']};TrustServerCertificate=True;Connect Timeout=8")
    # Use the accepted API dependency graph so SqlClient resolves its Unix
    # runtime asset rather than the package's platform-neutral reference stub.
    api = ROOT / state['runtimeDirectory']
    result = subprocess.run(['dotnet', 'exec', '--depsfile', str(api / 'Shop.Api.deps.json'),
        '--runtimeconfig', str(api / 'Shop.Api.runtimeconfig.json'), '--additionalprobingpath',
        str(Path.home() / '.nuget/packages'), str(directory / 'ExampleLocalization.dll')],
        cwd=ROOT, env=env, capture_output=True, text=True, timeout=90)
    (ROOT / 'artifacts/checks/d70-example-localization.log').write_text(result.stdout + result.stderr)
    assert result.returncode == 0, 'Localization command failed; retain the bounded local log. Do not reset examples.'
    body = json.loads(result.stdout.splitlines()[-1])
    assert body['DevelopmentOnly'] and body['EnglishVariantLabelsCorrected'] in (0, 14) and not body['FinancialOrInventoryChangesRequested']
    after = p.snapshot()
    p.ops.write(ROOT / 'artifacts/checks/d70-product-workspace/examples-after-localization.private.json', after, private=True)
    old, new = p.rma.table_map(before['tables']), p.rma.table_map(after['tables'])
    changed = {name for name in old if old[name] != new.get(name)}
    allowed = {'catalog.Products', 'catalog.Variants', 'catalog.ProductMedia', 'catalog.ProductTranslation', 'catalog.ProductPurchaseMethod', 'catalog.ProductAttributeValue', 'catalog.VariantAttributeValue', 'catalog.ProductWorkspaceCommands', 'identity.Audit'}
    assert changed <= allowed, 'A non-catalog or unexpected table changed.'
    assert before['histories'] == after['histories'] and before['metadata'] == after['metadata']
    p.photo.preserve_existing_files(private, p.photo.preserved_files())
    report = {'passed': True, 'finishedAtUtc': p.m.stamp(), 'database': 'Sayman', 'operator': 'tools/development/product-example-localization/Program.cs', 'operatorSha256': p.ops.sha(ROOT / 'tools/development/product-example-localization/Program.cs'), 'actor': 'development-sample:product-workspace', 'result': body, 'changedTables': sorted(changed), 'catalogCasCommandsUsed': True, 'schemaCredentialsInventoryPricesAndHistoryPreserved': True, 'backendArtifactUnchanged': True}
    p.ops.write(ROOT / 'artifacts/checks/d70-example-localization.json', report)
    print(json.dumps({'passed': True, 'correctedLabels': body['EnglishVariantLabelsCorrected'], 'evidence': 'artifacts/checks/d70-example-localization.json'}))


if __name__ == '__main__':
    main()
