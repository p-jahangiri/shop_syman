export function isCustomerTicketPath(value: string, method = 'GET') {
  if (!value.startsWith('/api/support/')) return false;
  const url = new URL(value, 'http://localhost');
  if (url.origin !== 'http://localhost' || url.hash || url.pathname !== value.split('?')[0])
    return false;
  const id = '[a-f0-9]{32}',
    path = url.pathname.slice('/api/support/'.length);
  let allowed: string[] = [];
  if (method === 'GET') {
    if (path === 'tickets') allowed = ['state', 'cursor'];
    else if (new RegExp(`^tickets/${id}/messages$`).test(path)) allowed = ['cursor'];
    else if (!new RegExp(`^(tickets|commands)/${id}$`).test(path)) return false;
  } else if (
    url.search ||
    !(
      (method === 'POST' &&
        new RegExp(
          `^(tickets/commands/${id}|tickets/${id}/replies/${id}|product-questions/(fa|en)/[A-Za-z0-9_-]{1,64}/${id}/replies/${id})$`,
        ).test(path)) ||
      (method === 'PUT' && new RegExp(`^tickets/${id}/state/${id}$`).test(path))
    )
  )
    return false;
  const keys = [...url.searchParams.keys()];
  if (new Set(keys).size !== keys.length || keys.some((k) => !allowed.includes(k))) return false;
  for (const [k, v] of url.searchParams)
    if (
      k === 'state'
        ? !['Open', 'WaitingCustomer', 'Closed'].includes(v)
        : v.length < 1 || v.length > 180 || !/^[A-Za-z0-9+/]+={0,2}$/.test(v)
    )
      return false;
  return !/(?:^|\/)0{32}(?:\/|$)/.test(path);
}
