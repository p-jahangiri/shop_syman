const retiredPages = /^\/(?:(?:fa|en)\/)?(?:market|sourcing|phone-interests)(?:\/|$)/i;
const retiredApis =
  /^\/api\/(?:(?:market|sourcing|phones)(?:\/|$)|notifications\/phones(?:\/|$)|cart\/(?:fa|en)\/sourcing(?:\/|$))/i;

export function isRetiredSourcingPath(pathname: string) {
  try {
    const path = decodeURIComponent(pathname)
      .replace(/\\/g, '/')
      .replace(/\/{2,}/g, '/');
    return retiredPages.test(path) || retiredApis.test(path);
  } catch {
    return false;
  }
}

export function isRetiredSourcingHref(href: string) {
  try {
    return isRetiredSourcingPath(new URL(href, 'https://sayman.invalid').pathname);
  } catch {
    return false;
  }
}

export function filterRetiredSourcingMenu<T extends { href: string; children?: T[] }>(
  items: readonly T[],
): T[] {
  return items.flatMap((item) => {
    if (isRetiredSourcingHref(item.href)) return [];
    if (!item.children?.length) return [item];
    const children = filterRetiredSourcingMenu(item.children);
    return !children.length && item.href === '#' ? [] : [{ ...item, children }];
  });
}
