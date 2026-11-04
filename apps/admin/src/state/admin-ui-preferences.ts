export type AdminColorMode = 'light' | 'dark';

const themeKey = 'sayman.admin.color-mode.v1';
const navigationKey = 'sayman.admin.navigation-compact.v1';

export const adminDashboardWidgets = [
  'tickets',
  'inventory',
  'cheques',
  'orders',
  'traffic',
  'shortcuts',
] as const;
export const adminStockLimits = [1, 3, 5, 10] as const;
export const adminDashboardShortcuts = [
  'orders',
  'products',
  'inventory',
  'returns',
  'tickets',
  'receiving',
  'credit-schedules',
  'payments',
  'customers',
  'content',
] as const;
export type AdminDashboardWidget = (typeof adminDashboardWidgets)[number];
export type AdminDashboardShortcut = (typeof adminDashboardShortcuts)[number];
export type AdminDashboardPreferences = {
  order: AdminDashboardWidget[];
  hidden: AdminDashboardWidget[];
  shortcuts: AdminDashboardShortcut[];
  stockLimit: number;
};

const defaultShortcuts: AdminDashboardShortcut[] = [
  'orders',
  'products',
  'inventory',
  'tickets',
  'credit-schedules',
];

export function defaultAdminDashboardPreferences(): AdminDashboardPreferences {
  return {
    order: [...adminDashboardWidgets],
    hidden: [],
    shortcuts: [...defaultShortcuts],
    stockLimit: 3,
  };
}

function read(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The current view still works if storage is blocked or full.
  }
}

export function readAdminColorMode(): AdminColorMode {
  return read(themeKey) === 'dark' ? 'dark' : 'light';
}

export function writeAdminColorMode(value: AdminColorMode) {
  write(themeKey, value);
}

export function readCompactNavigation() {
  return read(navigationKey) === 'true';
}

export function writeCompactNavigation(value: boolean) {
  write(navigationKey, String(value));
}

function knownUnique<T extends string>(
  raw: unknown,
  options: readonly T[],
  fallback: readonly T[],
) {
  if (!Array.isArray(raw)) return [...fallback];
  const known = new Set<unknown>(options);
  return [
    ...new Set(raw.slice(0, options.length * 2).filter((item): item is T => known.has(item))),
  ];
}

export function parseAdminDashboardPreferences(raw: string | null): AdminDashboardPreferences {
  const fallback = defaultAdminDashboardPreferences();
  if (!raw || raw.length > 4096) return fallback;
  try {
    const value = JSON.parse(raw) as Partial<AdminDashboardPreferences> | null;
    const order = knownUnique(value?.order, adminDashboardWidgets, fallback.order);
    return {
      order: [...order, ...adminDashboardWidgets.filter((item) => !order.includes(item))],
      hidden: knownUnique(value?.hidden, adminDashboardWidgets, fallback.hidden),
      shortcuts: knownUnique(value?.shortcuts, adminDashboardShortcuts, fallback.shortcuts),
      stockLimit:
        adminStockLimits.find((limit) => limit === value?.stockLimit) ?? fallback.stockLimit,
    };
  } catch {
    return fallback;
  }
}

export function readAdminDashboardPreferences(accountId: string) {
  return parseAdminDashboardPreferences(read('sayman.admin.dashboard.v1.' + accountId));
}

export function writeAdminDashboardPreferences(
  accountId: string,
  prefs: AdminDashboardPreferences,
) {
  write('sayman.admin.dashboard.v1.' + accountId, JSON.stringify(prefs));
}

export function moveAdminPreference<T extends string>(
  order: readonly T[],
  item: T,
  direction: -1 | 1,
) {
  const from = order.indexOf(item);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= order.length) return [...order];
  const next = [...order];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
