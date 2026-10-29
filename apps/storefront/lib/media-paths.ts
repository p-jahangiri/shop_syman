const pattern = /^\/media\/catalog\/([a-f0-9]{32})\/(thumb|card|zoom)\.webp$/;
export function publicImageVariant(url: string, name: 'thumb' | 'card' | 'zoom') {
  const match = pattern.exec(url);
  return match ? `/media/catalog/${match[1]}/${name}.webp` : url;
}
export function isProcessedImage(url: string) {
  return pattern.test(url);
}
