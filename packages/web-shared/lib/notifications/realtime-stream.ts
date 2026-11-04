export async function boundedRealtimeBody(
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
) {
  if (!stream) return '';
  const parts: Uint8Array[] = [];
  const reader = stream.getReader();
  let size = 0;
  try {
    while (true) {
      const value = await reader.read();
      if (value.done) break;
      size += value.value.length;
      if (size > limit) {
        await reader.cancel();
        throw Error('Private realtime capacity');
      }
      parts.push(value.value);
    }
  } finally {
    reader.releaseLock();
  }
  const raw = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    raw.set(part, at);
    at += part.length;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(raw);
}
