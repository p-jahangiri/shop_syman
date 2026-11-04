import test from 'node:test';
import assert from 'node:assert/strict';
import { adminStyleNonce } from '../src/app/admin-style-nonce.ts';

test('Material styles use only the nonce issued in this document, without a fallback nonce', () => {
  const documentWith = (content: string | null) =>
    ({
      querySelector(selector: string) {
        assert.equal(selector, 'meta[name="sayman-style-nonce"]');
        return content === null ? null : { content };
      },
    }) as unknown as Document;
  assert.equal(adminStyleNonce(documentWith('response-one')), 'response-one');
  assert.equal(adminStyleNonce(documentWith('response-two')), 'response-two');
  assert.equal(adminStyleNonce(documentWith(null)), undefined);
  assert.equal(adminStyleNonce(), undefined);
});
