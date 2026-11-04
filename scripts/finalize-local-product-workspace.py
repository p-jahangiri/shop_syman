"""Bind D70 acceptance to the three existing canonical artifacts and examples.

Read-only SQL/HTTP/process checks; writes evidence/descriptor metadata only.
Never authenticates, modifies accounts/policies, restarts, migrates or seeds.
Private Chrome QA stays pending until it is actually performed.
"""
from pathlib import Path
import importlib.util
import json
import re
import subprocess
from urllib.request import Request, urlopen
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('d70_final_helpers', ROOT / 'scripts/publish-local-product-workspace.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
FINAL = 'artifacts/checks/d70-product-workspace/final-acceptance.json'


def evidence(path):
    return {'path': str(path), 'sha256': p.ops.sha(ROOT / path)}


def request(port, path):
    try:
        response = urlopen(Request(f'http://127.0.0.1:{port}{path}'), timeout=20)
    except HTTPError as response:
        return response.code, response.headers, response.read()
    with response:
        return response.status, response.headers, response.read()


def main():
    acceptance, _ = p.accepted(ROOT / 'artifacts/checks/d70-product-workspace/run2/acceptance.json')
    assert acceptance['unitPassed'] == 1809 and acceptance['sqlPassed'] == 112 and acceptance['sqlDiscovered'] == 1119
    assert p.shape() == {'migrationCount': 93, 'tableCount': 244}
    examples = p.ops.read(ROOT / 'artifacts/checks/d70-examples-verification.json')
    browser = p.ops.read(ROOT / 'artifacts/checks/d70-browser/public-acceptance.json')
    assert examples['passed'] and examples['variantCount'] == 14 and browser['passed']
    assert browser['privateAdminQaPending'] and not browser['privateChromeAccepted']
    frontend = p.ops.read(ROOT / 'tmp/frontend-quality-build.json')
    assert frontend['passed'] and frontend['sourceStableDuringBuild'] and frontend['run'] == '0b85bc2403e247428a6547859f5ad7dd'
    assert all((ROOT / name).is_file() and p.ops.sha(ROOT / name) == digest for name, digest in frontend['source'].items())
    p.ops.write(ROOT / 'artifacts/checks/d70-final-storefront-build.json', frontend)
    logs = {
        'admin': ('artifacts/checks/d70-lazy-admin-tests.log', 394),
        'storefront': ('artifacts/checks/d70-video-routing-full-tests-2.log', 888),
        'proxy': ('artifacts/checks/d70-full-proxy-tests.log', 58),
    }
    checks = {}
    for name, (path, count) in logs.items():
        text = (ROOT / path).read_text()
        assert all(re.search(r'^# ' + key + ' ' + str(value) + r'$', text, re.M) for key, value in [('tests', count), ('pass', count), ('fail', 0), ('skipped', 0), ('cancelled', 0)])
        checks[name] = {**evidence(path), 'passed': count}
    for name, path in {
        'adminTypecheck': 'artifacts/checks/d70-lazy-admin-typecheck.log',
        'storefrontTypecheck': 'artifacts/checks/d70-video-routing-typecheck-2.log',
        'lint': 'artifacts/checks/d70-video-routing-lint-2.log',
        'format': 'artifacts/checks/d70-final-format-check.log',
        'publisherNegativeTests': 'artifacts/checks/d70-publisher-tests.log',
    }.items():
        text = (ROOT / path).read_text()
        assert not re.search(r'error TS\d|npm error|FAILED|\bFAIL\b', text)
        if name == 'format': assert 'All matched files use Prettier code style!' in text
        if name == 'publisherNegativeTests': assert 'Ran 4 tests' in text and text.rstrip().endswith('OK')
        checks[name] = evidence(path)
    components = {}
    states = {}
    for name in ('api', 'admin', 'storefront'):
        path = ROOT / f'tmp/{name}-runtime-current.json'
        state = p.ops.read(path)
        assert state['databaseMigrationCount'] == state['sourceMigrationCount'] == 93 and state['tableCount'] == 244
        runtime, _, manifest = p.rma.verify.manifest(state, name)
        pid = state[{'api': 'apiPid', 'admin': 'adminPid', 'storefront': 'pid'}[name]]
        assert p.rma.listener(name) == pid
        if name == 'api': p.owned_process(state)
        else:
            command = subprocess.check_output(['ps', '-p', str(pid), '-o', 'command='], text=True).strip()
            cwd = subprocess.check_output(['lsof', '-a', '-p', str(pid), '-d', 'cwd', '-Fn'], text=True).splitlines()
            expected = runtime / 'apps/storefront' if name == 'storefront' else ROOT
            assert 'n' + str(expected) in cwd
            assert bool(re.fullmatch(r'next-server(?: \(v[0-9.]+\))?', command)) if name == 'storefront' else command.endswith(' scripts/serve-main-admin.mjs')
        components[name] = {**manifest, 'pid': pid}
        states[name] = state
    http = []
    for port, path in [(5080, '/health/ready'), (3000, '/fa/catalog?q=D70-DEMO'), (3173, '/')]:
        code, headers, body = request(port, path)
        assert code == 200
        if port == 3173:
            nonce = re.search(r'<meta name="sayman-style-nonce" content="([^"]+)"', body.decode())
            assert nonce and "'nonce-" + nonce[1] + "'" in headers['Content-Security-Policy']
            assert "script-src 'self'" in headers['Content-Security-Policy']
        http.append({'port': port, 'path': path, 'status': code})
    for port in (5080, 3173):
        for path in ('/api/admin/catalog/workspace/products?search=D70-DEMO', '/api/admin/catalog/workspace/fields', '/api/admin/media/videos/capabilities'):
            code, headers, _ = request(port, path)
            assert code == 401 and 'no-store' in headers.get('Cache-Control', '')
            http.append({'port': port, 'path': path, 'status': code, 'privateNoStore': True})
    # Correct inherited build/test labels without rewriting historical releases.
    for name, state in states.items():
        state.update(productWorkspaceAutomatedAccepted=True, productWorkspaceExamplesApplied=True,
            productWorkspaceExamplesEvidence='artifacts/checks/d70-examples-verification.json',
            productWorkspaceAcceptanceEvidence=FINAL, productWorkspacePublicIabQaAccepted=True,
            productWorkspacePrivateAdminQaPending=True, fullProjectComplete=False)
        if name == 'api':
            state.update(unitPassed=1809, sqlPassed=112, targetedSqlPassed=112, sqlDiscovered=1119,
                sqlAcceptanceMode='20 complete classes in10 batches; fullSQL not run', mainSeedPerformed=True)
        else:
            state.update(frontendBuildRun=state['runtimeDirectory'].rsplit('-', 1)[-1],
                productWorkspaceUiDeployed=True, artifactBuildApiMigrationCount=93,
                artifactBuildApiTableCount=244, artifactReusedWithoutRebuild=False)
            if name == 'admin': state.update(adminContractPassed=394, adminProxyPassed=58)
        p.ops.write(ROOT / f'tmp/{name}-runtime-current.json', state)
        components[name]['descriptor'] = evidence(f'tmp/{name}-runtime-current.json')
    aggregate = p.ops.read(p.m.AGGREGATE)
    aggregate.update(productWorkspaceAutomatedAccepted=True, productWorkspaceExamplesApplied=True,
        productWorkspaceExamplesEvidence='artifacts/checks/d70-examples-verification.json',
        productWorkspaceAcceptanceEvidence=FINAL, productWorkspacePrivateAdminQaPending=True,
        sourceMigrationCount=93, databaseMigrationCount=93, tableCount=244, fullProjectComplete=False)
    p.ops.write(p.m.AGGREGATE, aggregate)
    report = {
        'passed': True, 'scope': 'D70 automated acceptance, canonical deployment and public examples; private Chrome QA remains pending',
        'finishedAtUtc': p.m.stamp(), 'schema': 93, 'tables': 244,
        'backend': evidence('artifacts/checks/d70-product-workspace/run2/acceptance.json'),
        'unitPassed': 1809, 'unitReusedFromRun1': True, 'sqlPassed': 112, 'sqlClasses': 20,
        'sqlDiscovered': 1119, 'fullSqlRun': False, 'remainingFixtureDatabases': 0,
        'frontend': checks, 'currentFrontendSourceEntries': len(frontend['source']),
        'finalStorefrontBuild': evidence('artifacts/checks/d70-final-storefront-build.json'),
        'adminPublication': evidence('artifacts/checks/frontend-quality-68ddaa9376e04b4bb509a93aca5f40e5-main-release.json'),
        'apiPublicationAndBackup': evidence('artifacts/checks/d70-product-workspace/api-6f8b3b22dddf43f087671f8d7771a555-release.json'),
        'examples': evidence('artifacts/checks/d70-examples-verification.json'),
        'publicIabBrowser': evidence('artifacts/checks/d70-browser/public-acceptance.json'),
        'components': components, 'http': http, 'privateAdminChromeQaPending': True,
        'privateQaBlocker': 'Mac locked; owner unlock question pending. No bootstrap login or MFA bypass.',
        'smsSent': False, 'credentialOrMfaChanges': False, 'financialPolicyChanges': False,
        'fullProjectComplete': False,
    }
    p.ops.write(ROOT / FINAL, report)
    print(json.dumps({'passed': True, 'schema': 93, 'products': 6, 'variants': 14, 'privateAdminQaPending': True, 'evidence': FINAL}))


if __name__ == '__main__':
    main()
