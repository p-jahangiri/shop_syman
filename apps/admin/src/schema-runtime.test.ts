import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('schema runtime avoids even an eval probe with the admin strict CSP', () => {
  const script = `
    let calls = 0;
    globalThis.Function = new Proxy(globalThis.Function, {
      construct() { calls++; throw Error('CSP'); },
      apply() { calls++; throw Error('CSP'); },
    });
    await import(${JSON.stringify(new URL('./schema-runtime.ts', import.meta.url).href)});
    const { z } = await import('zod');
    const result = z.object({ amount: z.string().regex(/^\\d+$/) }).strict().safeParse({amount:'9007199254740993'});
    if (!result.success || calls !== 0) throw Error('Schema attempted eval or failed validation');
  `;
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '-e', script],
    {
      cwd: new URL('../../..', import.meta.url),
      encoding: 'utf8',
      timeout: 15000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
});
