export function readAdminFieldErrors(raw: unknown): Record<string, string[]> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const entries = Object.entries(raw);
  if (
    !entries.length ||
    entries.length > 1000 ||
    entries.some(
      ([path, messages]) =>
        !/^[A-Za-z0-9_.-]{1,200}$/.test(path) ||
        !Array.isArray(messages) ||
        messages.length < 1 ||
        messages.length > 3 ||
        messages.some((message) => typeof message !== 'string' || message.length > 500),
    )
  )
    return undefined;
  return Object.fromEntries(entries.map(([path, messages]) => [path, [...(messages as string[])]]));
}
export function productErrorPaths(
  raw: Record<string, string[]> | undefined,
  variantKeys: string[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [path, messages] of Object.entries(raw ?? {})) {
    const match = /^variants\.(\d+)\.(.+)$/.exec(path);
    if (match) {
      const key = variantKeys[Number(match[1])];
      if (key) result['variants.' + key + '.' + match[2]] = messages[0];
    } else result[path] = messages[0];
  }
  return result;
}
