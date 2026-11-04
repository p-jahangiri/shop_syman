export function isCreditRequirementsPath(value: string, method = 'GET', staff = false) {
  const prefix = staff ? '/api/admin/credit/' : '/api/credit/';
  if (!value.startsWith(prefix)) return false;
  let url: URL;
  try {
    url = new URL(value, 'http://localhost');
  } catch {
    return false;
  }
  if (url.origin !== 'http://localhost' || url.hash || url.pathname !== value.split('?')[0])
    return false;
  const path = url.pathname.slice(prefix.length),
    id = '[a-f0-9]{32}';
  let history = false;
  if (staff) {
    history = path === 'requirements/history';
    if (method === 'GET') {
      if (
        path !== 'requirements' &&
        !history &&
        !new RegExp('^requirements/(?:revisions|commands)/' + id + '$').test(path) &&
        !new RegExp('^applications/' + id + '/requirements$').test(path)
      )
        return false;
    } else if (method !== 'POST' || !new RegExp('^requirements/commands/' + id + '$').test(path))
      return false;
  } else if (method === 'GET') {
    if (
      path !== 'requirements' &&
      !new RegExp('^applications/' + id + '/(?:requirements|consents/' + id + ')$').test(path)
    )
      return false;
  } else if (
    method !== 'POST' ||
    !new RegExp('^applications/' + id + '/consents/' + id + '$').test(path)
  )
    return false;
  if (/(?:^|\/)0{32}(?:\/|$)/.test(path)) return false;
  const entries = [...url.searchParams];
  return (
    entries.length === 0 ||
    (method === 'GET' &&
      staff &&
      history &&
      entries.length === 1 &&
      entries[0][0] === 'cursor' &&
      entries[0][1].length <= 180 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(entries[0][1]))
  );
}
