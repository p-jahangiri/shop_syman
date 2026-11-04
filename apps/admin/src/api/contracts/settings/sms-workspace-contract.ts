import { z } from 'zod';

export const smsEvents = [
  'otp',
  'orderCreated',
  'orderPaid',
  'orderShipped',
  'orderCancelled',
  'creditApproved',
  'orderDigitalReady',
  'chequeReminder',
] as const;
export type SmsEvent = (typeof smsEvents)[number];
export const smsEventLabels: Record<SmsEvent, string> = {
  otp: 'کد ورود مشتری',
  orderCreated: 'ثبت سفارش',
  orderPaid: 'تأیید پرداخت نقدی',
  orderShipped: 'ارسال مرسوله',
  orderCancelled: 'لغو یا انقضای سفارش',
  creditApproved: 'تأیید مالی خرید چکی',
  orderDigitalReady: 'آماده‌شدن تحویل دیجیتال',
  chequeReminder: 'یادآوری چک',
};
export const smsSources = [
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
] as const;
export const smsSourceLabels: Record<string, string> = {
  code: 'کد یک‌بارمصرف',
  genericName: 'نام عمومی',
  expiryMinutes: 'اعتبار کد به دقیقه',
  customerName: 'نام کوتاه مشتری',
  orderNumber: 'شماره سفارش',
  orderStatus: 'وضعیت سفارش',
  amountRial: 'مبلغ به ریال',
  dueDate: 'سررسید چک',
  trackingCode: 'کد رهگیری مرسوله',
  constant: 'مقدار ثابت',
};
const id = z.string().regex(/^(?!0{32}$)[a-f0-9]{32}$/);
const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(
      (v) =>
        v === v.trim() && !/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(v.replaceAll('\u200c', '')),
    );
const version = z
  .string()
  .regex(/^[A-Za-z0-9+/]{10}[AEIMQUYcgkosw048]=$/)
  .nullable();
const parameter = z
  .object({
    name: z.string().regex(/^[A-Za-z0-9_]{1,50}$/),
    source: z.enum(smsSources),
    constant: z.string().max(100).nullable(),
  })
  .strict();
const template = z
  .object({
    id,
    name: text(100),
    kind: z.enum(smsEvents),
    connectionId: id,
    providerTemplate: text(100),
    approved: z.boolean(),
    previewText: z.string().max(2000),
    parameters: z.array(parameter).min(1).max(10),
  })
  .strict();
const connection = z
  .object({
    id,
    name: text(100),
    provider: z.enum(['smsIr', 'kavenegar']),
    mode: z.enum(['live', 'sandbox']),
    enabled: z.boolean(),
    keyConfigured: z.boolean(),
  })
  .strict();
const policy = z
  .object({
    lifetimeSeconds: z.number().int().min(60).max(600),
    resendSeconds: z.number().int().min(30).max(300),
    maxAttempts: z.number().int().min(1).max(10),
    phoneHourlyLimit: z.number().int().min(1).max(20),
    phoneDailyLimit: z.number().int().min(1).max(100),
    globalHourlyLimit: z.number().int().min(1).max(10000),
    globalDailyLimit: z.number().int().min(1).max(100000),
    notificationHourlyLimit: z.number().int().min(1).max(10000),
    notificationDailyLimit: z.number().int().min(1).max(100000),
    genericName: text(25),
  })
  .strict()
  .refine(
    (p) =>
      p.resendSeconds < p.lifetimeSeconds &&
      p.phoneDailyLimit >= p.phoneHourlyLimit &&
      p.globalHourlyLimit >= p.phoneHourlyLimit &&
      p.globalDailyLimit >= Math.max(p.globalHourlyLimit, p.phoneDailyLimit) &&
      p.notificationDailyLimit >= p.notificationHourlyLimit,
  );
const route = z
  .object({
    event: z.enum(smsEvents),
    enabled: z.boolean(),
    templateId: id.nullable(),
    enabledSince: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();
export const smsWorkspaceSchema = z
  .object({
    schemaVersion: z.literal(1),
    version,
    otp: policy,
    connections: z.array(connection).max(10),
    templates: z.array(template).max(30),
    routes: z.array(route).length(smsEvents.length),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      new Set(v.connections.map((x) => x.id)).size !== v.connections.length ||
      new Set(v.templates.map((x) => x.id)).size !== v.templates.length ||
      new Set(v.routes.map((x) => x.event)).size !== smsEvents.length ||
      v.templates.some((t) => !v.connections.some((c) => c.id === t.connectionId)) ||
      v.routes.some(
        (r) =>
          (r.enabled && !r.templateId) ||
          (r.templateId && !v.templates.some((t) => t.id === r.templateId && t.kind === r.event)),
      )
    )
      ctx.addIssue({ code: 'custom', message: 'ساختار تنظیمات پیامک معتبر نیست.' });
  });
export type SmsWorkspace = z.infer<typeof smsWorkspaceSchema>;
export type SmsTemplate = SmsWorkspace['templates'][number];
export type SmsConnection = SmsWorkspace['connections'][number];
export type SmsKeyAction = 'keep' | 'replace' | 'clear';
export function readSmsWorkspace(raw: unknown): SmsWorkspace {
  const value = smsWorkspaceSchema.parse(raw);
  if (value.routes.some((r) => r.enabled && !r.enabledSince))
    throw new Error('زمان فعال‌سازی مسیر معتبر نیست.');
  return value;
}
export function smsAllowedSources(kind: SmsEvent) {
  return smsSources.filter((s) =>
    kind === 'otp'
      ? ['code', 'genericName', 'expiryMinutes', 'constant'].includes(s)
      : !['code', 'expiryMinutes'].includes(s) &&
        (s !== 'dueDate' || kind === 'chequeReminder') &&
        (s !== 'trackingCode' || kind === 'orderShipped') &&
        (s !== 'orderStatus' || kind !== 'chequeReminder'),
  );
}
export function smsSamplePreview(t: SmsTemplate, genericName: string, lifetime: number) {
  const samples: Record<string, string> = {
    code: '123456',
    genericName,
    expiryMinutes: String(Number((lifetime / 60).toFixed(2))),
    customerName: 'مشتری سایمان',
    orderNumber: 'SM-1000',
    orderStatus: 'آزمایشی',
    amountRial: '1000000',
    dueDate: '1405/08/10',
    trackingCode: '1234567890',
  };
  return t.previewText.replace(
    /#([A-Za-z0-9_]{1,50})#|%(token20|token10|token3|token2|token)\b/g,
    (marker: string, hashName: string | undefined, tokenName: string | undefined) => {
      const p = t.parameters.find((value) => value.name === (hashName ?? tokenName));
      return p
        ? p.source === 'constant'
          ? (p.constant ?? '')
          : (samples[p.source] ?? '—')
        : marker;
    },
  );
}
export function smsWorkspaceCommand(
  draft: SmsWorkspace,
  requestId: string,
  actions: Record<string, SmsKeyAction>,
  secrets: Record<string, string>,
) {
  smsWorkspaceSchema.parse(draft);
  id.parse(requestId);
  return {
    version: draft.version,
    requestId,
    otp: draft.otp,
    connections: draft.connections.map(({ keyConfigured: _configured, ...c }) => {
      const keyAction = actions[c.id] ?? 'keep';
      if (keyAction === 'replace' && !/^[!-~]{1,512}$/.test(secrets[c.id] ?? ''))
        throw new Error('کلید تازه را بدون فاصله وارد کنید.');
      return { ...c, keyAction, ...(keyAction === 'replace' ? { apiKey: secrets[c.id] } : {}) };
    }),
    templates: draft.templates,
    routes: draft.routes.map(({ enabledSince: _since, ...r }) => r),
  };
}
export type SmsWorkspaceCommand = ReturnType<typeof smsWorkspaceCommand>;
export function readSmsWorkspaceReceipt(
  raw: unknown,
  command: SmsWorkspaceCommand,
  previous: SmsWorkspace,
) {
  const value = readSmsWorkspace(raw);
  const sort = <T extends { id: string }>(items: T[]) =>
    [...items].sort((a, b) => a.id.localeCompare(b.id));
  const expected = command.connections.map(({ keyAction, apiKey: _key, ...c }) => ({
    ...c,
    keyConfigured:
      keyAction === 'replace' ||
      (keyAction === 'keep' && previous.connections.some((x) => x.id === c.id && x.keyConfigured)),
  }));
  if (
    value.version === null ||
    value.version === previous.version ||
    JSON.stringify(value.otp) !== JSON.stringify(command.otp) ||
    JSON.stringify(sort(value.connections)) !== JSON.stringify(sort(expected)) ||
    JSON.stringify(
      sort(value.templates).map((t) => ({
        ...t,
        parameters: [...t.parameters].sort((a, b) => a.name.localeCompare(b.name)),
      })),
    ) !==
      JSON.stringify(
        sort(command.templates).map((t) => ({
          ...t,
          parameters: [...t.parameters].sort((a, b) => a.name.localeCompare(b.name)),
        })),
      ) ||
    command.routes.some(
      (r) =>
        !value.routes.some(
          (v) => v.event === r.event && v.enabled === r.enabled && v.templateId === r.templateId,
        ),
    )
  )
    throw new Error('رسید ذخیره با درخواست مطابقت ندارد؛ تنظیمات جاری را بازخوانی کنید.');
  return value;
}
export const smsMessageSchema = z
  .object({
    id,
    sequence: z.string().regex(/^[1-9][0-9]{0,18}$/),
    kind: z.enum([...smsEvents, 'test']),
    state: z.enum(['queued', 'dispatching', 'accepted', 'rejected', 'unknown', 'skipped']),
    connectionName: text(100).nullish(),
    provider: z.enum(['smsIr', 'kavenegar']).nullish(),
    templateName: text(100).nullish(),
    createdAt: z.iso.datetime({ offset: true }),
    attemptedAt: z.iso.datetime({ offset: true }).nullish(),
    completedAt: z.iso.datetime({ offset: true }).nullish(),
    reason: z.string().max(40).nullish(),
    providerMessageId: z
      .string()
      .regex(/^[1-9][0-9]{0,18}$/)
      .nullish(),
  })
  .strict();
export const smsMessagesSchema = z
  .object({
    schemaVersion: z.literal(1),
    items: z.array(smsMessageSchema).max(50),
    nextCursor: z
      .string()
      .regex(/^[1-9][0-9]{0,18}$/)
      .nullish(),
  })
  .strict();
