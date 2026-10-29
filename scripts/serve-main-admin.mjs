// Start the selected canonical admin after verifying its frozen assets and proxy.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const descriptor = path.join(repository, 'tmp/admin-runtime-current.json');
const state = JSON.parse(readFileSync(descriptor, 'utf8'));
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
if (state.admin !== 'http://127.0.0.1:3173' || state.api !== 'http://127.0.0.1:5080') {
  throw new Error('Expected the canonical local admin and API.');
}
const directory = path.resolve(repository, state.runtimeDirectory);
if (!directory.startsWith(path.join(repository, 'tmp') + path.sep)) {
  throw new Error('Selected runtime must stay inside workspace tmp.');
}
const manifestPath = path.resolve(repository, state.artifactManifest);
if (hash(manifestPath) !== state.artifactManifestSha256)
  throw new Error('Artifact manifest changed.');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
for (const [relative, expected] of Object.entries(manifest.artifacts)) {
  const file = path.resolve(directory, relative);
  if (!file.startsWith(directory + path.sep) || hash(file) !== expected) {
    throw new Error('Selected admin artifact differs from its accepted build.');
  }
}
const proxy = path.join(directory, 'server.mjs');
if (hash(proxy) !== state.proxyModuleSha256) throw new Error('Selected proxy changed.');
const { createAdminServer } = await import(pathToFileURL(proxy).href);
const server = createAdminServer({ root: directory, apiUrl: state.api, publicUrl: state.admin });
server.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
server.listen(3173, '127.0.0.1', () => {
  state.adminPid = process.pid;
  const temporary = descriptor + '.next';
  writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n');
  renameSync(temporary, descriptor);
  console.log(JSON.stringify({ admin: state.admin, api: state.api, pid: process.pid }));
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    server.closeAllConnections();
    server.close(() => process.exit(0));
  });
}
