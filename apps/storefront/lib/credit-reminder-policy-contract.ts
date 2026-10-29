import { z } from './schema-runtime.ts';
import { notificationTicks } from './notification-contract.ts';
import { reviewHoldVersionSchema as version } from './cheque-review-hold-contract.ts';
const id = z
    .string()
    .regex(/^[a-f0-9]{32}$/)
    .refine((v) => !/^0+$/.test(v)),
  at = z
    .string()
    .datetime({ offset: true })
    .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/),
  time = z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/),
  offsets = z
    .array(z.number().int().min(-365).max(365))
    .max(31)
    .refine((x) => x.every((v, i) => i === 0 || x[i - 1] < v)),
  note = z
    .string()
    .min(1)
    .max(500)
    // eslint-disable-next-line no-control-regex -- Reject forbidden control characters at the trust boundary.
    .refine((v) => v === v.trim() && !/[\u0000-\u001f\u007f-\u009f\uD800-\uDFFF]/.test(v));
const valid = (x: { enabled: boolean; dayOffsets: number[]; sendAt: string | null }) =>
  x.enabled
    ? x.dayOffsets.length > 0 && x.sendAt !== null
    : x.dayOffsets.length === 0 && x.sendAt === null;
export const creditReminderPolicyBodySchema = z
  .strictObject({
    version: version.nullable(),
    enabled: z.boolean(),
    dayOffsets: offsets,
    sendAt: time.nullable(),
    note,
    confirmed: z.literal(true),
  })
  .refine(valid);
export const creditReminderPolicyRevisionSchema = z
  .strictObject({
    id,
    revision: z.number().int().min(1).max(10000),
    version,
    enabled: z.boolean(),
    dayOffsets: offsets,
    sendAt: time.nullable(),
    note,
    at,
  })
  .refine(valid);
export const creditReminderPolicyCurrentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  current: creditReminderPolicyRevisionSchema.nullable(),
  timeZone: z.literal('Asia/Tehran'),
  channel: z.literal('PrivateAccountInbox'),
  workerEnabled: z.boolean(),
});
export const creditReminderPolicyResultSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    commandId: id,
    replayed: z.boolean(),
    policy: creditReminderPolicyCurrentSchema,
  })
  .refine((x) => x.policy.current !== null);
export const creditReminderPolicyHistorySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    items: z.array(creditReminderPolicyRevisionSchema).max(20),
    nextBefore: z.number().int().min(1).max(10000).nullable(),
  })
  .refine(
    (x) =>
      x.items.every((r, i) => i === 0 || r.revision === x.items[i - 1].revision - 1) &&
      new Set(x.items.map((r) => r.id)).size === x.items.length &&
      (x.nextBefore === null || (x.items.length === 20 && x.nextBefore === x.items[19].revision)),
  );
export const creditReminderPolicyCommandSchema = z
  .strictObject({
    id,
    body: creditReminderPolicyBodySchema,
    previous: creditReminderPolicyCurrentSchema,
  })
  .refine(
    (x) =>
      x.body.version === (x.previous.current?.version ?? null) &&
      (x.previous.current?.revision ?? 0) < 10000,
  );
export type CreditReminderPolicyCommand = z.infer<typeof creditReminderPolicyCommandSchema>;
export type CreditReminderPolicyResult = z.infer<typeof creditReminderPolicyResultSchema>;
export type CreditReminderPolicyBody = z.infer<typeof creditReminderPolicyBodySchema>;
export const creditReminderPolicyCommandPath = (c: CreditReminderPolicyCommand) =>
  '/admin/credit/reminder-policy/commands/' + creditReminderPolicyCommandSchema.parse(c).id;
export function readCreditReminderPolicyResult(raw: unknown, command: CreditReminderPolicyCommand) {
  const c = creditReminderPolicyCommandSchema.parse(command),
    r = creditReminderPolicyResultSchema.parse(raw),
    p = r.policy.current!;
  if (
    r.commandId !== c.id ||
    p.enabled !== c.body.enabled ||
    p.sendAt !== c.body.sendAt ||
    p.note !== c.body.note ||
    JSON.stringify(p.dayOffsets) !== JSON.stringify(c.body.dayOffsets) ||
    p.revision !== (c.previous.current?.revision ?? 0) + 1 ||
    p.version === c.body.version ||
    (c.previous.current && notificationTicks(p.at) < notificationTicks(c.previous.current.at))
  )
    throw Error('Unrelated reminder policy receipt');
  return r;
}
export function parseCreditReminderOffsets(raw: string) {
  const text = raw
    .normalize('NFKC')
    .replace(/[۰-۹٠-٩]/g, (c) =>
      String('۰۱۲۳۴۵۶۷۸۹'.includes(c) ? '۰۱۲۳۴۵۶۷۸۹'.indexOf(c) : '٠١٢٣٤٥٦٧٨٩'.indexOf(c)),
    )
    .replaceAll('−', '-')
    .replaceAll('،', ',');
  const parts = text.split(',').map((x) => x.trim());
  if (!parts.length || parts.some((x) => !/^(?:0|-?[1-9][0-9]{0,2})$/.test(x)))
    throw Error('Choose explicit day offsets');
  return offsets.parse(parts.map(Number).sort((a, b) => a - b));
}
