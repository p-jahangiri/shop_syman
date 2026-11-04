export class RmaError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 0) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
export const RMA_RESPONSE_LIMIT = 2097152,
  RMA_REQUEST_LIMIT = 32768;
export async function rmaRequest(
  fetcher: (path: string, init?: RequestInit) => Promise<Response>,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  if (
    init?.body &&
    (typeof init.body !== 'string' ||
      new TextEncoder().encode(init.body).byteLength > RMA_REQUEST_LIMIT)
  )
    throw new RmaError('invalid_rma', 400);
  const response = await fetcher(path, { ...init, cache: 'no-store' });
  if (Number(response.headers.get('Content-Length')) > RMA_RESPONSE_LIMIT) {
    await response.body?.cancel();
    throw new RmaError('rma_unavailable', 503);
  }
  const reader = response.body?.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  if (reader)
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > RMA_RESPONSE_LIMIT) {
          await reader.cancel();
          throw new RmaError('rma_unavailable', 503);
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new RmaError('rma_unavailable', response.ok ? 503 : response.status);
  }
  if (!response.ok) {
    const code = raw && typeof raw === 'object' && 'title' in raw ? raw.title : null;
    throw new RmaError(
      typeof code === 'string' && /^[a-z_]{1,100}$/.test(code) ? code : 'rma_unavailable',
      response.status,
    );
  }
  if (response.headers.get('X-Sayman-Returns-Contract') !== 'rma-v1')
    throw new RmaError('rma_unavailable', 503);
  return raw;
}
export function rmaErrorText(error: unknown, locale: 'fa' | 'en') {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
  const texts: Record<string, [string, string]> = {
    rma_active_request_conflict: [
      'برای این سفارش درخواست باز وجود دارد؛ همان درخواست را پیگیری کنید.',
      'This order already has an open request. Track that request.',
    ],
    rma_capacity_conflict: [
      'سقف درخواست‌های باز تکمیل است؛ درخواست‌های قبلی را بررسی کنید.',
      'Your open-request limit is reached. Review existing requests.',
    ],
    rma_fulfillment_or_window_conflict: [
      'تعداد قابل درخواست یا مهلت تحویل تغییر کرده است؛ اطلاعات تازه را بررسی کنید.',
      'The eligible quantity or delivery window changed. Review the latest details.',
    ],
    rma_not_found: [
      'درخواست یا رسید پیدا نشد؛ نتیجهٔ نامعلوم را ثبت‌نشده فرض نکنید.',
      'The request or receipt was not found. An unknown result does not prove no change occurred.',
    ],
    rma_policy_conflict: [
      'شرایط مرجوعی تغییر کرده است؛ شرایط تازه را بخوانید.',
      'Return conditions changed. Read the latest terms.',
    ],
  };
  return (
    texts[String(code)]?.[locale === 'fa' ? 0 : 1] ??
    (locale === 'fa'
      ? 'عملیات تأیید نشد؛ وضعیت و نسخهٔ تازه را بررسی کنید.'
      : 'The operation could not be confirmed. Review the latest state and version.')
  );
}
