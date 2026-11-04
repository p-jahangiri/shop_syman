export interface AdminPageAccess {
  permission?: string;
  requiredPermissions?: readonly string[];
  anyPermissions?: readonly string[];
}
export function canAccessAdminPage(page: AdminPageAccess, permissions: readonly string[]) {
  return (
    (!page.permission || permissions.includes(page.permission)) &&
    (!page.anyPermissions || page.anyPermissions.some((p) => permissions.includes(p))) &&
    (!page.requiredPermissions || page.requiredPermissions.every((p) => permissions.includes(p)))
  );
}
export function allowedAdminPage<T extends string>(
  requested: T,
  navigation: readonly ({ id: T } & AdminPageAccess)[],
  permissions: readonly string[],
  fallback: T,
) {
  const page = navigation.find((item) => item.id === requested);
  return page && canAccessAdminPage(page, permissions) ? requested : fallback;
}
