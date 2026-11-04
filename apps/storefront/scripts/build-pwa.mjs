import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const fontDirectory = path.dirname(require.resolve('@fontsource/vazirmatn/package.json'));
await mkdir(path.join(root, 'public/pwa/fonts'), { recursive: true });
for (const subset of ['arabic', 'latin'])
  await copyFile(
    path.join(fontDirectory, `files/vazirmatn-${subset}-400-normal.woff2`),
    path.join(root, `public/pwa/fonts/vazirmatn-${subset}.woff2`),
  );
await copyFile(
  path.join(fontDirectory, 'LICENSE'),
  path.join(root, 'public/pwa/fonts/LICENSE.txt'),
);
const inputs = [
  'components/offline/pwa-provider.tsx',
  'lib/offline/service-worker.js',
  'lib/offline/offline-catalog.ts',
  'app/pwa/icons/[locale]/[size]/route.tsx',
  'public/pwa/offline-fa.html',
  'public/pwa/offline-en.html',
  'public/pwa/offline.js',
  'public/pwa/offline.css',
  'public/pwa/fonts/vazirmatn-arabic.woff2',
  'public/pwa/fonts/vazirmatn-latin.woff2',
  'public/products/sayman-mark-olive-v1.png',
  'public/pwa/icons/sayman-olive-v1-180.png',
  'public/pwa/icons/sayman-olive-v1-192.png',
  'public/pwa/icons/sayman-olive-v1-512.png',
];
const hash = createHash('sha256');
for (const filename of inputs) {
  hash.update(filename);
  hash.update(await readFile(path.join(root, filename)));
}
const mediaPaths = '@sayman/web-shared/lib/media/media-paths.ts';
hash.update(mediaPaths);
hash.update(await readFile(new URL(import.meta.resolve(mediaPaths))));
const version = hash.digest('hex').slice(0, 16);
const template = await readFile(path.join(root, 'lib/offline/service-worker.js'), 'utf8');
await writeFile(
  path.join(root, 'public/sw.js'),
  template.replace('__SAYMAN_PWA_VERSION__', version),
);
console.log(`PWA public resources: ${version}`);
