import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tooling = createRequire(path.join(root, 'tools/lint/package.json'));
const mode = process.argv[2];
const lint = mode === 'lint' || mode === 'lint:fix';
if (!lint && mode !== 'format' && mode !== 'format:check') {
  throw new Error('Expected lint, lint:fix, format or format:check.');
}
const name = lint ? 'eslint' : 'prettier';
let manifest;
try {
  manifest = tooling.resolve(`${name}/package.json`);
} catch {
  process.stderr.write('Install the pinned code-quality tools: npm ci --prefix tools/lint\n');
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
const executable = path.resolve(
  path.dirname(manifest),
  typeof pkg.bin === 'string' ? pkg.bin : pkg.bin[name],
);
const extra = process.argv.slice(3);
const targets = ['apps', 'packages', 'scripts', 'tools/lint', 'eslint.config.mjs'];
const args = lint
  ? [executable, '.', '--max-warnings', '0', ...(mode === 'lint:fix' ? ['--fix'] : []), ...extra]
  : [executable, mode === 'format' ? '--write' : '--check', ...targets, ...extra];
const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
