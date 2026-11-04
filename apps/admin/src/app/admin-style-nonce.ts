/** Share the response-bound CSP nonce with Emotion and DataGrid's own styles. */
export function adminStyleNonce(
  source: Document | undefined = typeof document === 'undefined' ? undefined : document,
): string | undefined {
  return source?.querySelector<HTMLMetaElement>('meta[name="sayman-style-nonce"]')?.content;
}
