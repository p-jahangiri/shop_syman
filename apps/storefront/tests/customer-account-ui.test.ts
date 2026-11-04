import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import swc from '@swc/core';
import { setImmediate } from 'node:timers/promises';
import * as client from '../lib/account/customer-account-client.ts';
import * as contract from '../lib/account/customer-account-contract.ts';
import type { CustomerAccountProfile } from '../lib/account/customer-account-contract.ts';

// Exercise the actual TSX handlers with deterministic hooks/transport confined
// to this file. These tests do not create sessions or change a database.
type Element = { type: unknown; props: Record<string, unknown> };
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children)];
}
function text(value: unknown): string {
  if (value == null || value === false) return '';
  if (Array.isArray(value)) return value.map(text).join('');
  return typeof value === 'object' ? text((value as Element).props?.children) : String(value);
}
const profile: CustomerAccountProfile = {
  id: 'a'.repeat(32),
  userName: 'synthetic-account',
  displayName: 'نام آزمایشی',
  email: 'synthetic@example.test',
  emailConfirmed: true,
  phoneNumber: '09120000000',
  phoneNumberConfirmed: false,
  createdAt: '2026-10-30T00:00:00Z',
  passwordEnabled: true,
  twoFactorEnabled: false,
  version: 'synthetic-version-1',
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
};
async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await setImmediate();
  }
  assert.fail('Account handler did not reach its expected state');
}
function harness(locale = 'fa', supplied = profile) {
  const slots: unknown[] = [],
    dependencies = new Map<number, unknown[] | undefined>(),
    cleanups = new Map<number, unknown>(),
    effects: (() => void)[] = [],
    changed: CustomerAccountProfile[] = [],
    passwordOutcomes: string[] = [];
  let index = 0,
    revision = 1,
    value = structuredClone(supplied),
    status = 'member',
    sessionOwner = supplied.id,
    fetcher: (path: string, init: RequestInit) => Promise<Response> = async () =>
      Response.json(value);
  const store = {
    snapshot: () => ({
      status,
      session: status === 'member' ? { user: { id: sessionOwner } } : null,
    }),
    viewRevision: () => revision,
    fetch: (path: string, init: RequestInit) => fetcher(path, init),
  };
  const same = (a: unknown[] | undefined, b: unknown[] | undefined) =>
    !!a && !!b && a.length === b.length && a.every((item, at) => Object.is(item, b[at]));
  const react = {
    useState(initial: unknown) {
      const at = index++;
      if (!(at in slots)) slots[at] = typeof initial === 'function' ? initial() : initial;
      return [
        slots[at],
        (next: unknown) => {
          slots[at] = typeof next === 'function' ? next(slots[at]) : next;
        },
      ];
    },
    useRef(initial: unknown) {
      const at = index++;
      return (slots[at] ??= { current: initial });
    },
    useEffect(callback: () => unknown, deps?: unknown[]) {
      const at = index++;
      if (same(dependencies.get(at), deps)) return;
      dependencies.set(at, deps ? [...deps] : undefined);
      effects.push(() => {
        const cleanup = cleanups.get(at);
        if (typeof cleanup === 'function') cleanup();
        cleanups.set(at, callback());
      });
    },
  };
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const mocks: Record<string, unknown> = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'lucide-react': new Proxy({}, { get: (_object, name) => String(name) }),
    '../auth/auth-provider': { useCustomerSession: () => ({ store, ...store.snapshot() }) },
    '../navigation/locale-provider': { useI18n: () => ({ locale }) },
    '../shared/ui': { Button: 'Button' },
    '@/lib/account/customer-account-contract': contract,
    '@/lib/account/customer-account-client': client,
    './account-settings.css': {},
  };
  const source = fs.readFileSync(
      new URL('../components/account/account-settings.tsx', import.meta.url),
      'utf8',
    ),
    compiled = swc.transformSync(source, {
      filename: 'account-settings.tsx',
      jsc: {
        parser: { syntax: 'typescript', tsx: true },
        transform: { react: { runtime: 'automatic' } },
        target: 'es2022',
      },
      module: { type: 'commonjs' },
    }),
    exports: Record<string, unknown> = {};
  vm.runInNewContext(compiled.code, {
    exports,
    require: (name: string) => {
      assert.ok(name in mocks, 'Unexpected account import: ' + name);
      return mocks[name];
    },
    AbortController,
    console,
  });
  const component = exports.AccountSettings as (props: unknown) => unknown;
  function render() {
    index = 0;
    const result = component({
      profile: value,
      onProfileChanged: (next: CustomerAccountProfile) => {
        changed.push(next);
        value = next;
      },
      onPasswordChanged: async (outcome: string) => {
        passwordOutcomes.push(outcome);
      },
    });
    while (effects.length) effects.shift()!();
    return result;
  }
  render();
  const h = {
    render,
    changed,
    passwordOutcomes,
    fetch(next: typeof fetcher) {
      fetcher = next;
    },
    switchOwner(next: string, replaceProfile = false) {
      sessionOwner = next;
      revision++;
      if (replaceProfile) value = { ...value, id: next, displayName: 'Another synthetic account' };
    },
    guest() {
      status = 'guest';
      revision++;
    },
    dispose() {
      for (const cleanup of cleanups.values()) if (typeof cleanup === 'function') cleanup();
    },
    input(id: string, next: string) {
      const input = elements(render()).find(
        (element) => element.type === 'input' && element.props.id === id,
      );
      assert.ok(input, 'Missing account input: ' + id);
      (input.props.onChange as (event: unknown) => void)({ target: { value: next } });
    },
    form(which: 'profile' | 'password') {
      const forms = elements(render()).filter((element) => element.type === 'form'),
        form = forms[which === 'profile' ? 0 : 1];
      assert.ok(form, 'Missing account form: ' + which);
      return form.props.onSubmit as (event: unknown) => Promise<void>;
    },
    fillPassword() {
      h.input('account-current-password', 'Current!Password42');
      h.input('account-new-password', 'New!Password43');
      h.input('account-confirm-password', 'New!Password43');
    },
  };
  return h;
}
const submit = { preventDefault() {} };

test('actual settings render verified read-only contacts, accessible password controls and accurate inactive MFA in FA/EN', () => {
  for (const locale of ['fa', 'en']) {
    const h = harness(locale),
      tree = h.render(),
      nodes = elements(tree);
    assert.equal(nodes.filter((node) => node.type === 'input').length, 4);
    assert.ok(text(tree).includes(profile.email!));
    assert.ok(text(tree).includes(profile.phoneNumber!));
    assert.ok(text(tree).includes(locale === 'fa' ? 'تأیید نشده' : 'Not verified'));
    assert.ok(text(tree).includes(locale === 'fa' ? 'فعال نیست' : 'Not enabled'));
    for (const id of [
      'account-current-password',
      'account-new-password',
      'account-confirm-password',
    ]) {
      const input = nodes.find((node) => node.type === 'input' && node.props.id === id)!;
      assert.equal(input.props.type, 'password');
      assert.equal(input.props.maxLength, 128);
      assert.equal(input.props['aria-describedby'], 'account-password-guidance');
      assert.ok(nodes.some((node) => node.type === 'label' && node.props.htmlFor === id));
      assert.ok(
        nodes.some(
          (node) =>
            node.type === 'button' &&
            node.props['aria-controls'] === id &&
            typeof node.props['aria-label'] === 'string',
        ),
      );
    }
    h.guest();
    assert.equal(h.render(), null);
    h.dispose();
  }
});

test('name handler sends only displayName/current version and serializes double-submit without hiding another owner', async () => {
  const h = harness(),
    reply = deferred<Response>();
  let calls = 0;
  h.fetch(async (_path, init) => {
    calls++;
    assert.deepEqual(JSON.parse(String(init.body)), {
      displayName: 'نام تازه',
      version: profile.version,
    });
    return reply.promise;
  });
  h.input('account-display-name', '  نام تازه  ');
  const handler = h.form('profile'),
    pending = handler(submit);
  await handler(submit);
  assert.equal(calls, 1);
  reply.resolve(Response.json({ ...profile, displayName: 'نام تازه', version: 'next-version' }));
  await pending;
  assert.equal(h.changed.length, 1);
  assert.equal(h.changed[0].displayName, 'نام تازه');
  assert.ok(text(h.render()).includes('نام نمایشی شما ذخیره شد'));
  h.switchOwner('b'.repeat(32));
  assert.equal(h.render(), null);
  h.dispose();
});

test('profile CAS conflict loads current details and never replays the overwritten name form', async () => {
  const h = harness(),
    paths: string[] = [];
  h.fetch(async (path, init) => {
    paths.push(init.method + ' ' + path);
    return init.method === 'PUT'
      ? Response.json({ title: 'profile_conflict' }, { status: 409 })
      : Response.json({ ...profile, displayName: 'نام هم‌زمان', version: 'concurrent-version' });
  });
  h.input('account-display-name', 'نام کهنه');
  await h.form('profile')(submit);
  assert.deepEqual(paths, ['PUT /api/account/profile', 'GET /api/account/profile']);
  assert.equal(h.changed[0].displayName, 'نام هم‌زمان');
  assert.ok(text(h.render()).includes('در جای دیگری تغییر کرده بود'));
  const field = elements(h.render()).find((node) => node.props.id === 'account-display-name')!;
  assert.equal(field.props.value, 'نام هم‌زمان');
  h.dispose();
});

test('late parsed profile response after switching accounts cannot update the new user', async () => {
  const h = harness(),
    reply = deferred<Response>();
  h.fetch(async () => reply.promise);
  h.input('account-display-name', 'نام دیررس');
  const pending = h.form('profile')(submit);
  h.switchOwner('b'.repeat(32), true);
  h.render();
  reply.resolve(Response.json({ ...profile, displayName: 'نام دیررس' }));
  await pending;
  assert.equal(h.changed.length, 0);
  assert.equal(
    elements(h.render()).find((node) => node.props.id === 'account-display-name')?.props.value,
    'Another synthetic account',
  );
  h.dispose();
});

test('password204 clears all secrets, locks repeated submission and requests an explicit fresh session', async () => {
  const h = harness();
  let calls = 0;
  h.fetch(async (_path, init) => {
    calls++;
    assert.deepEqual(JSON.parse(String(init.body)), {
      currentPassword: 'Current!Password42',
      newPassword: 'New!Password43',
    });
    return new Response(null, { status: 204 });
  });
  h.fillPassword();
  await h.form('password')(submit);
  assert.deepEqual(h.passwordOutcomes, ['changed']);
  for (const field of elements(h.render()).filter(
    (node) => node.type === 'input' && String(node.props.id).includes('password'),
  )) {
    assert.equal(field.props.value, '');
    assert.equal(field.props.type, 'password');
    assert.equal(field.props.disabled, true);
  }
  await h.form('password')(submit);
  assert.equal(calls, 1);
  h.dispose();
});

test('unknown password outcome never retries and locally ends the original session even when navigation aborts', async () => {
  for (const unmount of [false, true]) {
    const h = harness(),
      reply = deferred<Response>();
    let calls = 0;
    h.fetch(async () => {
      calls++;
      return reply.promise;
    });
    h.fillPassword();
    const pending = h.form('password')(submit);
    if (unmount) h.dispose();
    reply.resolve(Response.json({ title: 'account_unavailable' }, { status: 503 }));
    await pending;
    assert.deepEqual(h.passwordOutcomes, ['unknown']);
    assert.equal(calls, 1);
    if (!unmount) {
      assert.ok(text(h.render()).includes('نتیجهٔ تغییر رمز دریافت نشد'));
      await h.form('password')(submit);
      assert.equal(calls, 1);
      h.dispose();
    }
  }
});

test('a rejected current password clears secrets but does not report success or revoke the known session', async () => {
  const h = harness();
  h.fetch(async () => Response.json({ title: 'invalid_current_password' }, { status: 400 }));
  h.fillPassword();
  await h.form('password')(submit);
  assert.deepEqual(h.passwordOutcomes, []);
  assert.ok(text(h.render()).includes('رمز فعلی صحیح نیست'));
  for (const field of elements(h.render()).filter(
    (node) => node.type === 'input' && String(node.props.id).includes('password'),
  ))
    assert.equal(field.props.value, '');
  h.dispose();
});

test('a password response after changing accounts cannot revoke the new owner and confirmation mismatch sends nothing', async () => {
  const h = harness(),
    reply = deferred<Response>();
  let calls = 0;
  h.fetch(async () => {
    calls++;
    return reply.promise;
  });
  h.fillPassword();
  h.input('account-confirm-password', 'Mismatch!Password43');
  await h.form('password')(submit);
  assert.equal(calls, 0);
  assert.ok(text(h.render()).includes('مطابقت ندارد'));
  h.input('account-confirm-password', 'New!Password43');
  const pending = h.form('password')(submit);
  await waitFor(() => calls === 1);
  h.switchOwner('b'.repeat(32), true);
  h.render();
  reply.resolve(new Response(null, { status: 204 }));
  await pending;
  assert.deepEqual(h.passwordOutcomes, []);
  h.dispose();
});
