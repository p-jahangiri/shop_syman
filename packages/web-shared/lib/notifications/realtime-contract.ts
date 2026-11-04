import { z } from '../config/schema-runtime.ts';
export const realtimePulseSchema = z
  .object({ schemaVersion: z.literal(1), scope: z.enum(['support', 'notifications']) })
  .strict();
export type RealtimeScope = z.infer<typeof realtimePulseSchema>['scope'];
const key = z
  .string()
  .min(16)
  .max(4096)
  .regex(/^[A-Za-z0-9_-]+$/);
export const realtimeNegotiationSchema = z
  .object({
    negotiateVersion: z.literal(1),
    connectionId: z
      .string()
      .min(16)
      .max(256)
      .regex(/^[A-Za-z0-9_-]+$/),
    connectionToken: key,
    availableTransports: z.tuple([
      z
        .object({
          transport: z.literal('LongPolling'),
          transferFormats: z
            .array(z.enum(['Text', 'Binary']))
            .min(1)
            .max(2)
            .refine((x) => x.includes('Text') && new Set(x).size === x.length),
        })
        .strict(),
    ]),
  })
  .strict();
export function isPrivateRealtimePath(value: string, method = 'GET', staff = false) {
  const base = staff ? '/api/admin/realtime' : '/api/realtime';
  let url: URL;
  try {
    url = new URL(value, 'http://localhost');
  } catch {
    return false;
  }
  if (url.origin !== 'http://localhost' || url.hash || url.pathname !== value.split('?')[0])
    return false;
  const params = url.searchParams,
    keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) return false;
  if (url.pathname === base + '/negotiate')
    return (
      method === 'POST' &&
      keys.length === 1 &&
      keys[0] === 'negotiateVersion' &&
      params.get('negotiateVersion') === '1'
    );
  if (
    url.pathname !== base ||
    !['GET', 'POST', 'DELETE'].includes(method) ||
    !key.safeParse(params.get('id')).success ||
    keys.some(
      (k) =>
        k !== 'id' && (k !== '_' || method !== 'GET' || !/^\d{1,20}$/.test(params.get(k) ?? '')),
    )
  )
    return false;
  return true;
}
export function validRealtimeClientFrames(text: string) {
  try {
    const parts = text.split('\x1e');
    if (parts.length < 2 || parts.length > 17 || parts.at(-1) !== '') return false;
    return parts.slice(0, -1).every((part) => {
      const value = JSON.parse(part);
      return (
        z
          .object({ protocol: z.literal('json'), version: z.literal(1) })
          .strict()
          .safeParse(value).success ||
        z
          .object({ type: z.union([z.literal(6), z.literal(7)]) })
          .strict()
          .safeParse(value).success
      );
    });
  } catch {
    return false;
  }
}
export function validRealtimeServerFrames(text: string) {
  if (text === '') return true;
  try {
    const parts = text.split('\x1e');
    if (parts.length < 2 || parts.at(-1) !== '') return false;
    return parts.slice(0, -1).every((part) => {
      const value = JSON.parse(part);
      return (
        z.object({}).strict().safeParse(value).success ||
        z
          .object({ type: z.literal(6) })
          .strict()
          .safeParse(value).success ||
        z
          .object({
            type: z.literal(7),
            error: z.string().max(200).optional(),
            allowReconnect: z.boolean().optional(),
          })
          .strict()
          .safeParse(value).success ||
        z
          .object({
            type: z.literal(1),
            target: z.literal('Changed'),
            arguments: z.tuple([realtimePulseSchema]),
          })
          .strict()
          .safeParse(value).success
      );
    });
  } catch {
    return false;
  }
}
