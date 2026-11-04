import { z } from '../config/schema-runtime.ts';
export const privateFileMaximum = 8 * 1024 * 1024;
export class PrivateFileBoundError extends Error {}
export const privateFileTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;
const id = z
  .string()
  .regex(/^[a-f0-9]{32}$/)
  .refine((x) => !/^0+$/.test(x));
export const privateFilename = z
  .string()
  .min(1)
  .max(160)
  .refine(
    (x) =>
      x === x.trim() &&
      x === x.normalize('NFC') &&
      !/[\p{Surrogate}\p{Cc}\u202a-\u202e\u2066-\u2069/\\:"<>]/u.test(x) &&
      !x.startsWith('.') &&
      !x.endsWith('.'),
  );
const extensions: Record<string, string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
};
const metadataObject = z
  .object({
    filename: privateFilename,
    contentType: z.enum(privateFileTypes),
    bytes: z.number().int().min(16).max(privateFileMaximum),
  })
  .strict();
const matchesExtension = (x: { filename: string; contentType: string }) =>
  extensions[x.contentType].includes(x.filename.split('.').at(-1)?.toLowerCase() ?? '');
export const privateFileMetadataSchema = metadataObject.refine(matchesExtension);
export const ticketFileSelectionSchema = metadataObject
  .extend({ sha256: z.string().regex(/^[A-F0-9]{64}$/) })
  .refine(matchesExtension);
export type TicketFileSelection = z.infer<typeof ticketFileSelectionSchema>;
export type PrivateFileMetadata = z.infer<typeof privateFileMetadataSchema>;
export const ticketFileCapabilitiesSchema = z
  .object({
    schemaVersion: z.literal(1),
    configured: z.boolean(),
    maxBytes: z.literal(privateFileMaximum),
    contentTypes: z.tuple([
      z.literal('image/jpeg'),
      z.literal('image/png'),
      z.literal('image/webp'),
      z.literal('application/pdf'),
    ]),
    maxPerTicket: z.literal(20),
  })
  .strict();
export type TicketFileCapabilities = z.infer<typeof ticketFileCapabilitiesSchema>;
const at = z
  .string()
  .datetime({ offset: true })
  .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/);
export const ticketAttachmentPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    ticketId: id,
    items: z
      .array(
        z
          .object({
            id,
            messageId: id,
            author: z.enum(['customer', 'support']),
            at,
            file: privateFileMetadataSchema,
          })
          .strict(),
      )
      .max(20),
  })
  .strict()
  .refine(
    (x) =>
      new Set(x.items.map((i) => i.id)).size === x.items.length &&
      new Set(x.items.map((i) => i.messageId)).size === x.items.length,
  );
export type TicketAttachments = z.infer<typeof ticketAttachmentPageSchema>;
export function readTicketAttachments(raw: unknown, ticketId: string) {
  const result = ticketAttachmentPageSchema.parse(raw);
  if (result.ticketId !== id.parse(ticketId)) throw Error('Wrong private attachment resource');
  return result;
}
export function isTicketFilePath(value: string, method = 'GET', staff = false) {
  const base = staff ? '/api/admin/support/' : '/api/support/';
  if (!value.startsWith(base) || value.includes('?') || value.includes('#')) return false;
  const path = value.slice(base.length);
  if (/(?:^|\/)0{32}(?:\/|$)/.test(path)) return false;
  return (
    (method === 'GET' &&
      (path === 'files/capabilities' ||
        /^tickets\/[a-f0-9]{32}\/attachments(?:\/[a-f0-9]{32})?$/.test(path))) ||
    (method === 'POST' && /^tickets\/[a-f0-9]{32}\/attachments\/[a-f0-9]{32}$/.test(path))
  );
}
export function isTicketFileUpload(path: string, method: string, staff = false) {
  return method === 'POST' && isTicketFilePath(path, method, staff);
}
export function privateFileSignature(bytes: Uint8Array, type: string) {
  const prefix = (part: number[]) => part.every((v, n) => bytes[n] === v);
  if (bytes.length < 16 || bytes.length > privateFileMaximum) return false;
  return type === 'image/jpeg'
    ? prefix([255, 216, 255]) && bytes.at(-2) === 255 && bytes.at(-1) === 217
    : type === 'image/png'
      ? prefix([137, 80, 78, 71, 13, 10, 26, 10])
      : type === 'image/webp'
        ? prefix([82, 73, 70, 70]) && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
        : type === 'application/pdf'
          ? prefix([37, 80, 68, 70, 45]) &&
            new TextDecoder().decode(bytes.slice(-1024)).includes('%%EOF')
          : false;
}
export async function selectedTicketFile(
  file: File,
): Promise<{ metadata: TicketFileSelection; blob: Blob }> {
  const base = privateFileMetadataSchema.parse({
    filename: file.name,
    contentType: file.type,
    bytes: file.size,
  });
  const bytes = await file.arrayBuffer();
  if (
    bytes.byteLength !== base.bytes ||
    !privateFileSignature(new Uint8Array(bytes), base.contentType)
  )
    throw Error('Unsupported private file');
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  )
    .join('')
    .toUpperCase();
  return {
    metadata: ticketFileSelectionSchema.parse({ ...base, sha256 }),
    blob: file.slice(0, file.size, file.type),
  };
}
export async function boundedPrivateBytes(
  stream: ReadableStream<Uint8Array> | null,
  maximum: number,
  signal?: AbortSignal,
) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader(),
    parts: Uint8Array[] = [];
  let size = 0;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    if (signal?.aborted) throw Error('Private input closed');
    while (true) {
      const part = await reader.read();
      if (signal?.aborted) throw Error('Private input closed');
      if (part.done) break;
      size += part.value.length;
      if (size > maximum) {
        await reader.cancel();
        throw new PrivateFileBoundError('Private document size bound');
      }
      parts.push(part.value);
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}
export async function readPrivateFileDownload(
  response: Response,
  fileId: string,
  expected: PrivateFileMetadata,
) {
  privateFileMetadataSchema.parse(expected);
  id.parse(fileId);
  if (
    response.status !== 200 ||
    response.headers.get('X-Sayman-Private-File') !== fileId ||
    response.headers.get('Content-Type') !== expected.contentType ||
    !/^attachment(?:;|$)/i.test(response.headers.get('Content-Disposition') ?? '') ||
    !response.headers.get('Cache-Control')?.includes('no-store') ||
    !response.headers.get('X-Robots-Tag')?.includes('noindex')
  ) {
    await response.body?.cancel();
    throw Error('Private download unavailable');
  }
  const bytes = await boundedPrivateBytes(response.body, expected.bytes);
  if (bytes.length !== expected.bytes || !privateFileSignature(bytes, expected.contentType))
    throw Error('Private download is incomplete');
  return new Blob([bytes.buffer], { type: expected.contentType });
}
