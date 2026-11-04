import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { storefrontSnapshot } from '../apps/storefront/lib/data/fixtures.ts';
import { localizeData } from '../apps/storefront/lib/navigation/i18n.ts';
const directory = fileURLToPath(new URL('../backend/Seed/', import.meta.url));
await mkdir(directory, { recursive: true });
await writeFile(
  `${directory}development.json`,
  JSON.stringify({ fa: storefrontSnapshot, en: localizeData(storefrontSnapshot, 'en') }, null, 2) +
    '\n',
);
console.log('Exported explicit development seed; no credentials included.');
