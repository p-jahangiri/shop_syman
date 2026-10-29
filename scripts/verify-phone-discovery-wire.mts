import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  phoneItemSchema,
  phonePageSchema,
  phoneInterestSchema,
  phoneInterestPageSchema,
  phoneInterestResultSchema,
} from '../apps/storefront/lib/phone-discovery-contract.ts';
import {
  readPhoneInbox,
  readPhoneInboxAcknowledgement,
} from '../apps/storefront/lib/phone-inbox-contract.ts';
import { notificationCountSchema } from '../apps/storefront/lib/notification-contract.ts';
import {
  sourcingCartSchema,
  sourcingDetailSchema,
  sourcingMutationSchema,
} from '../apps/storefront/lib/sourcing-contract.ts';
import { offerDetailSchema, offerMutationSchema } from '../apps/storefront/lib/offer-contract.ts';
import { cartSnapshotV2Schema } from '../apps/storefront/lib/cart-v2-contract.ts';
import {
  cartConversionCandidateSchema,
  cartConversionMutationSchema,
} from '../apps/storefront/lib/cart-conversion-contract.ts';
import { phoneConfigurationResultSchema } from '../apps/admin/src/market-phone-contract.ts';
import {
  supplyMutationSchema,
  receivingMutationSchema,
} from '../apps/admin/src/supply-contract.ts';
import { allocationMutationSchema } from '../apps/admin/src/allocation-contract.ts';

// Usage: node --experimental-strip-types scripts/verify-phone-discovery-wire.mts --mark-stale
// After both final SQL classes finish, run with --final. TRX windows prove freshness.
// Optional positional arguments are discovery and notification capture directories.
const root = fileURLToPath(new URL('../', import.meta.url)),
  args = process.argv.slice(2),
  mark = args.includes('--mark-stale'),
  final = args.includes('--final'),
  reports = args.filter((v) => v.startsWith('--report=')),
  directories = args.filter((v) => !v.startsWith('--'));
if (
  mark === final ||
  (directories.length !== 0 && directories.length !== 2) ||
  reports.length > 1 ||
  (mark && reports.length > 0) ||
  args.some(
    (v) =>
      v.startsWith('--') && !v.startsWith('--report=') && !['--mark-stale', '--final'].includes(v),
  )
)
  throw Error(
    'Use --mark-stale or --final, optional capture directories, and --report=artifacts/checks/name.json for a separate revalidation report.',
  );
const discovery = path.resolve(root, directories[0] ?? 'artifacts/checks/phone-discovery-wire'),
  notifications = path.resolve(
    root,
    directories[1] ?? 'artifacts/checks/phone-notification-sql-wire-final',
  ),
  baselinePath = path.resolve(root, 'artifacts/checks/phone-discovery-wire-pre-final.json'),
  reportPath = path.resolve(
    root,
    reports[0]?.slice('--report='.length) ??
      'artifacts/checks/phone-discovery-production-wire.json',
  );
if (
  !reportPath.startsWith(path.join(root, 'artifacts/checks') + path.sep) ||
  !reportPath.endsWith('.json')
)
  throw Error('Wire report must be a JSON file inside artifacts/checks.');
const digest = (raw: Uint8Array) => createHash('sha256').update(raw).digest('hex'),
  relative = (name: string) => path.relative(root, name);
if (mark) {
  const captures = [];
  for (const directory of [discovery, notifications])
    for (const name of (await readdir(directory)).filter((v) => v.endsWith('.json')).sort()) {
      const file = path.join(directory, name),
        raw = await readFile(file),
        info = await stat(file);
      captures.push({
        file: relative(file),
        sha256: digest(raw),
        bytes: raw.byteLength,
        mtimeMs: info.mtimeMs,
      });
    }
  const baseline = {
    schemaVersion: 1,
    phase: 'pre-final-stale',
    accepted: false,
    markedAt: new Date().toISOString(),
    markedAtMs: Date.now(),
    rawBodiesUnmodified: true,
    reason:
      'Captures precede final configurationId wire correction, merge guards and backend fence; no production decoder acceptance is claimed.',
    directories: [relative(discovery), relative(notifications)],
    captures,
  };
  await writeFile(baselinePath, JSON.stringify(baseline, null, 2) + '\n');
  console.log(
    JSON.stringify({
      phase: baseline.phase,
      accepted: false,
      captures: captures.length,
      baseline: relative(baselinePath),
    }),
  );
} else {
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
  assert.equal(baseline.accepted, false);
  async function finalRun(file: string, minimum: number, requiredClass: string) {
    const raw = await readFile(path.join(root, file)),
      text = new TextDecoder('utf-8', { fatal: true }).decode(raw),
      attributes = (tag: string) => {
        const element = text.match(new RegExp('<' + tag + '\\b[^>]*>'))?.[0];
        assert.ok(element, 'Missing TRX ' + tag);
        return Object.fromEntries(
          [...element.matchAll(/([A-Za-z][A-Za-z0-9]*)="([^"]*)"/g)].map((match) => [
            match[1],
            match[2],
          ]),
        );
      },
      times = attributes('Times'),
      counts = attributes('Counters');
    assert.ok(text.includes(requiredClass), 'Wrong SQL test class.');
    assert.ok(Number(counts.passed) >= minimum);
    assert.equal(counts.passed, counts.executed);
    assert.equal(counts.executed, counts.total);
    for (const key of ['failed', 'error', 'aborted', 'timeout', 'notExecuted'])
      assert.equal(counts[key], '0');
    const startMs = Date.parse(times.start),
      finishMs = Date.parse(times.finish);
    assert.ok(Number.isFinite(startMs) && finishMs > startMs);
    return {
      file,
      sha256: digest(raw),
      start: times.start,
      finish: times.finish,
      startMs,
      finishMs,
      passed: Number(counts.passed),
    };
  }
  const finalRuns = {
    discovery: await finalRun(
      'artifacts/checks/phone-discovery-sql-results/phone-final-domain-and-deadlines.trx',
      24,
      'PhoneDiscoverySqlTests',
    ),
    notifications: await finalRun(
      'artifacts/checks/phone-notification-sql-results/phone-notifications-and-seed-sql-final.trx',
      10,
      'PhoneNotificationSqlTests',
    ),
  };
  const moduleParityPath = path.join(root, 'artifacts/checks/phone-backend-module-hashes.json'),
    moduleParityRaw = await readFile(moduleParityPath),
    moduleParity = JSON.parse(moduleParityRaw.toString('utf8'));
  assert.equal(moduleParity.moduleCount, 14);
  assert.equal(moduleParity.allThreeMatch, true);
  assert.equal(moduleParity.modules.length, 14);
  for (const item of moduleParity.modules) {
    assert.equal(item.allThreeMatch, true);
    for (const [target, directory] of Object.entries({
      api: 'backend/src/Shop.Api/bin/Debug/net10.0',
      unit: 'backend/tests/Shop.Tests/bin/Debug/net10.0',
      sql: 'backend/tests/Shop.SqlTests/bin/Debug/net10.0',
    }))
      assert.equal(
        digest(await readFile(path.join(root, directory, item.file))),
        item.hashes[target],
        'Final module changed: ' + target + '/' + item.file,
      );
  }

  const metadata = z
    .object({
      method: z.enum(['GET', 'POST', 'PUT']),
      path: z.string().startsWith('/api/'),
      status: z.union([z.literal(200), z.literal(201)]),
      actualSqlHttpResponse: z.literal(true),
      syntheticQaOnly: z.literal(true),
      cacheControl: z.string().optional(),
    })
    .strict();
  type Meta = z.infer<typeof metadata>;
  type Rule<Name extends string = string, Value = unknown> = {
    name: Name;
    method: Meta['method'];
    route: RegExp;
    decode: (raw: unknown, meta: Meta, match: RegExpMatchArray) => Value;
    public?: boolean;
  };
  const id = '([a-f0-9]{32})',
    command = '([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})';
  function rule<Name extends string, Value>(
    name: Name,
    method: Meta['method'],
    route: string,
    schema: { parse: (raw: unknown) => Value },
    bind?: (value: Value, match: RegExpMatchArray) => void,
    isPublic = true,
  ): Rule<Name, Value> {
    return {
      name,
      method,
      route: new RegExp('^' + route + '$'),
      decode: (raw, _meta, match) => {
        const value = schema.parse(raw);
        bind?.(value, match);
        return value;
      },
      public: isPublic,
    };
  }
  const request = '/api/sourcing/requests/' + id,
    adminRequest = '/api/admin/sourcing/requests/' + id,
    offer = request + '/offers/' + id,
    adminOffer = adminRequest + '/offers/' + id,
    inventory = '/api/admin/inventory/sourcing-requests/' + id + '/tasks/' + id;
  function inbox<Name extends string>(name: Name): Rule<Name, ReturnType<typeof readPhoneInbox>>;
  function inbox<Name extends string>(
    name: Name,
    method: 'PUT',
  ): Rule<Name, ReturnType<typeof readPhoneInboxAcknowledgement>>;
  function inbox<Name extends string>(
    name: Name,
    method: 'GET' | 'PUT' = 'GET',
  ): Rule<
    Name,
    ReturnType<typeof readPhoneInbox> | ReturnType<typeof readPhoneInboxAcknowledgement>
  > {
    return {
      name,
      method,
      route:
        method === 'PUT'
          ? new RegExp('^/api/notifications/phones/' + id + '/read$')
          : /^\/api\/notifications\/phones(?:\?unreadOnly=true)?$/,
      decode: (raw, meta) =>
        method === 'PUT'
          ? readPhoneInboxAcknowledgement(raw, meta.path.split('/')[4])
          : readPhoneInbox(
              raw,
              new URL(meta.path, 'http://wire.invalid').searchParams.get('unreadOnly') === 'true',
            ),
      public: true,
    };
  }
  const discoveryRules = [
    rule(
      'configuration-save',
      'PUT',
      '/api/admin/market/' + id + '/phone-configurations/' + id + '/commands/' + command,
      phoneConfigurationResultSchema,
      (v, m) => {
        assert.equal(v.listingId, m[1]);
        assert.equal(v.configurationId, m[2]);
        assert.equal(v.requestId, m[3]);
      },
      false,
    ),
    rule('configured-cart', 'GET', '/api/cart/(fa|en)/sourcing', sourcingCartSchema, (v, m) =>
      assert.equal(v.locale, m[1]),
    ),
    rule(
      'configured-submit',
      'POST',
      '/api/cart/(fa|en)/sourcing/submit',
      sourcingMutationSchema,
      (v) => assert.equal(v.state, 'Submitted'),
    ),
    rule('configured-request', 'GET', request, sourcingDetailSchema, (v, m) =>
      assert.equal(v.summary.id, m[1]),
    ),
    rule('discovery-page', 'POST', '/api/phones/(fa|en)/search', phonePageSchema, (v, m) =>
      assert.equal(v.locale, m[1]),
    ),
    rule('exact-stock-detail', 'GET', '/api/phones/(fa|en)/' + id, phoneItemSchema, (v, m) =>
      assert.equal(v.id, m[2]),
    ),
    rule(
      'interest-created',
      'PUT',
      '/api/phones/interests/' + id + '/commands/' + command,
      phoneInterestResultSchema,
      (v, m) => {
        assert.equal(v.requestId, m[2]);
        assert.equal(v.interest.listingId, m[1]);
        assert.equal(v.interest.state, 'Active');
        assert.equal(v.replayed, false);
      },
    ),
    rule(
      'interest-current',
      'GET',
      '/api/phones/interests/' + id + '/' + id,
      phoneInterestSchema,
      (v, m) => {
        assert.equal(v.listingId, m[1]);
        assert.equal(v.configuration.id, m[2]);
      },
    ),
    rule('interest-page', 'GET', '/api/phones/interests', phoneInterestPageSchema),
    rule(
      'interest-receipt',
      'GET',
      '/api/phones/interests/commands/' + command,
      phoneInterestResultSchema,
      (v, m) => {
        assert.equal(v.requestId, m[1]);
        assert.equal(v.replayed, true);
      },
    ),
    inbox('availability-inbox'),
    rule(
      'flow-admin-quote',
      'PUT',
      adminOffer,
      offerMutationSchema,
      (v, m) => {
        assert.equal(v.requestId, m[1]);
        assert.equal(v.offerId, m[2]);
        assert.equal(v.operation, 'save');
      },
      false,
    ),
    rule(
      'flow-published',
      'POST',
      adminOffer + '/publish',
      offerMutationSchema,
      (v, m) => {
        assert.equal(v.requestId, m[1]);
        assert.equal(v.offerId, m[2]);
        assert.equal(v.operation, 'publish');
      },
      false,
    ),
    inbox('flow-quote-inbox'),
    rule('flow-customer-quote', 'GET', offer, offerDetailSchema, (v, m) => {
      assert.equal(v.requestId, m[1]);
      assert.equal(v.offer.summary.id, m[2]);
    }),
    rule('flow-consent', 'POST', offer + '/accept', offerMutationSchema, (v, m) => {
      assert.equal(v.requestId, m[1]);
      assert.equal(v.offerId, m[2]);
      assert.equal(v.operation, 'accept');
    }),
    rule(
      'flow-supply',
      'PUT',
      adminOffer + '/supply/' + id,
      supplyMutationSchema,
      (v, m) => {
        assert.equal(v.requestId, m[1]);
        assert.equal(v.offerId, m[2]);
        assert.equal(v.taskId, m[3]);
        assert.equal(v.operation, 'start');
      },
      false,
    ),
    rule(
      'flow-received',
      'POST',
      inventory + '/receipts/' + id,
      receivingMutationSchema,
      (v, m) => {
        assert.equal(v.requestId, m[1]);
        assert.equal(v.taskId, m[2]);
        assert.equal(v.receiptId, m[3]);
      },
      false,
    ),
    rule(
      'flow-allocated',
      'PUT',
      inventory + '/allocations/' + id,
      allocationMutationSchema,
      (v, m) => {
        assert.equal(v.requestId, m[1]);
        assert.equal(v.taskId, m[2]);
        assert.equal(v.allocationId, m[3]);
        assert.equal(v.operation, 'allocate');
      },
      false,
    ),
    rule('flow-purchase', 'GET', offer + '/purchase', cartConversionCandidateSchema, (v, m) => {
      assert.equal(v.requestId, m[1]);
      assert.equal(v.offerId, m[2]);
    }),
    rule('flow-converted', 'POST', offer + '/convert', cartConversionMutationSchema, (v, m) => {
      assert.equal(v.requestId, m[1]);
      assert.equal(v.offerId, m[2]);
    }),
    rule('flow-negotiated-cart', 'GET', '/api/cart/(fa|en)/v2', cartSnapshotV2Schema, (v, m) =>
      assert.equal(v.locale, m[1]),
    ),
  ];
  const notificationRules = [
    inbox('all'),
    rule('count', 'GET', '/api/notifications/phones/unread-count', notificationCountSchema),
    inbox('other-owner'),
    inbox('read', 'PUT'),
    inbox('read-concurrent', 'PUT'),
    inbox('read-repeat', 'PUT'),
    rule(
      'count-after-read',
      'GET',
      '/api/notifications/phones/unread-count',
      notificationCountSchema,
    ),
    inbox('unread-after-read'),
  ];
  type CaptureEntry = Partial<Meta> & {
    name: string;
    file: string;
    bytes?: number;
    sha256?: string;
    metaSha256?: string;
    mtimeMs?: number;
    metaMtimeMs?: number;
    passed?: boolean;
  };
  const entries: CaptureEntry[] = [],
    errors: ({ capture: string; error: unknown } | { check: string; error: string })[] = [],
    values = new Map<string, unknown>(),
    checks: string[] = [];
  const privateKeys = new Set([
    'ownerId',
    'actorId',
    'phoneNumber',
    'email',
    'protectedPayload',
    'payloadHash',
    'internalNote',
    'serial',
    'imei1',
    'imei2',
    'unitIds',
  ]);
  function privacy(raw: unknown) {
    if (Array.isArray(raw)) {
      raw.forEach(privacy);
      return;
    }
    if (raw && typeof raw === 'object')
      for (const [key, value] of Object.entries(raw)) {
        assert.ok(!privateKeys.has(key), 'Private field reached public response: ' + key);
        privacy(value);
      }
  }
  async function decode(directory: string, prefix: string, rules: Rule[]) {
    for (const rule of rules) {
      const file = path.join(directory, rule.name + '.json'),
        metaFile = path.join(directory, rule.name + '.meta.json');
      let entry: CaptureEntry = { name: prefix + rule.name, file: relative(file) };
      try {
        const raw = await readFile(file),
          metaRaw = await readFile(metaFile),
          bodyStat = await stat(file),
          metaStat = await stat(metaFile);
        entry = {
          ...entry,
          bytes: raw.byteLength,
          sha256: digest(raw),
          metaSha256: digest(metaRaw),
          mtimeMs: bodyStat.mtimeMs,
          metaMtimeMs: metaStat.mtimeMs,
        };
        const run = prefix === 'discovery:' ? finalRuns.discovery : finalRuns.notifications;
        assert.ok(
          [bodyStat.mtimeMs, metaStat.mtimeMs].every(
            (time) => time >= run.startMs && time <= run.finishMs,
          ),
          'Capture is outside its accepted final SQL TRX window.',
        );
        assert.ok(raw.byteLength > 0 && raw.byteLength <= 4 * 1024 * 1024);
        const meta = metadata.parse(
          JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(metaRaw)),
        );
        entry = { ...entry, ...meta };
        assert.equal(meta.method, rule.method);
        const match = meta.path.match(rule.route);
        assert.ok(match, 'Capture route does not match expected resource.');
        assert.equal(meta.status, rule.name === 'configured-submit' ? 201 : 200);
        if (prefix === 'notification:') assert.match(meta.cacheControl ?? '', /no-store/);
        // Original bytes go directly into production decoders. Do not insert fields,
        // coerce amounts, normalize dates or synthesize null/configuration snapshots.
        const original = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)),
          value = rule.decode(original, meta, match);
        if (rule.public) privacy(original);
        values.set(prefix + rule.name, value);
        entry.passed = true;
      } catch (error) {
        entry.passed = false;
        errors.push({
          capture: prefix + rule.name,
          error:
            error instanceof z.ZodError
              ? error.issues.map((issue) => ({
                  path: issue.path,
                  code: issue.code,
                  message: issue.message,
                }))
              : error instanceof Error
                ? error.message
                : String(error),
        });
      }
      entries.push(entry);
    }
  }
  await decode(discovery, 'discovery:', discoveryRules);
  await decode(notifications, 'notification:', notificationRules);
  function check(name: string, run: () => void) {
    try {
      run();
      checks.push(name);
    } catch (error) {
      errors.push({ check: name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  // Each value is inserted only after the named rule's production decoder succeeds.
  function d<Name extends (typeof discoveryRules)[number]['name']>(name: Name) {
    const value = values.get('discovery:' + name);
    assert.ok(value, 'Missing decoded capture ' + name);
    return value as ReturnType<Extract<(typeof discoveryRules)[number], { name: Name }>['decode']>;
  }
  function n<Name extends (typeof notificationRules)[number]['name']>(name: Name) {
    const value = values.get('notification:' + name);
    assert.ok(value, 'Missing decoded capture ' + name);
    return value as ReturnType<
      Extract<(typeof notificationRules)[number], { name: Name }>['decode']
    >;
  }
  check(
    'configured cart ID/model binding, exact immutable request snapshot and redacted private source/price',
    () => {
      const cart = d('configured-cart'),
        submit = d('configured-submit'),
        detail = d('configured-request');
      assert.equal(cart.lines.length, 1);
      assert.equal(detail.lines.length, 1);
      assert.equal(submit.id, detail.summary.id);
      const selected = cart.lines[0];
      assert.ok(selected.candidate.configuration);
      assert.ok(selected.candidate.model);
      assert.equal(selected.configurationId, selected.candidate.configuration.id);
      assert.equal(selected.candidate.configuration.modelId, selected.candidate.model.id);
      assert.deepEqual(detail.lines[0].configuration, selected.candidate.configuration);
      assert.equal(detail.lines[0].listingId, selected.listingId);
      assert.equal(detail.lines[0].quantity, selected.quantity);
      for (const value of [selected.candidate, detail.lines[0]]) {
        assert.equal(value.referencePriceRial, null);
        assert.equal(value.sourceUrl, null);
        assert.equal(value.sourceNameEn, 'Phone sourcing request');
        assert.equal(value.availability, 'unknown');
      }
      assert.equal(selected.candidate.configuration.ramGb, 12);
      assert.equal(selected.candidate.configuration.storageGb, 512);
      assert.equal(selected.candidate.configuration.colorKey, 'white');
    },
  );
  check(
    'interest owner-view target and historical receipt remain exact after later cancellation',
    () => {
      const created = d('interest-created'),
        current = d('interest-current'),
        page = d('interest-page'),
        receipt = d('interest-receipt');
      assert.deepEqual(current, created.interest);
      assert.ok(
        page.items.some(
          (i) => i.id === current.id && i.configuration.id === current.configuration.id,
        ),
      );
      assert.deepEqual({ ...receipt, replayed: false }, created);
      assert.equal(receipt.interest.state, 'Active');
    },
  );
  check(
    'phone discovery has localized typed specifications and no source/reference-price fields',
    () => {
      const page = d('discovery-page');
      assert.ok(page.items.length > 0);
      assert.ok(
        page.items[0].specifications.some(
          (s) => s.key === 'battery' && s.label === 'Battery' && s.value === 'Sample battery',
        ),
      );
      const raw = JSON.stringify(page);
      for (const field of [
        'source',
        'sourceName',
        'sourceUrl',
        'referencePriceRial',
        'priceRial',
        'observedAt',
        'validUntil',
      ])
        assert.equal(raw.includes('"' + field + '"'), false);
    },
  );
  check('availability event points to the exact real stock configuration and store SKU', () => {
    const detail = d('exact-stock-detail'),
      inbox = d('availability-inbox');
    assert.equal(inbox.items.length, 1);
    const event = inbox.items[0],
      choice = detail.configurations.find((c) => c.id === event.configurationId);
    assert.ok(choice);
    assert.equal(event.kind, 'phone_available');
    assert.equal(event.listingId, detail.id);
    assert.equal(choice.availableInStore, true);
    assert.equal(event.variantId, choice.variantId);
    assert.equal(event.storeSlug, choice.storeSlug);
    assert.ok(detail.configurations.some((c) => !c.availableInStore && c.canRequest));
  });
  check(
    'admin quote publication, private inbox and customer consent preserve request/offer/acceptance lineage',
    () => {
      const saved = d('flow-admin-quote'),
        published = d('flow-published'),
        quote = d('flow-customer-quote'),
        consent = d('flow-consent'),
        inbox = d('flow-quote-inbox');
      assert.equal(saved.requestId, published.requestId);
      assert.equal(saved.offerId, published.offerId);
      assert.equal(quote.requestId, published.requestId);
      assert.equal(quote.offer.summary.id, published.offerId);
      assert.equal(consent.requestId, published.requestId);
      assert.equal(consent.offerId, published.offerId);
      assert.equal(consent.state, 'Accepted');
      assert.ok(consent.acceptanceId);
      assert.equal(inbox.items.length, 1);
      assert.equal(inbox.items[0].kind, 'sourcing_offer_published');
      assert.equal(inbox.items[0].requestId, published.requestId);
      assert.equal(inbox.items[0].offerId, published.offerId);
      assert.equal(quote.offer.lines[0].unitPriceRial, '9007199254740993');
      for (const value of [saved, published, quote, consent]) assert.equal(value.canPay, false);
    },
  );
  check(
    'real receiving/allocation, purchase candidate and negotiated cart bind the same consent and exact large rial',
    () => {
      const consent = d('flow-consent'),
        supply = d('flow-supply'),
        received = d('flow-received'),
        allocation = d('flow-allocated'),
        purchase = d('flow-purchase'),
        conversion = d('flow-converted'),
        cart = d('flow-negotiated-cart'),
        quote = d('flow-customer-quote');
      for (const value of [supply, received, allocation, purchase, conversion]) {
        assert.equal(value.requestId, consent.requestId);
        assert.equal(value.offerId, consent.offerId);
        assert.equal(value.acceptanceId, consent.acceptanceId);
        assert.equal(value.taskId, supply.taskId);
      }
      assert.equal(received.requiresNewOffer, false);
      assert.equal(purchase.canConvert, true);
      assert.equal(conversion.allocationId, allocation.allocationId);
      assert.ok(purchase.agreement);
      assert.equal(conversion.agreementId, purchase.agreement.id);
      assert.equal(cart.version, conversion.cartVersion);
      assert.equal(cart.offerLines.length, 1);
      assert.equal(cart.ordinaryLines.length, 0);
      assert.equal(cart.inquiry.lines.length, 0);
      const line = cart.offerLines[0];
      assert.equal(line.lineId, conversion.lines[0].lineId);
      assert.equal(line.agreementLineId, conversion.lines[0].agreementLineId);
      assert.equal(line.variantId, quote.offer.lines[0].sku.variantId);
      assert.equal(line.unitPriceRial, '9007199254740993');
      assert.equal(
        line.lineTotalRial,
        (BigInt(line.unitPriceRial) * BigInt(line.quantity)).toString(),
      );
      assert.equal(cart.buySubtotalRial, cart.offerSubtotalRial);
      for (const value of [supply, purchase, conversion, cart]) assert.equal(value.canPay, false);
    },
  );
  check(
    'private phone inbox kinds, foreign-owner empty page, precise repeated read and unread counts',
    () => {
      const all = n('all');
      assert.equal(all.items.length, 2);
      assert.deepEqual(
        all.items.map((i) => i.kind),
        ['sourcing_offer_published', 'phone_available'],
      );
      assert.equal(n('count').unreadCount, '2');
      assert.equal(n('other-owner').items.length, 0);
      assert.deepEqual(n('read'), n('read-concurrent'));
      assert.deepEqual(n('read'), n('read-repeat'));
      assert.equal(n('count-after-read').unreadCount, '0');
      assert.equal(n('unread-after-read').items.length, 0);
    },
  );
  const schemaFiles = [
      'apps/storefront/lib/phone-discovery-contract.ts',
      'apps/storefront/lib/phone-inbox-contract.ts',
      'apps/storefront/lib/notification-contract.ts',
      'apps/storefront/lib/sourcing-contract.ts',
      'apps/storefront/lib/offer-contract.ts',
      'apps/storefront/lib/cart-v2-contract.ts',
      'apps/storefront/lib/cart-conversion-contract.ts',
      'apps/admin/src/market-phone-contract.ts',
      'apps/admin/src/supply-contract.ts',
      'apps/admin/src/allocation-contract.ts',
    ],
    sourceSha256: Record<string, string> = {};
  for (const file of schemaFiles)
    sourceSha256[file] = digest(await readFile(path.join(root, file)));
  const report = {
    schemaVersion: 1,
    phase: 'final',
    passed: errors.length === 0,
    generatedAt: new Date().toISOString(),
    responses: entries.length,
    decoded: values.size,
    actualSqlHttpResponseBodies: true,
    rawBodiesUnmodified: true,
    strictProductionDecoders: true,
    freshWithinFinalSqlTrxWindows: true,
    finalRuns,
    moduleParitySha256: digest(moduleParityRaw),
    moduleCount: 14,
    currentApiUnitSqlModuleHashesVerified: true,
    baselineSha256: digest(await readFile(baselinePath)),
    sourceSha256,
    checks,
    entries,
    errors,
    originalRequestBodiesCaptured: false,
    browserAccepted: false,
    mainPromoted: false,
    scope:
      'Actual SQL HTTP response contracts and cross-response lineage only. Browser, private-cookie isolation, worker timing and release acceptance require independent evidence.',
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({
      passed: report.passed,
      responses: entries.length,
      decoded: values.size,
      checks: checks.length,
      errors,
      report: relative(reportPath),
    }),
  );
  if (!report.passed) process.exitCode = 1;
}
