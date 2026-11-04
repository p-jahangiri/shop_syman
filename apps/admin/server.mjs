import http from 'node:http';
import { publicCatalogVideo, videoRange } from './public-video-proxy.mjs';
import https from 'node:https';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};
const limit = 512000;
const rmaRequestLimit = 32768,
  rmaResponseLimit = 2097152;

function rmaRoute(incoming) {
  const base = '/api/admin/returns',
    id = '(?!0{32}(?:/|$))[a-f0-9]{32}',
    key = '[A-Za-z0-9_-]{1,64}',
    p = incoming.pathname;
  if (p === base) return { methods: ['GET'], query: ['state', 'after'] };
  if (p === base + '/policy') return { methods: ['GET'], query: [] };
  if (p === base + '/policy/history') return { methods: ['GET'], query: ['beforeRevision'] };
  if (new RegExp('^' + base + '/policy/commands/' + id + '$').test(p))
    return { methods: ['GET', 'PUT'], query: [], input: 'policy' };
  if (
    new RegExp('^' + base + '/commands/' + id + '$').test(p) ||
    new RegExp('^' + base + '/' + key + '/' + id + '$').test(p)
  )
    return { methods: ['GET'], query: [] };
  if (new RegExp('^' + base + '/' + id + '/commands/' + id + '$').test(p))
    return { methods: ['PUT'], query: [], input: 'review' };
  return null;
}
function rmaQuery(incoming, allowed) {
  const q = incoming.searchParams;
  return (
    ![...q.keys()].some((key) => !allowed.includes(key) || q.getAll(key).length !== 1) &&
    (!q.has('state') ||
      ['submitted', 'reviewing', 'reviewed', 'withdrawn'].includes(q.get('state'))) &&
    (!q.has('after') ||
      (/^[A-Za-z0-9+/]+={0,2}$/.test(q.get('after')) &&
        !/\s/.test(q.get('after')) &&
        q.get('after').length <= 180)) &&
    (!q.has('beforeRevision') ||
      (/^[1-9][0-9]{0,4}$/.test(q.get('beforeRevision')) &&
        q.get('beforeRevision') === String(Number(q.get('beforeRevision'))) &&
        Number(q.get('beforeRevision')) <= 10000))
  );
}
function rmaJson(raw) {
  const result = JSON.parse(raw);
  // Inspect original tokens so JSON.parse cannot hide duplicate or escaped keys.
  // eslint-disable-next-line no-control-regex -- A JSON token cannot contain literal controls.
  const token = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*"/y;
  let at = 0;
  const whitespace = () => {
    while (at < raw.length && /[ \t\r\n]/.test(raw[at])) at++;
  };
  const string = () => {
    token.lastIndex = at;
    const match = token.exec(raw);
    if (!match) throw Error('Invalid JSON');
    at = token.lastIndex;
    return JSON.parse(match[0]);
  };
  const value = (depth) => {
    if (depth > 32) throw Error('JSON nesting exceeds its bound');
    whitespace();
    if (raw[at] === '{') {
      at++;
      whitespace();
      const keys = new Set();
      if (raw[at] !== '}')
        while (true) {
          const key = string().toLowerCase();
          if (keys.has(key)) throw Error('Ambiguous JSON');
          keys.add(key);
          whitespace();
          if (raw[at++] !== ':') throw Error('Invalid JSON');
          value(depth + 1);
          whitespace();
          if (raw[at] !== ',') break;
          at++;
          whitespace();
        }
      if (raw[at++] !== '}') throw Error('Invalid JSON');
    } else if (raw[at] === '[') {
      at++;
      whitespace();
      if (raw[at] !== ']')
        while (true) {
          value(depth + 1);
          whitespace();
          if (raw[at] !== ',') break;
          at++;
        }
      if (raw[at++] !== ']') throw Error('Invalid JSON');
    } else if (raw[at] === '"') string();
    else {
      const start = at;
      while (at < raw.length && !/[\s,}\]]/.test(raw[at])) at++;
      if (at === start) throw Error('Invalid JSON');
    }
  };
  value(0);
  whitespace();
  if (at !== raw.length) throw Error('Invalid JSON');
  return result;
}
function rmaInput(input, kind) {
  const object = input && typeof input === 'object' && !Array.isArray(input),
    fields =
      kind === 'policy'
        ? [
            'version',
            'enabled',
            'physicalReturns',
            'digitalComplaints',
            'conditionsFa',
            'conditionsEn',
            'windowMode',
            'windowDays',
            'maxOpenPerOwner',
            'note',
            'confirmed',
          ]
        : [
            'ownerId',
            'version',
            'action',
            'outcome',
            'note',
            'customerMessage',
            'acknowledgeNoFinancialAction',
          ];
  if (
    !object ||
    Object.keys(input).length !== fields.length ||
    Object.keys(input).some((key) => !fields.includes(key))
  )
    return false;
  const text = (s, max) =>
      typeof s === 'string' &&
      s.length <= max &&
      s.trim().length > 0 &&
      // eslint-disable-next-line no-control-regex -- Reject dangerous controls and bidi overrides.
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(s),
    version = (s) =>
      typeof s === 'string' && /^[A-Za-z0-9+/]{10}[AEIMQUYcgkosw048]=$/.test(s) && s.length === 12,
    integer = (n, max) => Number.isInteger(n) && n >= 1 && n <= max;
  if (kind === 'policy')
    return (
      (input.version === null || version(input.version)) &&
      ['enabled', 'physicalReturns', 'digitalComplaints'].every(
        (key) => typeof input[key] === 'boolean',
      ) &&
      (!input.enabled || input.physicalReturns || input.digitalComplaints) &&
      text(input.conditionsFa, 4000) &&
      text(input.conditionsEn, 4000) &&
      (input.windowMode === 'manualReview'
        ? input.windowDays === null
        : input.windowMode === 'deliveryDays' && integer(input.windowDays, 3650)) &&
      (input.maxOpenPerOwner === null || integer(input.maxOpenPerOwner, 10000)) &&
      text(input.note, 1000) &&
      input.confirmed === true
    );
  return (
    typeof input.ownerId === 'string' &&
    /^[A-Za-z0-9_-]{1,64}$/.test(input.ownerId) &&
    input.ownerId.trim() === input.ownerId &&
    input.ownerId.length <= 64 &&
    version(input.version) &&
    (input.action === 'startReview'
      ? input.outcome === null
      : input.action === 'completeReview' && ['followUp', 'declined'].includes(input.outcome)) &&
    text(input.note, 4000) &&
    (input.customerMessage === null || text(input.customerMessage, 2000)) &&
    input.acknowledgeNoFinancialAction === true
  );
}
function body(request, maximum = limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const onData = (chunk) => {
      size += chunk.length;
      if (size > maximum) {
        request.removeListener('data', onData);
        request.resume();
        resolve(null);
      } else chunks.push(chunk);
    };
    request.on('data', onData);
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}
const smsSettingsLimit = 16384;
const smsVersion = (value) =>
  value === null ||
  (typeof value === 'string' && /^[A-Za-z0-9+/]{10}[AEIMQUYcgkosw048]=$/.test(value));
function smsFields(value) {
  const parameter = (s) => typeof s === 'string' && /^[A-Za-z0-9_]{1,50}$/.test(s);
  return (
    value.provider === 'smsIr' &&
    typeof value.enabled === 'boolean' &&
    ['live', 'sandbox'].includes(value.mode) &&
    Number.isInteger(value.templateId) &&
    value.templateId > 0 &&
    value.templateId <= 2147483647 &&
    parameter(value.codeParameterName) &&
    (value.nameParameterName === null || parameter(value.nameParameterName)) &&
    typeof value.genericName === 'string' &&
    value.genericName.length <= 25 &&
    value.genericName === value.genericName.trim() &&
    !/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(value.genericName) &&
    (value.nameParameterName === null ||
      (value.genericName.length > 0 &&
        value.nameParameterName.toLowerCase() !== value.codeParameterName.toLowerCase())) &&
    (value.mode === 'live'
      ? value.templateId !== 123456
      : value.templateId === 123456 &&
        value.codeParameterName === 'Code' &&
        value.nameParameterName === null)
  );
}
function smsShape(value, fields) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === fields.length &&
    fields.every((key) => Object.hasOwn(value, key))
  );
}
function smsInput(value) {
  const fields = [
    'version',
    'requestId',
    'provider',
    'enabled',
    'mode',
    'templateId',
    'codeParameterName',
    'nameParameterName',
    'genericName',
    'apiKeyAction',
  ];
  if (value?.apiKeyAction === 'replace') fields.push('apiKey');
  return (
    smsShape(value, fields) &&
    smsVersion(value.version) &&
    smsFields(value) &&
    typeof value.requestId === 'string' &&
    /^(?!0{32}$)[a-f0-9]{32}$/.test(value.requestId) &&
    ['keep', 'replace', 'clear'].includes(value.apiKeyAction) &&
    (value.apiKeyAction !== 'replace' ||
      (typeof value.apiKey === 'string' && /^[!-~]{1,512}$/.test(value.apiKey)))
  );
}
function smsOutput(value) {
  return (
    smsShape(value, [
      'schemaVersion',
      'version',
      'provider',
      'enabled',
      'mode',
      'templateId',
      'codeParameterName',
      'nameParameterName',
      'genericName',
      'keyConfigured',
      'otpLifetimeSeconds',
      'resendAfterSeconds',
      'maxAttempts',
      'availability',
    ]) &&
    value.schemaVersion === 1 &&
    smsVersion(value.version) &&
    smsFields(value) &&
    typeof value.keyConfigured === 'boolean' &&
    value.otpLifetimeSeconds === 300 &&
    value.resendAfterSeconds === 60 &&
    value.maxAttempts === 5 &&
    value.availability ===
      (!value.keyConfigured
        ? 'unconfigured'
        : !value.enabled
          ? 'disabled'
          : value.mode === 'sandbox'
            ? 'sandbox'
            : 'configured')
  );
}
// This key-bearing route never uses the general streaming proxy. Both sides
// are bounded and allowlisted; a provider/server error cannot echo a secret.
const smsWorkspaceEvents = [
  'otp',
  'orderCreated',
  'orderPaid',
  'orderShipped',
  'orderCancelled',
  'creditApproved',
  'orderDigitalReady',
  'chequeReminder',
];
const smsWorkspaceStates = ['queued', 'dispatching', 'accepted', 'rejected', 'unknown', 'skipped'];
const smsWorkspaceId = (v) => typeof v === 'string' && /^(?!0{32}$)[a-f0-9]{32}$/.test(v);
const smsWorkspaceText = (v, max) =>
  typeof v === 'string' &&
  v.length > 0 &&
  v.length <= max &&
  v === v.trim() &&
  !/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(v.replaceAll('\u200c', ''));
const smsWorkspaceDate = (v) =>
  typeof v === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/.test(v) &&
  Number.isFinite(Date.parse(v));
function smsWorkspacePolicy(p) {
  const bounds = {
    lifetimeSeconds: [60, 600],
    resendSeconds: [30, 300],
    maxAttempts: [1, 10],
    phoneHourlyLimit: [1, 20],
    phoneDailyLimit: [1, 100],
    globalHourlyLimit: [1, 10000],
    globalDailyLimit: [1, 100000],
    notificationHourlyLimit: [1, 10000],
    notificationDailyLimit: [1, 100000],
  };
  return (
    smsShape(p, [...Object.keys(bounds), 'genericName']) &&
    Object.entries(bounds).every(
      ([k, [min, max]]) => Number.isInteger(p[k]) && p[k] >= min && p[k] <= max,
    ) &&
    smsWorkspaceText(p.genericName, 25) &&
    p.resendSeconds < p.lifetimeSeconds &&
    p.phoneDailyLimit >= p.phoneHourlyLimit &&
    p.globalHourlyLimit >= p.phoneHourlyLimit &&
    p.globalDailyLimit >= Math.max(p.globalHourlyLimit, p.phoneDailyLimit) &&
    p.notificationDailyLimit >= p.notificationHourlyLimit
  );
}
function smsWorkspaceTemplate(t) {
  return (
    smsShape(t, [
      'id',
      'name',
      'kind',
      'connectionId',
      'providerTemplate',
      'approved',
      'previewText',
      'parameters',
    ]) &&
    smsWorkspaceId(t.id) &&
    smsWorkspaceId(t.connectionId) &&
    smsWorkspaceText(t.name, 100) &&
    smsWorkspaceEvents.includes(t.kind) &&
    smsWorkspaceText(t.providerTemplate, 100) &&
    typeof t.approved === 'boolean' &&
    typeof t.previewText === 'string' &&
    t.previewText.length <= 2000 &&
    Array.isArray(t.parameters) &&
    t.parameters.length >= 1 &&
    t.parameters.length <= 10 &&
    t.parameters.every(
      (p) =>
        smsShape(p, ['name', 'source', 'constant']) &&
        typeof p.name === 'string' &&
        /^[A-Za-z0-9_]{1,50}$/.test(p.name) &&
        [
          'code',
          'genericName',
          'expiryMinutes',
          'customerName',
          'orderNumber',
          'orderStatus',
          'amountRial',
          'dueDate',
          'trackingCode',
          'constant',
        ].includes(p.source) &&
        (p.source === 'constant' ? smsWorkspaceText(p.constant, 100) : p.constant === null),
    ) &&
    new Set(t.parameters.map((p) => p.name.toLowerCase())).size === t.parameters.length
  );
}
function smsWorkspaceDocument(v, input) {
  const shape = input
    ? ['version', 'requestId', 'otp', 'connections', 'templates', 'routes']
    : ['schemaVersion', 'version', 'otp', 'connections', 'templates', 'routes'];
  return (
    smsShape(v, shape) &&
    (input ? smsWorkspaceId(v.requestId) : v.schemaVersion === 1) &&
    smsVersion(v.version) &&
    smsWorkspacePolicy(v.otp) &&
    Array.isArray(v.connections) &&
    v.connections.length <= 10 &&
    v.connections.every((c) => {
      const keys = [
        'id',
        'name',
        'provider',
        'mode',
        'enabled',
        ...(input
          ? ['keyAction', ...(c?.keyAction === 'replace' ? ['apiKey'] : [])]
          : ['keyConfigured']),
      ];
      return (
        smsShape(c, keys) &&
        smsWorkspaceId(c.id) &&
        smsWorkspaceText(c.name, 100) &&
        ['smsIr', 'kavenegar'].includes(c.provider) &&
        ['live', 'sandbox'].includes(c.mode) &&
        (c.provider !== 'kavenegar' || c.mode === 'live') &&
        typeof c.enabled === 'boolean' &&
        (input
          ? ['keep', 'replace', 'clear'].includes(c.keyAction) &&
            (c.keyAction !== 'replace' ||
              (typeof c.apiKey === 'string' && /^[!-~]{1,512}$/.test(c.apiKey)))
          : typeof c.keyConfigured === 'boolean')
      );
    }) &&
    new Set(v.connections.map((c) => c.id)).size === v.connections.length &&
    Array.isArray(v.templates) &&
    v.templates.length <= 30 &&
    v.templates.every(
      (t) => smsWorkspaceTemplate(t) && v.connections.some((c) => c.id === t.connectionId),
    ) &&
    new Set(v.templates.map((t) => t.id)).size === v.templates.length &&
    Array.isArray(v.routes) &&
    v.routes.length === smsWorkspaceEvents.length &&
    v.routes.every(
      (r) =>
        smsShape(r, ['event', 'enabled', 'templateId', ...(!input ? ['enabledSince'] : [])]) &&
        smsWorkspaceEvents.includes(r.event) &&
        typeof r.enabled === 'boolean' &&
        (r.templateId === null
          ? !r.enabled
          : smsWorkspaceId(r.templateId) &&
            v.templates.some((t) => t.id === r.templateId && t.kind === r.event)) &&
        (input || (r.enabledSince === null ? !r.enabled : smsWorkspaceDate(r.enabledSince))),
    ) &&
    new Set(v.routes.map((r) => r.event)).size === smsWorkspaceEvents.length
  );
}
function smsWorkspaceMessage(v) {
  const required = ['id', 'sequence', 'kind', 'state', 'createdAt'],
    optional = [
      'connectionName',
      'provider',
      'templateName',
      'attemptedAt',
      'completedAt',
      'reason',
      'providerMessageId',
    ];
  return (
    v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    required.every((k) => Object.hasOwn(v, k)) &&
    Object.keys(v).every((k) => required.includes(k) || optional.includes(k)) &&
    smsWorkspaceId(v.id) &&
    typeof v.sequence === 'string' &&
    /^[1-9][0-9]{0,18}$/.test(v.sequence) &&
    [...smsWorkspaceEvents, 'test'].includes(v.kind) &&
    smsWorkspaceStates.includes(v.state) &&
    smsWorkspaceDate(v.createdAt) &&
    ['connectionName', 'templateName'].every((k) => v[k] == null || smsWorkspaceText(v[k], 100)) &&
    (v.provider == null || ['smsIr', 'kavenegar'].includes(v.provider)) &&
    ['attemptedAt', 'completedAt'].every((k) => v[k] == null || smsWorkspaceDate(v[k])) &&
    (v.reason == null ||
      [
        'demo_record',
        'route_unavailable',
        'recipient_unavailable',
        'notification_limit',
        'payload_unavailable',
        'interrupted',
        'None',
        'RequestRejected',
        'CredentialsRejected',
        'RateLimited',
        'ProviderRejected',
        'Uncertain',
      ].includes(v.reason)) &&
    (v.providerMessageId == null ||
      (typeof v.providerMessageId === 'string' && /^[1-9][0-9]{0,18}$/.test(v.providerMessageId)))
  );
}
function smsWorkspaceRoute(incoming) {
  const none = () => false;
  if (incoming.pathname === '/api/admin/sms/workspace')
    return {
      methods: ['GET', 'PUT'],
      query: none,
      input: (v) => smsWorkspaceDocument(v, true),
      output: (v) => smsWorkspaceDocument(v, false),
    };
  if (incoming.pathname === '/api/admin/sms/messages/test')
    return {
      methods: ['POST'],
      query: none,
      input: (v) =>
        smsShape(v, ['requestId', 'templateId', 'mobile', 'confirmed']) &&
        smsWorkspaceId(v.requestId) &&
        smsWorkspaceId(v.templateId) &&
        v.confirmed === true &&
        typeof v.mobile === 'string' &&
        /^\+989[0-9]{9}$/.test(v.mobile),
      output: smsWorkspaceMessage,
    };
  if (incoming.pathname === '/api/admin/sms/messages')
    return {
      methods: ['GET'],
      input: none,
      query: (url) =>
        [...url.searchParams].every(
          ([k, v]) =>
            url.searchParams.getAll(k).length === 1 &&
            (k === 'state'
              ? smsWorkspaceStates.includes(v)
              : k === 'kind'
                ? [...smsWorkspaceEvents, 'test'].includes(v)
                : k === 'cursor' && /^[1-9][0-9]{0,18}$/.test(v)),
        ),
      output: (v) =>
        v &&
        typeof v === 'object' &&
        Object.keys(v).every((k) => ['schemaVersion', 'items', 'nextCursor'].includes(k)) &&
        v.schemaVersion === 1 &&
        Array.isArray(v.items) &&
        v.items.length <= 50 &&
        v.items.every(smsWorkspaceMessage) &&
        (v.nextCursor == null ||
          (typeof v.nextCursor === 'string' && /^[1-9][0-9]{0,18}$/.test(v.nextCursor))),
    };
  return null;
}
function productWorkspaceRoute(incoming, method) {
  const base = '/api/admin/catalog/workspace',
    p = incoming.pathname;
  const identifier = '[A-Za-z0-9_-]{1,64}',
    command = '[a-f0-9]{32}';
  const shape = (v, keys) =>
    v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.keys(v).every((k) => keys.includes(k));
  const text = (v, max) => typeof v === 'string' && v.length <= max;
  const id = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);
  const version = (v) => typeof v === 'string' && /^[A-Za-z0-9+/]{11}=$/.test(v);
  const money = (v) =>
    typeof v === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(v) && BigInt(v) <= 9223372036854775807n;
  const receipt = (v) =>
    shape(v, ['schemaVersion', 'requestId', 'kind', 'productId', 'productVersion', 'variantIds']) &&
    v.schemaVersion === 1 &&
    /^[a-f0-9]{32}$/.test(v.requestId) &&
    ['save', 'prices', 'archive', 'restore', 'fields'].includes(v.kind) &&
    (v.productId == null || id(v.productId)) &&
    (v.productVersion == null || version(v.productVersion)) &&
    Array.isArray(v.variantIds) &&
    v.variantIds.length <= 500 &&
    v.variantIds.every(id);
  const rule = {
    unavailableTitle: 'product_command_unavailable',
    invalidTitle: 'invalid_product_command',
    maximum: 2097152,
    preserveValidationErrors: true,
    allowNotFound: true,
    errorTitles: [
      'invalid_product_command',
      'invalid_product_fields',
      'invalid_product_workspace_filter',
      'invalid_product_form_fields',
      'invalid_product_prices',
      'invalid_product',
      'invalid_product_images',
      'invalid_product_videos',
      'video_not_ready',
      'invalid_slug',
      'invalid_money',
      'invalid_compare_price',
      'invalid_translations',
      'required_attribute',
      'attribute_type_mismatch',
      'unknown_category',
      'unknown_brand',
      'unknown_variant',
      'version_conflict',
      'product_command_conflict',
      'product_command_unavailable',
      'product_archived',
      'product_archive_conflict',
      'incomplete_product',
      'not_found',
      'media_unavailable',
      'media_not_ready',
      'image_not_ready',
      'conflict',
    ],
    query: () => false,
    output: receipt,
  };
  if (p === base + '/products')
    return {
      ...rule,
      methods: ['GET'],
      query: (url) =>
        [...url.searchParams].every(([key, value]) => {
          if (url.searchParams.getAll(key).length !== 1) return false;
          if (key === 'categoryIds' || key === 'brandIds' || key === 'statuses') {
            const statuses = key === 'statuses',
              maxItems = statuses ? 4 : 32,
              maxLength = statuses ? 9 : 64;
            if (value.length > maxItems * (maxLength + 1) - 1) return false;
            const items = value.split(',');
            return (
              items.length <= maxItems &&
              new Set(items.map((item) => item.toLowerCase())).size === items.length &&
              items.every((item) =>
                statuses ? ['Draft', 'Published', 'Hidden', 'archived'].includes(item) : id(item),
              )
            );
          }
          if (['minPriceRial', 'maxPriceRial', 'minStock', 'maxStock'].includes(key))
            return money(value);
          if (key === 'minVariants' || key === 'maxVariants')
            return money(value) && BigInt(value) <= 2147483647n;
          if (key === 'updatedFrom' || key === 'updatedBefore') {
            const date = new Date(value);
            return (
              value.length === 24 &&
              !value.startsWith('0000') &&
              Number.isFinite(date.getTime()) &&
              date.toISOString() === value
            );
          }
          return (
            [
              'search',
              'name',
              'status',
              'categoryId',
              'brandId',
              'availability',
              'sort',
              'direction',
              'page',
              'pageSize',
            ].includes(key) && text(value, 120)
          );
        }),
      output: (v) =>
        shape(v, ['schemaVersion', 'page', 'pageSize', 'totalCount', 'items']) &&
        v.schemaVersion === 1 &&
        Number.isInteger(v.page) &&
        [25, 50, 100].includes(v.pageSize) &&
        money(v.totalCount) &&
        Array.isArray(v.items) &&
        v.items.length <= v.pageSize &&
        v.items.every(
          (row) =>
            shape(row, [
              'id',
              'version',
              'slug',
              'nameFa',
              'nameEn',
              'categoryId',
              'categoryName',
              'brandId',
              'brandName',
              'status',
              'archived',
              'featured',
              'isDigital',
              'variantCount',
              'activeVariantCount',
              'minPriceRial',
              'maxPriceRial',
              'availableQuantity',
              'imageUrl',
              'updatedAt',
            ]) &&
            id(row.id) &&
            version(row.version) &&
            money(row.availableQuantity) &&
            (row.minPriceRial == null || money(row.minPriceRial)) &&
            (row.maxPriceRial == null || money(row.maxPriceRial)),
        ),
    };
  if (new RegExp('^' + base + '/products/' + identifier + '$').test(p))
    return {
      ...rule,
      methods: ['GET'],
      output: (v) =>
        shape(v, ['schemaVersion', 'product', 'archived', 'videos']) &&
        Array.isArray(v.videos) &&
        v.videos.length <= 8 &&
        v.schemaVersion === 1 &&
        typeof v.archived === 'boolean' &&
        shape(v.product, [
          'id',
          'version',
          'slug',
          'categoryId',
          'brandId',
          'status',
          'isDigital',
          'featured',
          'translations',
          'attributes',
          'variants',
          'media',
          'purchaseMethods',
          'creditPlans',
        ]) &&
        id(v.product.id) &&
        version(v.product.version) &&
        Array.isArray(v.product.variants) &&
        v.product.variants.length <= 500 &&
        v.product.variants.every(
          (row) =>
            shape(row, [
              'id',
              'version',
              'sku',
              'priceRial',
              'compareAtPriceRial',
              'color',
              'colorNameFa',
              'colorNameEn',
              'labelFa',
              'labelEn',
              'warrantyFa',
              'warrantyEn',
              'isActive',
              'attributes',
              'purchaseMethods',
            ]) &&
            id(row.id) &&
            version(row.version) &&
            money(row.priceRial) &&
            (row.compareAtPriceRial == null || money(row.compareAtPriceRial)),
        ),
    };
  if (new RegExp('^' + base + '/commands/' + command + '$').test(p))
    return { ...rule, methods: ['GET'] };
  if (p === base + '/archive')
    return {
      ...rule,
      methods: ['POST'],
      input: (v) =>
        shape(v, ['requestId', 'productId', 'version', 'restore']) &&
        /^[a-f0-9]{32}$/.test(v.requestId) &&
        id(v.productId) &&
        version(v.version) &&
        typeof v.restore === 'boolean',
    };
  if (p === base + '/prices')
    return {
      ...rule,
      methods: ['POST'],
      input: (v) =>
        shape(v, ['requestId', 'productId', 'version', 'lines']) &&
        /^[a-f0-9]{32}$/.test(v.requestId) &&
        id(v.productId) &&
        version(v.version) &&
        Array.isArray(v.lines) &&
        v.lines.length >= 1 &&
        v.lines.length <= 100 &&
        v.lines.every(
          (line) =>
            shape(line, ['variantId', 'version', 'priceRial', 'compareAtRial', 'isActive']) &&
            id(line.variantId) &&
            version(line.version) &&
            money(line.priceRial) &&
            (line.compareAtRial == null || money(line.compareAtRial)) &&
            typeof line.isActive === 'boolean',
        ),
    };
  if (p === base + '/save')
    return {
      ...rule,
      methods: ['POST'],
      input: (v) =>
        shape(v, ['requestId', 'productId', 'product']) &&
        /^[a-f0-9]{32}$/.test(v.requestId) &&
        (v.productId == null || id(v.productId)) &&
        shape(v.product, [
          'categoryId',
          'brandId',
          'slug',
          'status',
          'isDigital',
          'featured',
          'translations',
          'attributes',
          'variants',
          'imageUrls',
          'purchaseMethodIds',
          'chequePlanIds',
          'version',
          'videos',
        ]) &&
        Array.isArray(v.product.variants) &&
        v.product.variants.length <= 500 &&
        Array.isArray(v.product.translations) &&
        v.product.translations.length === 2 &&
        Array.isArray(v.product.imageUrls) &&
        v.product.imageUrls.length <= 24,
    };
  if (p === base + '/fields')
    return {
      ...rule,
      methods: ['GET', 'PUT'],
      input: (v) =>
        shape(v, ['requestId', 'version', 'fields']) &&
        /^[a-f0-9]{32}$/.test(v.requestId) &&
        (v.version == null || version(v.version)) &&
        Array.isArray(v.fields) &&
        v.fields.length <= 30 &&
        v.fields.every(
          (f) =>
            shape(f, ['key', 'label', 'help', 'visible', 'sortOrder']) &&
            text(f.key, 40) &&
            text(f.label, 150) &&
            text(f.help, 1000) &&
            typeof f.visible === 'boolean' &&
            Number.isInteger(f.sortOrder),
        ),
      output:
        method === 'PUT'
          ? receipt
          : (v) =>
              shape(v, ['schemaVersion', 'version', 'fields']) &&
              v.schemaVersion === 1 &&
              (v.version == null || version(v.version)) &&
              Array.isArray(v.fields) &&
              v.fields.length <= 30 &&
              v.fields.every(
                (f) =>
                  shape(f, ['key', 'label', 'help', 'visible', 'sortOrder', 'visibilityLocked']) &&
                  text(f.label, 150) &&
                  text(f.help, 1000),
              ),
    };
  return null;
}
function boundedProductErrors(errors) {
  return (
    errors &&
    typeof errors === 'object' &&
    !Array.isArray(errors) &&
    Object.keys(errors).length <= 1000 &&
    Object.entries(errors).every(
      ([key, values]) =>
        /^[A-Za-z0-9_.-]{1,200}$/.test(key) &&
        Array.isArray(values) &&
        values.length >= 1 &&
        values.length <= 3 &&
        values.every((value) => typeof value === 'string' && value.length <= 500),
    )
  );
}

async function proxyBoundedAdminJson(
  request,
  response,
  incoming,
  upstream,
  publicOrigin,
  workspaceRoute = null,
) {
  const maximum = workspaceRoute?.maximum ?? (workspaceRoute ? 512000 : smsSettingsLimit);
  const unavailable = workspaceRoute?.unavailableTitle ?? 'otp_unavailable';
  const invalidTitle = workspaceRoute?.invalidTitle ?? 'invalid_sms_settings';
  const methods = workspaceRoute?.methods ?? ['GET', 'PUT'];
  const reject = (status, title = status === 413 ? 'request_too_large' : unavailable, errors) => {
    if (response.destroyed || response.headersSent) return;
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ title, ...(errors ? { errors } : {}) }));
  };
  if (!workspaceRoute && incoming.pathname !== '/api/admin/sms/settings') {
    reject(404);
    request.resume();
    return;
  }
  if (!methods.includes(request.method)) {
    response.setHeader('Allow', methods.join(', '));
    reject(405);
    request.resume();
    return;
  }
  if (
    (incoming.search && !workspaceRoute?.query(incoming)) ||
    incoming.hash ||
    request.headers['content-encoding']
  ) {
    reject(400, invalidTitle);
    request.resume();
    return;
  }
  if (!/^Bearer [^\s]+$/.test(request.headers.authorization ?? '')) {
    reject(401, 'unauthorized');
    request.resume();
    return;
  }
  if (request.method !== 'GET' && request.headers.origin !== publicOrigin.origin) {
    reject(403, 'forbidden');
    request.resume();
    return;
  }
  if (
    request.method === 'GET' &&
    (request.headers['transfer-encoding'] || Number(request.headers['content-length'] ?? 0) !== 0)
  ) {
    reject(400, invalidTitle);
    request.resume();
    return;
  }
  if (
    request.method !== 'GET' &&
    !/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')
  ) {
    reject(415, invalidTitle);
    request.resume();
    return;
  }
  if (!upstream) {
    reject(503);
    request.resume();
    return;
  }
  let input = null;
  if (request.method !== 'GET') {
    if (Number(request.headers['content-length'] ?? 0) > maximum) {
      reject(413);
      request.resume();
      return;
    }
    input = await body(request, maximum);
    if (input === null) {
      reject(413);
      return;
    }
    try {
      if (
        !(workspaceRoute?.input ?? smsInput)(
          rmaJson(new TextDecoder('utf-8', { fatal: true }).decode(input)),
        )
      )
        throw Error('Invalid input');
    } catch {
      reject(400, invalidTitle);
      return;
    }
  }
  const destination = new URL(upstream);
  destination.pathname = workspaceRoute ? incoming.pathname : '/api/admin/sms/settings';
  destination.search = workspaceRoute ? incoming.search : '';
  destination.hash = '';
  destination.username = '';
  destination.password = '';
  const headers = { Authorization: request.headers.authorization, 'X-Sayman-Client': 'admin' };
  if (request.headers.origin) headers.Origin = request.headers.origin;
  if (input) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = String(input.length);
  }
  const transport = destination.protocol === 'https:' ? https : http;
  let finished = false;
  const remote = transport.request(destination, { method: request.method, headers }, (result) => {
    const chunks = [];
    let size = 0;
    if (
      result.headers['set-cookie'] ||
      !/^application\/(?:problem\+)?json(?:\s*;|$)/i.test(result.headers['content-type'] ?? '') ||
      Number(result.headers['content-length'] ?? 0) > maximum
    ) {
      finish();
      result.destroy();
      reject(503);
      return;
    }
    result.on('data', (chunk) => {
      size += chunk.length;
      if (size > maximum) {
        finish();
        result.destroy();
        reject(503);
      } else chunks.push(chunk);
    });
    result.on('error', () => {
      finish();
      reject(503);
    });
    result.on('end', () => {
      if (finished) return;
      finish();
      let value;
      try {
        value = rmaJson(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
      } catch {
        reject(503);
        return;
      }
      if (result.statusCode === 200) {
        if (!(workspaceRoute?.output ?? smsOutput)(value)) {
          reject(503);
          return;
        }
        if (!response.destroyed) {
          response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify(value));
        }
        return;
      }
      const allowed = new Set([
        invalidTitle,
        'sms_settings_conflict',
        'otp_configuration_conflict',
        'customer_login_continuity_conflict',
        'otp_unavailable',
        'invalid_sms_workspace',
        'sms_workspace_conflict',
        'sms_workspace_upgrade_required',
        'sms_template_unavailable',
        'sms_event_conflict',
        ...(workspaceRoute?.errorTitles ?? []),
      ]);
      const status = [
        400,
        401,
        403,
        409,
        413,
        415,
        429,
        503,
        ...(workspaceRoute?.allowNotFound ? [404] : []),
      ].includes(result.statusCode)
        ? result.statusCode
        : 503;
      const title = allowed.has(value?.title)
        ? value.title
        : status === 401
          ? 'unauthorized'
          : status === 403
            ? 'forbidden'
            : unavailable;
      if (status === 429 && /^[0-9]{1,5}$/.test(result.headers['retry-after'] ?? ''))
        response.setHeader('Retry-After', result.headers['retry-after']);
      reject(
        status,
        title,
        workspaceRoute?.preserveValidationErrors &&
          status === 400 &&
          title === 'invalid_product_fields' &&
          boundedProductErrors(value?.errors)
          ? value.errors
          : undefined,
      );
    });
  });
  const timer = setTimeout(() => {
    finish();
    remote.destroy();
    reject(503);
  }, 10000);
  function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    request.removeListener('aborted', abort);
    response.removeListener('close', abort);
  }
  function abort() {
    finish();
    remote.destroy();
  }
  request.once('aborted', abort);
  response.once('close', abort);
  remote.on('error', () => {
    finish();
    reject(503);
  });
  remote.end(input);
}
async function publicCatalogImage(request, response, destination) {
  const stop = new AbortController();
  const abort = () => stop.abort();
  request.once('aborted', abort);
  response.once('close', abort);
  let remote;
  const reject = (status = 503) => {
    if (!response.destroyed && !response.headersSent) {
      response.writeHead(status, { 'Cache-Control': 'no-store' });
      response.end();
    }
  };
  try {
    remote = await new Promise((resolve, fail) => {
      const proxy = (destination.protocol === 'https:' ? https : http).request(
        destination,
        {
          method: 'GET',
          headers: { Accept: 'image/webp' },
          signal: AbortSignal.any([stop.signal, AbortSignal.timeout(10000)]),
        },
        resolve,
      );
      proxy.once('error', fail);
      proxy.end();
    });
    if (remote.statusCode === 404) {
      reject(404);
      return;
    }
    const tag = remote.headers.etag ?? '',
      size = Number(remote.headers['content-length']);
    if (
      remote.statusCode !== 200 ||
      remote.headers['content-type'] !== 'image/webp' ||
      remote.headers['x-shop-public-resource'] !== 'catalog-image-v1' ||
      remote.headers['set-cookie'] ||
      remote.headers['content-encoding'] ||
      /(?:^|,)\s*(?:cookie|authorization)\s*(?:,|$)/i.test(remote.headers.vary ?? '') ||
      !/\bpublic\b/i.test(remote.headers['cache-control'] ?? '') ||
      /private|no-store/i.test(remote.headers['cache-control'] ?? '') ||
      !/^"[a-f0-9]{64}"$/.test(tag) ||
      !Number.isSafeInteger(size) ||
      size < 12 ||
      size > 8 * 1024 * 1024
    ) {
      reject();
      return;
    }
    const chunks = [];
    let received = 0;
    for await (const chunk of remote) {
      received += chunk.length;
      if (received > size || received > 8 * 1024 * 1024) {
        reject();
        return;
      }
      chunks.push(chunk);
    }
    if (received !== size) {
      reject();
      return;
    }
    const bytes = Buffer.concat(chunks);
    if (
      bytes.subarray(0, 4).toString('ascii') !== 'RIFF' ||
      bytes.subarray(8, 12).toString('ascii') !== 'WEBP' ||
      createHash('sha256').update(bytes).digest('hex') !== tag.slice(1, -1)
    ) {
      reject();
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'image/webp',
      'Content-Length': String(size),
      ETag: tag,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Shop-Public-Resource': 'catalog-image-v1',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    response.end(bytes);
  } catch {
    reject();
  } finally {
    request.removeListener('aborted', abort);
    response.removeListener('close', abort);
    stop.abort();
    remote?.destroy();
  }
}

export function createAdminServer({
  root = fileURLToPath(new URL('./dist/', import.meta.url)),
  apiUrl = process.env.ADMIN_API_URL,
  publicUrl = process.env.ADMIN_PUBLIC_URL,
} = {}) {
  let activePublicImages = 0,
    activeUploads = 0,
    activeDownloads = 0;
  const directory = path.resolve(root);
  if (process.env.NODE_ENV === 'production' && !publicUrl)
    throw new Error('ADMIN_PUBLIC_URL is required in production.');
  const publicOrigin = new URL(publicUrl ?? 'http://127.0.0.1:3173');
  if (
    publicOrigin.username ||
    publicOrigin.password ||
    publicOrigin.pathname !== '/' ||
    publicOrigin.search ||
    publicOrigin.hash ||
    !(
      publicOrigin.protocol === 'https:' ||
      (publicOrigin.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(publicOrigin.hostname))
    )
  )
    throw new Error('ADMIN_PUBLIC_URL must be HTTPS or the explicit loopback development origin.');
  const secureCookies = publicOrigin.protocol === 'https:';
  const upstream = apiUrl ? new URL(apiUrl) : null;
  if (upstream && !['http:', 'https:'].includes(upstream.protocol))
    throw new Error('ADMIN_API_URL must use HTTP or HTTPS.');
  return http.createServer(
    { requestTimeout: 60000, headersTimeout: 15000 },
    async (request, response) => {
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('X-Frame-Options', 'DENY');
      response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader(
        'Permissions-Policy',
        'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      );
      if (secureCookies) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
      const problem = (status) => {
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({
            title: status === 413 ? 'request_too_large' : 'unavailable',
            detail: status === 413 ? 'Request is too large.' : 'Admin API is unavailable.',
          }),
        );
      };
      try {
        const incoming = new URL(request.url ?? '/', 'http://localhost');
        if (incoming.pathname.startsWith('/api/media/videos/')) {
          if (!/^\/api\/media\/videos\/[a-f0-9]{32}\/clip\.(mp4|webm)$/.test(incoming.pathname)) {
            response.writeHead(404);
            response.end();
            request.resume();
            return;
          }
          if (request.method !== 'GET') {
            response.writeHead(405, { Allow: 'GET' });
            response.end();
            request.resume();
            return;
          }
          if (
            incoming.search ||
            incoming.hash ||
            request.headers['transfer-encoding'] ||
            Number(request.headers['content-length'] ?? 0) !== 0 ||
            !videoRange(request.headers.range)
          ) {
            response.writeHead(400);
            response.end();
            request.resume();
            return;
          }
          if (!upstream) {
            problem(503);
            return;
          }
          if (activePublicImages >= 8) {
            response.writeHead(429, { 'Retry-After': '2' });
            response.end();
            return;
          }
          activePublicImages++;
          response.once('close', () => {
            activePublicImages--;
          });
          const destination = new URL(upstream);
          destination.pathname = incoming.pathname;
          destination.search = '';
          destination.hash = '';
          destination.username = '';
          destination.password = '';
          await publicCatalogVideo(request, response, destination);
          return;
        }
        if (incoming.pathname.startsWith('/api/media/')) {
          if (
            !/^\/api\/media\/catalog\/[a-f0-9]{32}\/(?:thumb|card|zoom)\.webp$/.test(
              incoming.pathname,
            )
          ) {
            response.writeHead(404);
            response.end();
            request.resume();
            return;
          }
          if (request.method !== 'GET') {
            response.writeHead(405, { Allow: 'GET' });
            response.end();
            request.resume();
            return;
          }
          if (
            incoming.search ||
            incoming.hash ||
            request.headers.range ||
            request.headers['transfer-encoding'] ||
            Number(request.headers['content-length'] ?? 0) !== 0
          ) {
            response.writeHead(400);
            response.end();
            request.resume();
            return;
          }
          if (!upstream) {
            problem(503);
            return;
          }
          if (activePublicImages >= 8) {
            response.writeHead(429, { 'Retry-After': '2' });
            response.end();
            return;
          }
          activePublicImages++;
          response.once('close', () => {
            activePublicImages--;
          });
          const destination = new URL(upstream);
          destination.pathname = incoming.pathname;
          destination.search = '';
          destination.hash = '';
          destination.username = '';
          destination.password = '';
          await publicCatalogImage(request, response, destination);
          return;
        }
        if (incoming.pathname.startsWith('/api/')) {
          response.setHeader('Cache-Control', 'private, no-store');
          response.setHeader('X-Robots-Tag', 'noindex, nofollow');
          response.setHeader('Vary', 'Origin, Cookie, Authorization');
          // Routing in ASP.NET is case-insensitive and decodes path escapes.
          // Never let alternate spellings bypass a key-bearing route's bounded
          // input/output proxy and reach the general streaming proxy instead.
          if (incoming.pathname.includes('%') || incoming.pathname.includes('//')) {
            response.writeHead(400);
            response.end();
            request.resume();
            return;
          }
          if (
            /^\/api\/admin\/(?:market|sourcing|inventory\/sourcing-(?:tasks|requests|receipts|allocations))(?:\/|$)/i.test(
              incoming.pathname,
            )
          ) {
            response.writeHead(410);
            response.end();
            request.resume();
            return;
          }
          const authRoute =
            /^\/api\/auth\/(?:password|refresh|logout|me|staff\/(?:password|change-password)|mfa\/(?:setup|verify|recovery-codes|recover))$/.test(
              incoming.pathname,
            );
          if (!authRoute && !incoming.pathname.startsWith('/api/admin/')) {
            response.writeHead(404);
            response.end();
            request.resume();
            return;
          }
          const origin = request.headers.origin;
          if (
            request.headers['sec-fetch-site'] === 'cross-site' ||
            (origin && origin !== publicOrigin.origin) ||
            (authRoute && request.method !== 'GET' && !origin)
          ) {
            response.writeHead(403);
            response.end();
            request.resume();
            return;
          }
          if (!authRoute && !request.headers.authorization) {
            response.writeHead(401);
            response.end();
            request.resume();
            return;
          }
          if (/^\/api\/admin\/sms(?:\/|$)/i.test(incoming.pathname)) {
            await proxyBoundedAdminJson(
              request,
              response,
              incoming,
              upstream,
              publicOrigin,
              smsWorkspaceRoute(incoming),
            );
            return;
          }
          if (/^\/api\/admin\/catalog\/workspace(?:\/|$)/i.test(incoming.pathname)) {
            const route = productWorkspaceRoute(incoming, request.method);
            if (!route) {
              response.writeHead(404);
              response.end();
              request.resume();
              return;
            }
            await proxyBoundedAdminJson(request, response, incoming, upstream, publicOrigin, route);
            return;
          }
          if (
            authRoute &&
            (incoming.search ||
              !(
                (request.method === 'GET' &&
                  ['me', 'mfa/recovery-codes'].includes(incoming.pathname.slice(10))) ||
                (request.method === 'POST' && !incoming.pathname.endsWith('/me'))
              ))
          ) {
            response.writeHead(400);
            response.end();
            request.resume();
            return;
          }
          if (
            authRoute &&
            request.method === 'POST' &&
            !/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')
          ) {
            response.writeHead(415);
            response.end();
            request.resume();
            return;
          }
          const realtime = /^\/api\/admin\/realtime(?:\/negotiate)?$/.test(incoming.pathname);
          const privateStaff =
            incoming.pathname === '/api/admin/staff' ||
            incoming.pathname.startsWith('/api/admin/staff/') ||
            incoming.pathname === '/api/admin/staff-candidate' ||
            incoming.pathname === '/api/admin/staff-role-catalog';
          const privateCustomers =
            incoming.pathname === '/api/admin/customers' ||
            incoming.pathname.startsWith('/api/admin/customers/');
          const privateReturns =
            incoming.pathname === '/api/admin/returns' ||
            incoming.pathname.startsWith('/api/admin/returns/');
          const reviewPhoto =
            incoming.pathname.startsWith('/api/admin/reviews/') &&
            incoming.pathname.includes('/photos/');
          const returnsRoute = privateReturns ? rmaRoute(incoming) : null;
          const initialStaffPassword = [
            '/api/auth/staff/password',
            '/api/auth/staff/change-password',
          ].includes(incoming.pathname);
          const staffBoundary = privateStaff || initialStaffPassword || privateCustomers;
          const privateParcels =
            incoming.pathname.startsWith('/api/admin/orders/') &&
            incoming.pathname.includes('/fulfillment');
          const privateDigital =
            privateParcels && /\/fulfillment\/digital(?:\/|$)/.test(incoming.pathname);
          const privateCreditOrders = incoming.pathname.startsWith('/api/admin/credit-orders/');
          const privateCredit =
            incoming.pathname === '/api/admin/credit' ||
            incoming.pathname.startsWith('/api/admin/credit/');
          const creditDocumentDownload =
            /^\/api\/admin\/credit\/applications\/[a-f0-9]{32}\/documents\/files\/[a-f0-9]{32}$/.test(
              incoming.pathname,
            ) && request.method === 'GET';
          const privateFiles =
              /^\/api\/admin\/support\/(?:files\/capabilities|tickets\/[a-f0-9]{32}\/attachments(?:\/[a-f0-9]{32})?)$/.test(
                incoming.pathname,
              ),
            privateFileUpload =
              privateFiles &&
              request.method === 'POST' &&
              /\/attachments\/[a-f0-9]{32}$/.test(incoming.pathname),
            privateDownload =
              creditDocumentDownload ||
              (privateFiles &&
                request.method === 'GET' &&
                /\/attachments\/[a-f0-9]{32}$/.test(incoming.pathname));
          const privateBlog =
            incoming.pathname === '/api/admin/blog-posts' ||
            incoming.pathname.startsWith('/api/admin/blog-posts/');
          const privatePages =
            privateBlog ||
            incoming.pathname === '/api/admin/pages' ||
            incoming.pathname.startsWith('/api/admin/pages/');
          const privateRedirects =
            incoming.pathname === '/api/admin/redirects' ||
            incoming.pathname.startsWith('/api/admin/redirects/');
          const privateApi =
            privateReturns ||
            reviewPhoto ||
            staffBoundary ||
            privateParcels ||
            privateRedirects ||
            privatePages ||
            realtime ||
            incoming.pathname.startsWith('/api/admin/support/') ||
            privateCredit ||
            privateCreditOrders;
          if (privateApi) {
            response.setHeader('Cache-Control', 'private, no-store');
            response.setHeader('X-Robots-Tag', 'noindex, nofollow');
            response.setHeader('Vary', 'Cookie, Authorization');
          }
          if (!upstream) {
            problem(503);
            return;
          }
          if (reviewPhoto) {
            if (
              request.method !== 'GET' ||
              incoming.search ||
              !/^\/api\/admin\/reviews\/[a-f0-9]{32}\/photos\/[a-f0-9]{32}$/.test(incoming.pathname)
            ) {
              response.writeHead(404);
              response.end();
              request.resume();
              return;
            }
            if (!/^Bearer [A-Za-z0-9._-]{20,8185}$/.test(request.headers.authorization ?? '')) {
              response.writeHead(401);
              response.end();
              request.resume();
              return;
            }
          }
          if (privateReturns) {
            const invalid = (status) => {
              response.writeHead(status);
              response.end();
              request.resume();
            };
            if (!returnsRoute) {
              invalid(404);
              return;
            }
            if (!returnsRoute.methods.includes(request.method)) {
              invalid(405);
              return;
            }
            if (!rmaQuery(incoming, returnsRoute.query)) {
              invalid(400);
              return;
            }
            if (request.method === 'PUT' && origin !== publicOrigin.origin) {
              invalid(403);
              return;
            }
            if (
              request.method === 'PUT' &&
              !/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')
            ) {
              invalid(415);
              return;
            }
          }
          if (staffBoundary) {
            if (!request.headers.authorization) {
              response.writeHead(401);
              response.end();
              request.resume();
              return;
            }
            const base = '/api/admin/staff',
              id = '[A-Za-z0-9_-]{1,450}',
              commandId = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
            const path = incoming.pathname;
            const customerBase = '/api/admin/customers',
              customerRoute = new RegExp(
                '^' +
                  customerBase +
                  '(?:/' +
                  id +
                  '(?:/(?:orders(?:/[a-f0-9]{32})?|tickets(?:/[a-f0-9]{32}/messages)?))?)?$',
              );
            const allowed = privateCustomers
              ? customerRoute.test(path)
                ? ['GET']
                : []
              : initialStaffPassword ||
                  path === base + '/accounts' ||
                  path === '/api/admin/staff-candidate'
                ? ['POST']
                : path === base
                  ? ['GET', 'POST']
                  : path === '/api/admin/staff-role-catalog' ||
                      new RegExp('^' + base + '/creation-commands/' + commandId + '$').test(path) ||
                      new RegExp('^' + base + '/' + id + '/history$').test(path)
                    ? ['GET']
                    : new RegExp('^' + base + '/' + id + '$').test(path)
                      ? ['GET', 'PUT']
                      : [];
            if (!allowed.length || !allowed.includes(request.method)) {
              response.writeHead(allowed.length ? 405 : 400);
              response.end();
              request.resume();
              return;
            }
            const keys = privateCustomers
              ? path === customerBase
                ? ['query', 'active', 'kind', 'cursor']
                : /\/(?:orders|tickets|messages)$/.test(path)
                  ? ['cursor']
                  : []
              : path === base && request.method === 'GET'
                ? ['query', 'active', 'role', 'cursor']
                : path.endsWith('/history')
                  ? ['cursor']
                  : [];
            if (
              [...incoming.searchParams.keys()].some(
                (key) => !keys.includes(key) || incoming.searchParams.getAll(key).length !== 1,
              ) ||
              (incoming.searchParams.get('query')?.length ?? 0) > 120
            ) {
              response.writeHead(400);
              response.end();
              request.resume();
              return;
            }
            if (
              request.method !== 'GET' &&
              !/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')
            ) {
              response.writeHead(415);
              response.end();
              request.resume();
              return;
            }
          }
          if (privateParcels) {
            if (!request.headers.authorization) {
              response.writeHead(401);
              response.end();
              request.resume();
              return;
            }
            const id = '[a-f0-9]{32}',
              base = '/api/admin/orders/[A-Za-z0-9_-]{1,64}/' + id + '/fulfillment';
            const page = new RegExp('^' + base + '$').test(incoming.pathname),
              read = new RegExp(
                '^' +
                  base +
                  '(?:/(?:parcels|commands)/' +
                  id +
                  '|/digital(?:/commands/' +
                  id +
                  ')?)?$',
              ).test(incoming.pathname),
              write = new RegExp('^' + base + '(?:/digital)?/commands/' + id + '$').test(
                incoming.pathname,
              );
            if (
              /(?:^|\/)0{32}(?:\/|$)/.test(incoming.pathname) ||
              !((request.method === 'GET' && read) || (request.method === 'POST' && write))
            ) {
              response.writeHead(request.method === 'GET' ? 404 : 405);
              response.end();
              request.resume();
              return;
            }
            const entries = [...incoming.searchParams];
            if (
              entries.length &&
              (request.method !== 'GET' ||
                !page ||
                entries.length !== 1 ||
                entries[0][0] !== 'after' ||
                !/^[1-9][0-9]{0,18}$/.test(entries[0][1]) ||
                BigInt(entries[0][1]) > 9223372036854775807n)
            ) {
              response.writeHead(400);
              response.end();
              request.resume();
              return;
            }
          }
          if (privateRedirects) {
            if (!request.headers.authorization) {
              response.writeHead(401);
              response.end();
              request.resume();
              return;
            }
            const tail = incoming.pathname.slice('/api/admin/redirects'.length),
              id = '[a-f0-9]{32}';
            const read = new RegExp(
                '^(?:|/' +
                  id +
                  '|/' +
                  id +
                  '/preview|/' +
                  id +
                  '/history|/' +
                  id +
                  '/revisions/' +
                  id +
                  '|(?:/' +
                  id +
                  ')?/commands/' +
                  id +
                  ')$',
              ).test(tail),
              write = new RegExp('^(?:/' + id + ')?/commands/' + id + '$').test(tail);
            if (!(request.method === 'GET' ? read : request.method === 'POST' && write)) {
              response.writeHead(405);
              response.end();
              request.resume();
              return;
            }
            const params = [...incoming.searchParams],
              allowed =
                tail === '' ? ['cursor'] : tail.endsWith('/history') ? ['beforePublication'] : [];
            if (
              params.length !== new Set(params.map((x) => x[0])).size ||
              params.some(
                ([k, v]) =>
                  !allowed.includes(k) ||
                  (k === 'cursor'
                    ? !/^\/(fa|en)\/(product|pages)\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v) ||
                      /\s/.test(v) ||
                      v.length > 192 ||
                      v.split('/')[3].length > (v.split('/')[2] === 'pages' ? 80 : 150)
                    : !/^[1-9][0-9]{0,4}$/.test(v) || Number(v) > 10000),
              )
            ) {
              response.writeHead(400);
              response.end();
              request.resume();
              return;
            }
          }
          if (privatePages) {
            if (!request.headers.authorization) {
              response.writeHead(401);
              response.end();
              request.resume();
              return;
            }
            const tail = incoming.pathname.slice(
                (privateBlog ? '/api/admin/blog-posts' : '/api/admin/pages').length,
              ),
              id = '[a-f0-9]{32}';
            const read = new RegExp(
                '^(?:|/' +
                  id +
                  '|/' +
                  id +
                  '/history|/' +
                  id +
                  '/revisions/' +
                  id +
                  '|(?:/' +
                  id +
                  ')?/commands/' +
                  id +
                  ')$',
              ).test(tail),
              write = new RegExp('^(?:/' + id + ')?/commands/' + id + '$').test(tail);
            if (!(request.method === 'GET' ? read : request.method === 'POST' && write)) {
              response.writeHead(405);
              response.end();
              request.resume();
              return;
            }
            const params = [...incoming.searchParams],
              allowed =
                tail === '' ? ['cursor'] : tail.endsWith('/history') ? ['beforePublication'] : [];
            if (
              params.length !== new Set(params.map((x) => x[0])).size ||
              params.some(
                ([k, v]) =>
                  !allowed.includes(k) ||
                  (k === 'cursor'
                    ? !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v) || v.length > 80
                    : !/^[1-9][0-9]{0,4}$/.test(v) || Number(v) > 10000),
              )
            ) {
              response.writeHead(400);
              response.end();
              request.resume();
              return;
            }
          }
          if (privateCreditOrders) {
            if (!request.headers.authorization) {
              response.writeHead(401);
              response.end();
              request.resume();
              return;
            }
            if (
              request.method !== 'GET' ||
              !/^\/api\/admin\/credit-orders\/[A-Za-z0-9_-]{1,64}\/[a-f0-9]{32}$/.test(
                incoming.pathname,
              ) ||
              /\/0{32}$/.test(incoming.pathname)
            ) {
              response.writeHead(request.method === 'GET' ? 404 : 405);
              response.end();
              request.resume();
              return;
            }
            if (incoming.search) {
              response.writeHead(400);
              response.end();
              request.resume();
              return;
            }
          }
          if (privateCredit) {
            if (!request.headers.authorization) {
              response.writeHead(401);
              response.end();
              request.resume();
              return;
            }
            const id = '[a-f0-9]{32}',
              base = '/api/admin/credit/',
              p = incoming.pathname.slice(base.length),
              history = p === 'requirements/history';
            const approvalBase = 'orders/[A-Za-z0-9_-]{1,64}/' + id + '/cheque-approvals';
            const policyBase = 'review-hold-policy',
              clearanceBase = 'orders/[A-Za-z0-9_-]{1,64}/' + id + '/clearance';
            const upfrontBase = 'orders/[A-Za-z0-9_-]{1,64}/' + id + '/upfront';
            const chequeBase = 'orders/[A-Za-z0-9_-]{1,64}/' + id + '/cheques';
            const reminderBase = chequeBase + '/' + id + '/reminders',
              reminderPolicyBase = 'reminder-policy';
            const orderBase = 'orders/[A-Za-z0-9_-]{1,64}/' + id + '/schedule';
            const read =
                new RegExp('^' + reminderPolicyBase + '(?:/history|/commands/' + id + ')?$').test(
                  p,
                ) ||
                new RegExp('^' + reminderBase + '(?:/history|/commands/' + id + ')?$').test(p) ||
                p === 'cheque-report' ||
                new RegExp('^' + clearanceBase + '(?:/history|/commands/' + id + ')?$').test(p) ||
                new RegExp('^' + policyBase + '(?:/history|/commands/' + id + ')?$').test(p) ||
                new RegExp(
                  '^' + approvalBase + '(?:/' + id + '(?:/history|/commands/' + id + ')?)?$',
                ).test(p) ||
                new RegExp('^' + upfrontBase + '(?:/history|/commands/' + id + ')?$').test(p) ||
                new RegExp(
                  '^' + chequeBase + '(?:/' + id + '(?:/history)?|/commands/' + id + ')?$',
                ).test(p) ||
                p === 'orders' ||
                new RegExp('^' + orderBase + '(?:/history|/commands/' + id + ')?$').test(p) ||
                p === 'applications' ||
                p === 'requirements' ||
                history ||
                new RegExp(
                  '^applications/' +
                    id +
                    '(?:/purchase-scope(?:/commands/' +
                    id +
                    ')?|/review|/reviews(?:/(?:commands/)?' +
                    id +
                    ')?|/submission|/submissions(?:/' +
                    id +
                    ')?|/requirements|/documents(?:/files/' +
                    id +
                    ')?)?$',
                ).test(p) ||
                new RegExp('^requirements/(?:revisions|commands)/' + id + '$').test(p),
              write =
                new RegExp('^' + reminderPolicyBase + '/commands/' + id + '$').test(p) ||
                new RegExp('^' + reminderBase + '/commands/' + id + '$').test(p) ||
                new RegExp('^' + clearanceBase + '/commands/' + id + '$').test(p) ||
                new RegExp('^' + policyBase + '/commands/' + id + '$').test(p) ||
                new RegExp('^' + approvalBase + '/' + id + '/commands/' + id + '$').test(p) ||
                new RegExp('^' + upfrontBase + '/commands/' + id + '$').test(p) ||
                new RegExp('^' + chequeBase + '/(?:receive|' + id + ')/commands/' + id + '$').test(
                  p,
                ) ||
                new RegExp('^' + orderBase + '/(?:preview|commands/' + id + ')$').test(p) ||
                new RegExp(
                  '^(?:requirements/commands/' +
                    id +
                    '|applications/' +
                    id +
                    '/purchase-scope/(?:grant|revoke)/' +
                    id +
                    '|applications/' +
                    id +
                    '/reviews/commands/' +
                    id +
                    ')$',
                ).test(p);
            if (
              !((request.method === 'GET' && read) || (request.method === 'POST' && write)) ||
              /(?:^|\/)0{32}(?:\/|$)/.test(p)
            ) {
              response.writeHead(request.method !== 'GET' ? 405 : 404);
              response.end();
              request.resume();
              return;
            }
            const allowed =
                request.method === 'GET'
                  ? p === 'cheque-report'
                    ? ['from', 'through', 'state', 'cursor']
                    : p === policyBase + '/history' || p === reminderPolicyBase + '/history'
                      ? ['beforeRevision']
                      : p === 'applications'
                        ? ['state', 'cursor']
                        : history || p === 'orders'
                          ? ['cursor']
                          : new RegExp('^' + orderBase + '/history$').test(p)
                            ? ['beforeRevision']
                            : new RegExp('^' + reminderBase + '/history$').test(p) ||
                                new RegExp('^' + clearanceBase + '/history$').test(p) ||
                                new RegExp('^' + approvalBase + '/' + id + '/history$').test(p) ||
                                new RegExp('^' + upfrontBase + '/history$').test(p) ||
                                new RegExp('^' + chequeBase + '/' + id + '/history$').test(p)
                              ? ['beforeSequence']
                              : []
                  : [],
              entries = [...incoming.searchParams];
            if (p === 'cheque-report') {
              const date = (v) =>
                /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v) &&
                Number(v.slice(0, 4)) >= 2000 &&
                Number.isFinite(Date.parse(v + 'T12:00:00Z')) &&
                new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v;
              const from = incoming.searchParams.get('from'),
                through = incoming.searchParams.get('through');
              if (
                entries.length !== new Set(entries.map((x) => x[0])).size ||
                !from ||
                !through ||
                !date(from) ||
                !date(through) ||
                from > through ||
                Date.parse(through) - Date.parse(from) > 365 * 86400000 ||
                !incoming.searchParams.has('state') ||
                entries.some(
                  ([k, v]) =>
                    !allowed.includes(k) ||
                    (k === 'state'
                      ? ![
                          'All',
                          'Received',
                          'Deposited',
                          'CollectedReported',
                          'BouncedReported',
                          'Withdrawn',
                          'ReturnedToCustomer',
                        ].includes(v)
                      : k === 'cursor'
                        ? !/^[A-Za-z0-9_-]{1,2048}$/.test(v)
                        : !date(v)),
                )
              ) {
                response.writeHead(400);
                response.end();
                request.resume();
                return;
              }
            } else if (
              entries.length !== new Set(entries.map((x) => x[0])).size ||
              entries.some(
                ([key, value]) =>
                  !allowed.includes(key) ||
                  (key === 'state'
                    ? !['Draft', 'Submitted', 'Cancelled', 'Approved', 'Declined'].includes(value)
                    : key === 'beforeSequence'
                      ? !/^[1-9][0-9]{0,3}$/.test(value) ||
                        Number(value) >
                          (new RegExp('^' + reminderBase + '/history$').test(p) ? 3650 : 200)
                      : key === 'beforeRevision'
                        ? !/^[1-9][0-9]{0,9}$/.test(value) ||
                          Number(value) >
                            (p === policyBase + '/history' || p === reminderPolicyBase + '/history'
                              ? 10000
                              : 2147483647)
                        : value.length < 1 ||
                          value.length > 180 ||
                          !/^[A-Za-z0-9+/]+={0,2}$/.test(value)),
              )
            ) {
              response.writeHead(400);
              response.end();
              request.resume();
              return;
            }
          }
          if (privateDownload) {
            if (request.headers.range) {
              response.writeHead(400);
              response.end();
              request.resume();
              return;
            }
            if (!request.headers.authorization) {
              response.writeHead(401);
              response.end();
              request.resume();
              return;
            }
            if (activeDownloads >= 2) {
              response.writeHead(429, { 'Retry-After': '2' });
              response.end();
              request.resume();
              return;
            }
            activeDownloads++;
            const deadline = setTimeout(() => response.destroy(), 30000);
            deadline.unref();
            response.once('close', () => {
              clearTimeout(deadline);
              activeDownloads--;
            });
          }
          if (
            !['GET', 'POST', 'PUT'].includes(request.method ?? '') &&
            !(
              realtime &&
              incoming.pathname === '/api/admin/realtime' &&
              request.method === 'DELETE'
            )
          ) {
            response.writeHead(405);
            response.end();
            request.resume();
            return;
          }
          const upload =
            privateFileUpload ||
            (['/api/admin/media/images', '/api/admin/media/videos'].includes(incoming.pathname) &&
              request.method === 'POST');
          const maximum = privateReturns
            ? rmaRequestLimit
            : authRoute || staffBoundary
              ? 16384
              : privateParcels
                ? privateDigital
                  ? 524288
                  : 65536
                : privateRedirects
                  ? 16384
                  : privatePages
                    ? 131072
                    : privateCreditOrders
                      ? 16384
                      : privateCredit
                        ? /^\/api\/admin\/credit\/requirements\/commands\//.test(incoming.pathname)
                          ? 49152
                          : 8192
                        : realtime
                          ? 4096
                          : upload
                            ? (incoming.pathname === '/api/admin/media/videos' ? 32 : 8) *
                                1024 *
                                1024 +
                              65536
                            : limit;
          if (upload) {
            if (!request.headers.authorization) {
              response.writeHead(401, { 'Content-Type': 'application/json' });
              response.end(JSON.stringify({ title: 'unauthorized' }));
              request.resume();
              return;
            }
            if (activeUploads >= 2) {
              response.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '2' });
              response.end(JSON.stringify({ title: 'media_busy' }));
              request.resume();
              return;
            }
            activeUploads++;
            let released = false;
            response.once('close', () => {
              if (!released) {
                released = true;
                activeUploads--;
              }
            });
          }
          if (Number(request.headers['content-length'] ?? 0) > maximum) {
            problem(413);
            request.resume();
            return;
          }
          const payload = await body(request, maximum);
          if (payload === null) {
            problem(413);
            return;
          }
          if (
            (privateReturns || privateParcels || staffBoundary) &&
            request.method === 'GET' &&
            payload.length
          ) {
            response.writeHead(400);
            response.end();
            return;
          }
          if (privateReturns && request.method === 'PUT') {
            try {
              if (
                !rmaInput(
                  rmaJson(new TextDecoder('utf-8', { fatal: true }).decode(payload)),
                  returnsRoute.input,
                )
              )
                throw Error('Invalid return request');
            } catch {
              response.writeHead(400);
              response.end();
              return;
            }
          }
          const destination = new URL(upstream);
          destination.pathname = incoming.pathname;
          destination.search = incoming.search;
          const headers = {
            host: destination.host,
            'content-type': request.headers['content-type'] ?? 'application/json',
            'content-length': payload.length,
          };
          for (const key of ['authorization', 'origin'])
            if (request.headers[key]) headers[key] = request.headers[key];
          // Same-origin browser GETs normally omit Origin. This one private
          // bearer read still needs the configured admin origin upstream;
          // caller-supplied/cross-site origins were rejected above.
          if (
            incoming.pathname === '/api/auth/mfa/recovery-codes' &&
            request.method === 'GET' &&
            !origin
          )
            headers.origin = publicOrigin.origin;
          headers['x-sayman-client'] = 'admin';
          if (incoming.pathname === '/api/auth/password') headers['x-sayman-admin'] = '1';
          if (authRoute) {
            try {
              const cookie = readAdminRefreshCookie(request.headers.cookie, secureCookies);
              if (cookie) headers.cookie = `${adminRefreshCookieName(secureCookies)}=${cookie}`;
            } catch {
              response.writeHead(400);
              response.end();
              return;
            }
          }
          const proxy = (destination.protocol === 'https:' ? https : http).request(
            destination,
            { method: request.method, headers },
            (remote) => {
              const result = {
                'Content-Type': remote.headers['content-type'] ?? 'application/json',
                'Cache-Control': 'private, no-store',
                'X-Robots-Tag': 'noindex, nofollow',
                Vary: 'Origin, Cookie, Authorization',
              };
              if (privateApi) {
                result['X-Robots-Tag'] = 'noindex, nofollow';
                result.Vary = 'Cookie, Authorization';
              }
              if (remote.headers['set-cookie']) {
                const cookies = remote.headers['set-cookie'].map((cookie) =>
                  safeAdminRefreshCookie(cookie, secureCookies),
                );
                if (!authRoute || cookies.some((cookie) => !cookie)) {
                  remote.destroy();
                  problem(503);
                  return;
                }
                result['Set-Cookie'] = cookies;
              }
              if (remote.headers['retry-after'])
                result['Retry-After'] = remote.headers['retry-after'];
              if (reviewPhoto) {
                const status = remote.statusCode ?? 503,
                  length = Number(remote.headers['content-length']);
                if (
                  ![200, 400, 401, 403, 404, 429, 503].includes(status) ||
                  remote.headers['content-encoding'] ||
                  (status === 200 &&
                    (remote.headers['content-type'] !== 'image/webp' ||
                      !Number.isSafeInteger(length) ||
                      length < 12 ||
                      length > 2 * 1024 * 1024))
                ) {
                  remote.destroy();
                  problem(503);
                  return;
                }
                if (status === 200) {
                  result['Content-Length'] = String(length);
                  result['Cross-Origin-Resource-Policy'] = 'same-origin';
                }
              }
              if (privateReturns) {
                const installed = remote.headers['x-sayman-returns-contract'] === 'rma-v1',
                  status = remote.statusCode ?? 503,
                  success = status >= 200 && status < 300,
                  json = /^application\/(?:problem\+)?json(?:\s*;|$)/i.test(
                    remote.headers['content-type'] ?? '',
                  );
                const chunks = [];
                let received = 0,
                  finished = false;
                const reject = () => {
                  if (finished) return;
                  finished = true;
                  remote.destroy();
                  if (!response.headersSent && !response.destroyed) problem(503);
                };
                if (
                  Number(remote.headers['content-length']) > rmaResponseLimit ||
                  (success &&
                    (status !== 200 ||
                      !installed ||
                      !/^application\/json(?:\s*;|$)/i.test(
                        remote.headers['content-type'] ?? '',
                      ))) ||
                  (status === 404 && !installed) ||
                  ![200, 400, 401, 403, 404, 409, 413, 415, 429, 503].includes(status)
                ) {
                  reject();
                  return;
                }
                if (installed) result['X-Sayman-Returns-Contract'] = 'rma-v1';
                remote.on('data', (chunk) => {
                  received += chunk.length;
                  if (received > rmaResponseLimit) reject();
                  else if (!finished) chunks.push(chunk);
                });
                remote.once('error', reject);
                remote.once('aborted', reject);
                remote.once('end', () => {
                  if (finished) return;
                  const content = Buffer.concat(chunks);
                  try {
                    if (content.length) {
                      if (!json) throw Error('Unexpected content type');
                      rmaJson(new TextDecoder('utf-8', { fatal: true }).decode(content));
                    } else if (success) throw Error('Missing return response');
                  } catch {
                    reject();
                    return;
                  }
                  finished = true;
                  response.writeHead(status, result);
                  response.end(content);
                });
                return;
              }
              if (authRoute) {
                const chunks = [];
                let received = 0,
                  finished = false;
                const reject = () => {
                  if (finished) return;
                  finished = true;
                  remote.destroy();
                  if (!response.headersSent && !response.destroyed) problem(503);
                };
                const jsonResponse = /^application\/(?:problem\+)?json(?:\s*;|$)/i.test(
                  remote.headers['content-type'] ?? '',
                );
                const errorResponse = (remote.statusCode ?? 503) >= 400;
                if (
                  Number(remote.headers['content-length']) > 32768 ||
                  (remote.statusCode !== 204 && !jsonResponse && !errorResponse)
                ) {
                  reject();
                  return;
                }
                remote.on('data', (chunk) => {
                  received += chunk.length;
                  if (received > 32768) reject();
                  else if (!finished) chunks.push(chunk);
                });
                remote.once('error', reject);
                remote.once('aborted', reject);
                remote.once('end', () => {
                  if (finished) return;
                  let content = Buffer.concat(chunks);
                  try {
                    // ASP.NET bearer challenges/forbids may deliberately have no
                    // body or Content-Type. Keep their status so clients can
                    // distinguish an invalid session from an unavailable API.
                    if (!content.length && errorResponse) {
                      result['Content-Type'] = 'application/json';
                      content = Buffer.from(
                        JSON.stringify({
                          title:
                            remote.statusCode === 401
                              ? 'invalid_credentials'
                              : remote.statusCode === 403
                                ? 'forbidden'
                                : 'unavailable',
                        }),
                      );
                    } else if (remote.statusCode !== 204) {
                      if (!jsonResponse) throw Error('Unexpected auth content type');
                      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content));
                    } else if (content.length) throw Error('Unexpected auth body');
                  } catch {
                    reject();
                    return;
                  }
                  finished = true;
                  response.writeHead(remote.statusCode ?? 503, result);
                  response.end(content);
                });
                return;
              }
              if (!privateDownload) {
                const maximumResponse = (reviewPhoto ? 2 : 8) * 1024 * 1024;
                if (Number(remote.headers['content-length']) > maximumResponse) {
                  remote.destroy();
                  problem(503);
                  return;
                }
                let received = 0;
                remote.on('data', (chunk) => {
                  received += chunk.length;
                  if (received > maximumResponse) {
                    remote.destroy();
                    response.destroy();
                  }
                });
              }
              if (
                (staffBoundary ||
                  privateParcels ||
                  privateRedirects ||
                  privatePages ||
                  privateFiles ||
                  privateCredit ||
                  privateCreditOrders) &&
                remote.headers['set-cookie']
              ) {
                remote.destroy();
                problem(503);
                return;
              }
              if (privateParcels) {
                if (
                  (remote.statusCode === 200 || remote.statusCode === 404) &&
                  remote.headers['x-sayman-fulfillment-contract'] !==
                    (privateDigital ? 'digital-v1' : 'parcels-v1')
                ) {
                  remote.destroy();
                  problem(503);
                  return;
                }
                if (
                  remote.headers['x-sayman-fulfillment-contract'] ===
                  (privateDigital ? 'digital-v1' : 'parcels-v1')
                )
                  result['X-Sayman-Fulfillment-Contract'] = privateDigital
                    ? 'digital-v1'
                    : 'parcels-v1';
              }
              if (
                (staffBoundary ||
                  privateParcels ||
                  privateRedirects ||
                  privatePages ||
                  privateCredit ||
                  privateCreditOrders) &&
                !privateDownload
              ) {
                const responseLimit =
                  privateStaff || privateCustomers
                    ? 1048576
                    : privateParcels
                      ? privateDigital
                        ? /\/commands\//.test(incoming.pathname)
                          ? 524288
                          : 16777216
                        : 4194304
                      : privateCreditOrders
                        ? 1048576
                        : 262144;
                if (
                  Number(remote.headers['content-length']) > responseLimit ||
                  (remote.statusCode === 200 &&
                    !/^application\/json(?:\s*;|$)/i.test(remote.headers['content-type'] ?? ''))
                ) {
                  remote.destroy();
                  problem(503);
                  return;
                }
                let received = 0;
                remote.on('data', (chunk) => {
                  received += chunk.length;
                  if (received > responseLimit) {
                    remote.destroy();
                    response.destroy();
                  }
                });
              }
              if (privateDownload && remote.statusCode === 200) {
                const fileId = incoming.pathname.split('/').at(-1),
                  length = Number(remote.headers['content-length']),
                  mime = remote.headers['content-type'],
                  disposition = remote.headers['content-disposition'];
                if (
                  !Number.isSafeInteger(length) ||
                  length < 16 ||
                  length > 8 * 1024 * 1024 ||
                  remote.headers['x-sayman-private-file'] !== fileId ||
                  !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(mime) ||
                  !/^attachment(?:;|$)/i.test(disposition ?? '')
                ) {
                  remote.destroy();
                  problem(503);
                  return;
                }
                result['Content-Length'] = String(length);
                result['Content-Disposition'] = disposition;
                result['X-Sayman-Private-File'] = fileId;
                result['Content-Security-Policy'] = "default-src 'none'; sandbox";
                let received = 0;
                remote.on('data', (chunk) => {
                  received += chunk.length;
                  if (received > length) {
                    remote.destroy();
                    response.destroy();
                  }
                });
                remote.once('end', () => {
                  if (received !== length) response.destroy();
                });
              }
              response.writeHead(remote.statusCode ?? 502, result);
              remote.pipe(response);
            },
          );
          proxy.setTimeout(
            incoming.pathname === '/api/admin/media/videos'
              ? 125000
              : privateParcels
                ? 45000
                : realtime
                  ? 20000
                  : upload ||
                      incoming.pathname === '/api/admin/market/import/commit' ||
                      incoming.pathname === '/api/admin/market/source-import/commit' ||
                      (request.method === 'POST' &&
                        (/^\/api\/admin\/accounting\/holoo\/imports\/[a-f0-9]{32}\/stock-commands$/.test(
                          incoming.pathname,
                        ) ||
                          /^\/api\/admin\/orders\/[a-f0-9]{32}\/shipment\/commands$/.test(
                            incoming.pathname,
                          )))
                    ? 45000
                    : 12000,
            () => proxy.destroy(),
          );
          proxy.on('error', () => {
            if (response.destroyed || response.writableEnded) return;
            if (!response.headersSent) problem(503);
            else response.destroy();
          });
          request.on('aborted', () => proxy.destroy());
          response.once('close', () => {
            if (!response.writableEnded) proxy.destroy();
          });
          proxy.end(payload);
          return;
        }
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.writeHead(405);
          response.end();
          return;
        }
        let decoded;
        try {
          decoded = decodeURIComponent(incoming.pathname);
        } catch {
          response.writeHead(400);
          response.end();
          return;
        }
        const target = path.resolve(directory, '.' + decoded);
        if (target !== directory && !target.startsWith(directory + path.sep)) {
          response.writeHead(403);
          response.end();
          return;
        }
        if (
          decoded.split('/').some((segment) => segment.startsWith('.')) ||
          decoded.endsWith('.map')
        ) {
          response.writeHead(404);
          response.end();
          return;
        }
        let filename = target;
        try {
          if (!(await stat(filename)).isFile()) throw new Error('not a file');
        } catch {
          if (path.extname(decoded)) {
            response.writeHead(404);
            response.end();
            return;
          }
          filename = path.join(directory, 'index.html');
        }
        let content = await readFile(filename);
        const styleNonce = randomBytes(24).toString('base64');
        if (path.extname(filename) === '.html')
          content = Buffer.from(
            content
              .toString('utf8')
              .replace(
                '<head>',
                '<head><meta name="sayman-style-nonce" content="' + styleNonce + '">',
              ),
          );
        const extension = path.extname(filename);
        if (!(extension in types)) {
          response.writeHead(404);
          response.end();
          return;
        }
        response.setHeader(
          'Content-Security-Policy',
          `default-src 'self'; script-src 'self'; style-src 'self' 'nonce-${styleNonce}'; style-src-attr 'unsafe-inline'; img-src 'self' data: https: blob:; media-src 'self' https:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'`,
        );
        response.setHeader('Content-Type', types[extension] ?? 'application/octet-stream');
        if (incoming.pathname.startsWith('/assets/'))
          response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        response.writeHead(200);
        response.end(request.method === 'HEAD' ? undefined : content);
      } catch {
        if (response.destroyed || response.writableEnded) return;
        if (!response.headersSent) problem(503);
        else response.destroy();
      }
    },
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8080);
  createAdminServer().listen(port, process.env.HOSTNAME ?? '127.0.0.1', () =>
    console.log(`Admin server listening on port ${port}`),
  );
}

export function adminRefreshCookieName(https) {
  return (https ? '__Host-' : '') + 'sayman_admin_refresh';
}
export function readAdminRefreshCookie(header, https) {
  const name = adminRefreshCookieName(https);
  const values = (header ?? '')
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p.startsWith(name + '='))
    .map((p) => p.slice(name.length + 1));
  if (!values.length) return undefined;
  if (values.length !== 1 || !/^[a-f\d]{64}$/i.test(values[0]))
    throw Error('Invalid or ambiguous refresh cookie');
  return values[0];
}
export function safeAdminRefreshCookie(header, https) {
  const parts = header.split(';').map((p) => p.trim()),
    match = parts[0].match(/^([^=]+)=(.*)$/);
  if (!match || parts.some((p) => /^domain\s*=/i.test(p))) return undefined;
  const [, name, value] = match,
    expected = adminRefreshCookieName(https);
  const age = parts.find((p) => /^max-age=/i.test(p))?.slice(8),
    expires = parts.find((p) => /^expires=/i.test(p))?.slice(8);
  const deletion =
    value === '' && (age === '0' || (expires !== undefined && Date.parse(expires) < Date.now()));
  if (https && name === adminRefreshCookieName(false) && deletion)
    return `${name}=; Path=/api/auth; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
  if (
    name !== expected ||
    (!deletion &&
      (!/^[a-f\d]{64}$/i.test(value) ||
        !age ||
        !/^\d+$/.test(age) ||
        Number(age) < 1 ||
        Number(age) > 604800))
  )
    return undefined;
  if (https && !parts.some((p) => /^secure$/i.test(p))) return undefined;
  return `${name}=${value}; Path=${https ? '/' : '/api/auth'}; Max-Age=${deletion ? '0' : age}; HttpOnly; SameSite=Strict${https ? '; Secure' : ''}`;
}
