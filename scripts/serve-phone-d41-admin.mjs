// Private phone review; artifact hashes are checked before serving.
console.error(
  'D44: persistent phone preview launch is retired. Use the single Main local shop at http://127.0.0.1:3000 and admin at http://127.0.0.1:3173. Historical harness/test sources and reports are retained.',
);
process.exit(2);
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const report = JSON.parse(
  readFileSync(path.resolve(repository, 'tmp/phone-d41-admin-build.json'), 'utf8'),
);
if (
  report.exitCode !== 0 ||
  report.publicUrl !== 'http://sayman-d41-ui.localhost:3110' ||
  !/^tmp\/admin-phone-d41-root-[a-f0-9]{32}$/.test(report.directory)
)
  throw Error('Verified private phone build required.');
const directory = path.resolve(repository, report.directory),
  hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
for (const [relative, expected] of Object.entries(report.artifacts)) {
  const file = path.resolve(directory, relative);
  if (!file.startsWith(directory + path.sep) || hash(file) !== expected)
    throw Error('Frozen admin artifact changed: ' + relative);
}
if (hash(path.resolve(repository, 'apps/admin/server.mjs')) !== report.serverSha256)
  throw Error('Admin proxy source changed.');
const { createAdminServer } = await import(
  pathToFileURL(path.resolve(repository, 'apps/admin/server.mjs')).href
);
const server = createAdminServer({ root: directory, apiUrl: 'http://127.0.0.1:5184' });
server.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
server.listen(3180, '127.0.0.1', () =>
  console.log(
    JSON.stringify({
      url: 'http://sayman-d41-admin.localhost:3180',
      pid: process.pid,
      mainChanged: false,
    }),
  ),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => server.close(() => process.exit(0)));
