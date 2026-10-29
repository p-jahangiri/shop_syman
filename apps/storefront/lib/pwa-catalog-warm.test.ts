import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogWarmup } from './pwa-catalog-warm.ts';

function harness(locale: 'fa' | 'en' = 'fa') {
  let loaded = false;
  let eligible = true;
  let afterLoad: (() => void) | undefined;
  let idle: (() => void) | undefined;
  let fail = false;
  const requests: { path: string; init: RequestInit }[] = [];
  const warmer = createCatalogWarmup(locale, {
    loaded: () => loaded,
    eligible: () => eligible,
    afterLoad(task) {
      afterLoad = task;
      return () => {
        afterLoad = undefined;
      };
    },
    idle(task) {
      idle = task;
      return () => {
        idle = undefined;
      };
    },
    async fetcher(path, init) {
      requests.push({ path, init });
      if (fail) throw Error('offline');
    },
  });
  return {
    warmer,
    requests,
    setEligible: (value: boolean) => (eligible = value),
    setFail: (value: boolean) => (fail = value),
    load() {
      loaded = true;
      const task = afterLoad;
      afterLoad = undefined;
      task?.();
    },
    idle() {
      const task = idle;
      idle = undefined;
      task?.();
    },
  };
}

test('catalog warming waits for load and idle, requests only the active language without credentials', async () => {
  const h = harness('en');
  h.warmer.request();
  h.idle();
  assert.equal(h.requests.length, 0);
  h.load();
  assert.equal(h.requests.length, 0);
  h.idle();
  await Promise.resolve();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].path, '/pwa/catalog/en.json');
  assert.equal(h.requests[0].init.credentials, 'omit');
  assert.equal(h.requests[0].init.cache, 'no-cache');
});

test('controller and registration notifications coalesce into one background refresh', async () => {
  const h = harness();
  h.warmer.request();
  h.warmer.request();
  h.load();
  h.warmer.request();
  h.idle();
  await new Promise<void>((resolve) => setImmediate(resolve));
  h.warmer.request();
  h.idle();
  assert.equal(h.requests.length, 1);
});

test('eligibility is checked again at execution so navigation to a private page prevents warming', () => {
  const h = harness();
  h.warmer.request();
  h.load();
  h.setEligible(false);
  h.idle();
  assert.equal(h.requests.length, 0);
  h.setEligible(true);
  h.warmer.request();
  h.idle();
  assert.equal(h.requests.length, 1);
});

test('disabled, hidden or constrained-network contexts can skip the optional request', () => {
  const h = harness();
  h.setEligible(false);
  h.warmer.request();
  h.load();
  h.idle();
  assert.equal(h.requests.length, 0);
});

test('unmount cancels scheduled work before load or before idle', () => {
  for (const loaded of [false, true]) {
    const h = harness();
    h.warmer.request();
    if (loaded) h.load();
    h.warmer.dispose();
    h.load();
    h.idle();
    h.warmer.request();
    assert.equal(h.requests.length, 0);
  }
});

test('unmount aborts a request already in flight', () => {
  const h = harness();
  h.load();
  h.warmer.request();
  h.idle();
  h.warmer.dispose();
  assert.equal(h.requests[0].init.signal?.aborted, true);
});

test('an optional network failure can be retried on a later online event', async () => {
  const h = harness();
  h.load();
  h.setFail(true);
  h.warmer.request();
  h.idle();
  await new Promise<void>((resolve) => setImmediate(resolve));
  h.setFail(false);
  h.warmer.request();
  h.idle();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(h.requests.length, 2);
});

test('returning online can explicitly refresh a previously warmed catalog after load and idle', async () => {
  const h = harness();
  h.load();
  h.warmer.request();
  h.idle();
  await new Promise<void>((resolve) => setImmediate(resolve));
  h.warmer.request(true);
  assert.equal(h.requests.length, 1);
  h.idle();
  assert.equal(h.requests.length, 2);
});
