import { z } from '../config/schema-runtime.ts';
import { creditApplicationSummarySchema } from './credit-application-contract.ts';
import {
  privateFileMetadataSchema,
  ticketFileSelectionSchema,
  type PrivateFileMetadata,
} from '../support/ticket-file-contract.ts';
const id = z
    .string()
    .regex(/^[a-f0-9]{32}$/)
    .refine((x) => !/^0+$/.test(x)),
  key = z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/),
  version = z.string().regex(/^[A-Za-z0-9+/]{10}[AEIMQUYcgkosw048]=$/),
  at = z
    .string()
    .datetime({ offset: true })
    .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/);
export const creditDocumentBodySchema = z
  .object({
    version,
    consentId: id,
    requirementsRevisionId: id,
    documentKey: key,
    replacesFileId: id.nullable(),
  })
  .strict();
export const creditDocumentCommandSchema = z
  .object({
    id,
    applicationId: id,
    body: creditDocumentBodySchema,
    file: ticketFileSelectionSchema,
  })
  .strict();
const attachmentSchema = z
  .object({
    id,
    consentId: id,
    requirementsRevisionId: id,
    documentKey: key,
    replacesFileId: id.nullable(),
    at,
    file: privateFileMetadataSchema,
  })
  .strict()
  .refine((x) => x.replacesFileId !== x.id);
const blocker = z.enum([
  'application_cancelled',
  'application_submitted',
  'application_approved',
  'application_declined',
  'credit_requirements_unavailable',
  'credit_current_consent_required',
  'private_file_unavailable',
  'credit_document_capacity',
]);
export const creditDocumentPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    application: creditApplicationSummarySchema,
    currentConsentId: id.nullable(),
    configured: z.boolean(),
    canUpload: z.boolean(),
    maxAttachments: z.literal(48),
    blockers: z.array(blocker).max(8),
    items: z
      .array(z.object({ attachment: attachmentSchema, isCurrent: z.boolean() }).strict())
      .max(48),
  })
  .strict()
  .refine((x) => {
    if (
      new Set(x.blockers).size !== x.blockers.length ||
      new Set(x.items.map((i) => i.attachment.id)).size !== x.items.length ||
      x.blockers.includes('application_cancelled') !== (x.application.state === 'Cancelled') ||
      x.blockers.includes('application_submitted') !== (x.application.state === 'Submitted') ||
      x.blockers.includes('application_approved') !== (x.application.state === 'Approved') ||
      x.blockers.includes('application_declined') !== (x.application.state === 'Declined') ||
      x.blockers.includes('private_file_unavailable') === x.configured ||
      x.blockers.includes('credit_document_capacity') !== (x.items.length === 48) ||
      (x.currentConsentId === null && !x.blockers.includes('credit_current_consent_required')) ||
      (x.canUpload && x.blockers.length > 0)
    )
      return false;
    const latest = new Set<string>();
    return x.items.every((item, n) => {
      const a = item.attachment,
        k = a.consentId + ':' + a.documentKey,
        expected = !latest.has(k) && a.consentId === x.currentConsentId;
      latest.add(k);
      if (
        item.isCurrent !== expected ||
        Date.parse(a.at) < Date.parse(x.application.createdAt) ||
        Date.parse(a.at) > Date.parse(x.application.changedAt)
      )
        return false;
      if (a.replacesFileId === null) return true;
      const prior = x.items.findIndex((p) => p.attachment.id === a.replacesFileId);
      return (
        prior > n &&
        x.items[prior].attachment.consentId === a.consentId &&
        x.items[prior].attachment.requirementsRevisionId === a.requirementsRevisionId &&
        x.items[prior].attachment.documentKey === a.documentKey
      );
    });
  });
export const creditDocumentResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    replayed: z.boolean(),
    commandId: id,
    application: creditApplicationSummarySchema,
    attachment: attachmentSchema,
  })
  .strict()
  .refine(
    (x) =>
      x.application.state === 'Draft' &&
      Date.parse(x.attachment.at) === Date.parse(x.application.changedAt),
  );
export type CreditDocumentCommand = z.infer<typeof creditDocumentCommandSchema>;
export type CreditDocumentPage = z.infer<typeof creditDocumentPageSchema>;
export type CreditDocumentResult = z.infer<typeof creditDocumentResultSchema>;
export type CreditDocumentAttachment = z.infer<typeof attachmentSchema>;
export type CreditDocumentDownload = (
  path: string,
  id: string,
  file: PrivateFileMetadata,
  signal: AbortSignal,
) => Promise<Blob>;
export function isCreditDocumentPath(value: string, method = 'GET', staff = false) {
  const prefix = staff ? '/api/admin/credit/' : '/api/credit/';
  if (!value.startsWith(prefix) || value.includes('?') || value.includes('#')) return false;
  const p = value.slice(prefix.length),
    i = '[a-f0-9]{32}';
  if (/(?:^|\/)0{32}(?:\/|$)/.test(p)) return false;
  return (
    (method === 'GET' &&
      new RegExp(
        '^applications/' +
          i +
          '/documents(?:/files/' +
          i +
          (!staff ? '|/commands/' + i : '') +
          ')?$',
      ).test(p)) ||
    (!staff &&
      method === 'POST' &&
      new RegExp('^applications/' + i + '/documents/commands/' + i + '$').test(p))
  );
}
export function creditDocumentPath(c: CreditDocumentCommand) {
  creditDocumentCommandSchema.parse(c);
  return '/api/credit/applications/' + c.applicationId + '/documents/commands/' + c.id;
}
export function creditDocumentForm(c: CreditDocumentCommand, bytes: Blob) {
  creditDocumentCommandSchema.parse(c);
  if (bytes.size !== c.file.bytes || bytes.type !== c.file.contentType)
    throw Error('Private file selection changed');
  const f = new FormData();
  for (const [k, v] of Object.entries(c.body)) f.append(k, v ?? '');
  f.append('sha256', c.file.sha256);
  f.append('file', bytes, c.file.filename);
  return f;
}
export function readCreditDocumentResult(raw: unknown, c: CreditDocumentCommand) {
  creditDocumentCommandSchema.parse(c);
  const r = creditDocumentResultSchema.parse(raw),
    a = r.attachment;
  if (
    r.commandId !== c.id ||
    r.application.id !== c.applicationId ||
    a.consentId !== c.body.consentId ||
    a.requirementsRevisionId !== c.body.requirementsRevisionId ||
    a.documentKey !== c.body.documentKey ||
    a.replacesFileId !== c.body.replacesFileId ||
    a.file.filename !== c.file.filename ||
    a.file.contentType !== c.file.contentType ||
    a.file.bytes !== c.file.bytes
  )
    throw Error('Private credit document receipt does not match the original request');
  return r;
}
export function readCreditDocuments(raw: unknown, applicationId: string, staff = false) {
  const r = creditDocumentPageSchema.parse(raw);
  if (
    r.application.id !== id.parse(applicationId) ||
    (staff && r.canUpload) ||
    (!staff && r.canUpload !== (r.blockers.length === 0))
  )
    throw Error('Wrong private credit document resource');
  return r;
}

export function isCreditDocumentTransfer(value: string, method = 'GET') {
  return (
    isCreditDocumentPath(value, method) &&
    (method === 'POST' || (method === 'GET' && /\/documents\/files\/[a-f0-9]{32}$/.test(value)))
  );
}
