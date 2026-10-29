import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  marketFiltersSchema,
  marketValuesSchema,
  marketPageSchema,
  marketFacetsSchema,
} from '../apps/storefront/lib/market-contract.ts';
const dir = 'artifacts/checks/market-attributes-main-wire';
await mkdir(dir);
const entries: { file: string; sha256: string }[] = [];
for (const locale of ['fa', 'en'])
  for (const port of [5080, 3000]) {
    const read = async <T extends { locale: string }>(
      endpoint: string,
      body: unknown,
      schema: { parse: (v: unknown) => T },
    ) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/market/${locale}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        redirect: 'error',
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('cache-control') ?? '', /no-store/);
      const bytes = Buffer.from(await response.arrayBuffer());
      const parsed = schema.parse(JSON.parse(bytes.toString('utf8')));
      assert.equal(parsed.locale, locale);
      const file = `${port}-${locale}-${endpoint}.json`;
      await writeFile(`${dir}/${file}`, bytes);
      entries.push({ file, sha256: createHash('sha256').update(bytes).digest('hex') });
      return parsed;
    };
    const definitions = await read('filters', { categoryId: 'phones' }, marketFiltersSchema);
    assert.deepEqual(
      definitions.filters.map((x) => x.key),
      ['display', 'ram', 'storage'],
    );
    const values = await read(
      'facet-values',
      { search: { categoryId: 'phones' }, key: 'display' },
      marketValuesSchema,
    );
    assert.equal(values.values.length, 1);
    assert.equal(values.values[0].count, 3);
    assert.equal(values.values[0].label, locale === 'fa' ? '۶.۷ اینچ' : '6.7 inches');
    const search = {
      categoryId: 'phones',
      attributes: [{ key: 'display', values: [values.values[0].value] }],
    };
    const page = await read('search', search, marketPageSchema);
    assert.equal(page.total, 3);
    assert.deepEqual(page.appliedAttributes, search.attributes);
    const facets = await read('facets', search, marketFacetsSchema);
    assert.deepEqual(facets.scope.attributes, search.attributes);
    assert.equal(facets.categories[0].count, 3);
  }
await writeFile(
  `${dir}/acceptance.json`,
  JSON.stringify(
    {
      passed: true,
      actualMainSqlHttpBodies: true,
      strictProductionDecoders: true,
      responses: entries.length,
      entries,
      readOnly: true,
    },
    null,
    2,
  ) + '\n',
);
console.log(`${entries.length} exact main API/BFF typed responses accepted.`);
