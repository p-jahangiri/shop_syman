import test from 'node:test';
import assert from 'node:assert/strict';
import { isCustomerOfferPath } from './offer-path.ts';
import {
  offerTestRequest as requestId,
  offerTestId as offerId,
  offerTestCommand as command,
} from './offer.test-fixtures.ts';
const root = `/api/sourcing/requests/${requestId}/offers`,
  child = root + '/' + offerId;
test('authenticated offer paths are canonical owner children and never staff, authority or traversal routes', () => {
  for (const path of [
    root,
    root + '?cursor=a_-',
    child,
    child + '/events',
    child + '/events?cursor=a_-',
    child + '/accept',
    child + '/decline',
    child + '/commands/accept/' + command,
    child + '/commands/decline/' + command.replaceAll('-', ''),
  ])
    assert.equal(isCustomerOfferPath(path), true, path);
  for (const path of [
    root + '?ownerId=other',
    root + '?cursor=a&cursor=b',
    root + '?cursor=a&ownerId=other',
    child + '/publish',
    child + '/convert',
    child + '/commands/save/' + command,
    child + '/commands/accept/' + '0'.repeat(32),
    root + '/../admin',
    root + '/%2e%2e/admin',
    'https://evil.test' + child,
    root + '/' + '0'.repeat(32),
    root.replace(requestId, requestId.toUpperCase()),
    child + '#private',
  ])
    assert.equal(isCustomerOfferPath(path), false, path);
});
