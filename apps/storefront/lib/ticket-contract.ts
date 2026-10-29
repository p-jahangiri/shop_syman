import { z } from './schema-runtime.ts';
import type { TicketFileSelection } from './ticket-file-contract.ts';
const id = z
  .string()
  .regex(/^[a-f0-9]{32}$/)
  .refine((x) => !/^0+$/.test(x));
const version = z.string().regex(/^[A-Za-z0-9+/]{10}[AEIMQUYcgkosw048]=$/);
const utc = z
  .string()
  .datetime({ offset: true })
  .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/);
const sequence = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .refine((x) => /^[1-9][0-9]{0,18}$/.test(x) && BigInt(x) <= 9223372036854775807n);
const cursor = z
  .string()
  .max(180)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/)
  .nullable();
const text = (max: number, singleLine = false) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(
      (x) =>
        x === x.trim() &&
        // eslint-disable-next-line no-control-regex -- Reject forbidden control characters at the trust boundary.
        !/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(x) &&
        (!singleLine || !/[\n\t]/.test(x)) &&
        !/\p{Surrogate}/u.test(x),
    );
export const ticketStateSchema = z.enum(['Open', 'WaitingCustomer', 'Closed']);
export const ticketSummarySchema = z
  .object({
    id,
    subject: text(120, true),
    locale: z.enum(['fa', 'en']),
    state: ticketStateSchema,
    version,
    messageCount: z.number().int().min(1).max(2147483647),
    createdAt: utc,
    changedAt: utc,
  })
  .strict()
  .refine((x) => Date.parse(x.changedAt) >= Date.parse(x.createdAt));
export const ticketPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    state: ticketStateSchema.nullable(),
    items: z.array(ticketSummarySchema).max(50),
    nextCursor: cursor,
  })
  .strict()
  .refine(
    (x) =>
      new Set(x.items.map((i) => i.id)).size === x.items.length &&
      (x.nextCursor === null || x.items.length === 50) &&
      x.items.every((i) => x.state === null || i.state === x.state),
  );
export const ticketDetailSchema = z
  .object({ schemaVersion: z.literal(1), ticket: ticketSummarySchema })
  .strict();
export const ticketMessageSchema = z
  .object({
    id,
    sequence,
    author: z.enum(['customer', 'support']),
    locale: z.enum(['fa', 'en']),
    body: text(4000),
    at: utc,
  })
  .strict();
const sequenceValue = (x: string) => (/^[1-9][0-9]{0,18}$/.test(x) ? BigInt(x) : 0n);
export const ticketMessagesSchema = z
  .object({
    schemaVersion: z.literal(1),
    ticketId: id,
    items: z.array(ticketMessageSchema).max(50),
    nextCursor: cursor,
  })
  .strict()
  .refine(
    (x) =>
      new Set(x.items.map((i) => i.id)).size === x.items.length &&
      (x.nextCursor === null || x.items.length === 50) &&
      x.items.every(
        (i, n) => n === 0 || sequenceValue(i.sequence) > sequenceValue(x.items[n - 1].sequence),
      ),
  );
export const ticketResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    replayed: z.boolean(),
    commandId: id,
    ticket: ticketSummarySchema,
    messageId: id.nullable(),
  })
  .strict();
const inputText = (max: number, single = false) =>
  z
    .string()
    .max(max)
    .transform((x) => x.replace(/\r\n?/g, '\n').trim())
    .pipe(text(max, single));
export const ticketCreateSchema = z
  .object({ subject: inputText(120, true), body: inputText(4000), locale: z.enum(['fa', 'en']) })
  .strict();
export const ticketReplySchema = z
  .object({ version, body: inputText(4000), locale: z.enum(['fa', 'en']) })
  .strict();
export const ticketStateInputSchema = z
  .object({ version, state: z.enum(['Open', 'Closed']) })
  .strict();
export type TicketSummary = z.infer<typeof ticketSummarySchema>;
export type TicketPage = z.infer<typeof ticketPageSchema>;
export type TicketMessage = z.infer<typeof ticketMessageSchema>;
export type TicketMessages = z.infer<typeof ticketMessagesSchema>;
export type TicketResult = z.infer<typeof ticketResultSchema>;
export type TicketCreate = z.infer<typeof ticketCreateSchema>;
export type TicketReply = z.infer<typeof ticketReplySchema>;
export type TicketStateInput = z.infer<typeof ticketStateInputSchema>;
export type TicketCommand =
  | { id: string; kind: 'create'; staff: false; body: TicketCreate }
  | { id: string; kind: 'reply'; staff: boolean; ticketId: string; body: TicketReply }
  | { id: string; kind: 'state'; staff: boolean; ticketId: string; body: TicketStateInput }
  | {
      id: string;
      kind: 'attachment';
      staff: boolean;
      ticketId: string;
      body: TicketReply;
      file: TicketFileSelection;
    };
export function ticketCommandPath(c: TicketCommand) {
  const prefix = c.staff ? '/api/admin/support' : '/api/support';
  return c.kind === 'create'
    ? `${prefix}/tickets/commands/${c.id}`
    : c.kind === 'reply'
      ? `${prefix}/tickets/${c.ticketId}/replies/${c.id}`
      : c.kind === 'attachment'
        ? `${prefix}/tickets/${c.ticketId}/attachments/${c.id}`
        : `${prefix}/tickets/${c.ticketId}/state/${c.id}`;
}
export function readTicketResult(raw: unknown, c: TicketCommand) {
  const r = ticketResultSchema.parse(raw);
  if (
    r.commandId !== id.parse(c.id) ||
    (c.kind !== 'create' && r.ticket.id !== id.parse(c.ticketId)) ||
    r.ticket.state !== (c.kind === 'state' ? c.body.state : c.staff ? 'WaitingCustomer' : 'Open') ||
    (c.kind === 'state') !== (r.messageId === null) ||
    (c.kind === 'create' && r.ticket.subject !== c.body.subject)
  )
    throw Error('Ticket receipt does not match the frozen command.');
  return r;
}
export function readTicketPage(raw: unknown, state: string | null) {
  const r = ticketPageSchema.parse(raw);
  if (r.state !== state) throw Error('Ticket page belongs to another filter.');
  return r;
}
export function readTicketDetail(raw: unknown, ticketId: string) {
  const r = ticketDetailSchema.parse(raw);
  if (r.ticket.id !== id.parse(ticketId))
    throw Error('Ticket detail belongs to another conversation.');
  return r;
}
export function readTicketMessages(raw: unknown, ticketId: string) {
  const r = ticketMessagesSchema.parse(raw);
  if (r.ticketId !== id.parse(ticketId)) throw Error('Messages belong to another conversation.');
  return r;
}
