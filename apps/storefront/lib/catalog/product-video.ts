export function validProductVideoUrl(value: string) {
  if (!value || value.length > 1500 || /[\s\\]/u.test(value)) return false;
  if (/^\/media\/videos\/[a-f0-9]{32}\/clip\.(mp4|webm)$/.test(value)) return true;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
      /\.(mp4|webm)$/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}
