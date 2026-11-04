import { z } from 'zod';
export const staffId = z.string().regex(/^[A-Za-z0-9_-]{1,450}$/);
const roleId = z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,79}$/);
const version = z.string().min(1).max(100);
const cursor = z.string().regex(/^[A-Za-z0-9_-]{1,2048}$/);
const roles = z
  .array(roleId)
  .min(1)
  .max(30)
  .refine((v) => new Set(v).size === v.length);
export const staffRowSchema = z
  .object({
    id: staffId,
    userName: z.string().max(256),
    displayName: z.string().max(200),
    isActive: z.boolean(),
    twoFactorEnabled: z.boolean(),
    mfaRecoveryPending: z.boolean(),
    provisionedByAdministrator: z.boolean().optional(),
    requiresPasswordChange: z.boolean().optional(),
    createdAt: z.iso.datetime({ offset: true }),
    version,
    roles,
  })
  .strict();
export type StaffRow = z.infer<typeof staffRowSchema>;
export const staffRoleCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    roles: z
      .array(
        z
          .object({
            id: roleId,
            nameFa: z.string().min(1).max(200),
            nameEn: z.string().min(1).max(200),
            permissions: z
              .array(z.string().regex(/^[a-z][a-z0-9.-]{1,79}$/))
              .max(100)
              .refine((v) => new Set(v).size === v.length),
          })
          .strict(),
      )
      .min(1)
      .max(30)
      .refine((v) => new Set(v.map((r) => r.id)).size === v.length),
  })
  .strict();
export type StaffRole = z.infer<typeof staffRoleCatalogSchema>['roles'][number];
export const staffPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    pageSize: z.literal(50),
    items: z.array(staffRowSchema).max(50),
    nextCursor: cursor.nullable(),
  })
  .strict()
  .refine(
    (v) =>
      (!v.nextCursor || v.items.length === 50) &&
      new Set(v.items.map((r) => r.id.toLowerCase())).size === v.items.length,
  );
export const staffDetailSchema = z
  .object({ schemaVersion: z.literal(1), staff: staffRowSchema })
  .strict();
export const staffCandidateSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: staffId,
    userName: z.string().max(256),
    displayName: z.string().max(200),
    isActive: z.boolean(),
    contactVerified: z.boolean(),
    hasPassword: z.boolean(),
    alreadyStaff: z.boolean(),
    mfaRecoveryPending: z.boolean(),
    version,
  })
  .strict();
export type StaffCandidate = z.infer<typeof staffCandidateSchema>;
export const staffFiltersSchema = z
  .object({
    query: z.string().trim().max(120),
    active: z.enum(['all', 'true', 'false']),
    role: z.union([z.literal('all'), roleId]),
  })
  .strict()
  .refine(
    (v) =>
      v.query
        .replace(/\u200c/g, ' ')
        .split(/\s+/)
        .filter(Boolean).length <= 8,
  );
export type StaffFilters = z.infer<typeof staffFiltersSchema>;
export const emptyStaffFilters: StaffFilters = { query: '', active: 'all', role: 'all' };
export function staffPath(filters: StaffFilters, page: string | null) {
  const value = staffFiltersSchema.parse(filters);
  const params = new URLSearchParams({
    query: value.query,
    active: value.active,
    role: value.role,
  });
  if (page) params.set('cursor', cursor.parse(page));
  return '/admin/staff?' + params;
}
export function readStaffPage(raw: unknown, filters: StaffFilters) {
  const parsed = staffPageSchema.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.items.some(
      (r) =>
        (filters.active !== 'all' && r.isActive !== (filters.active === 'true')) ||
        (filters.role !== 'all' && !r.roles.includes(filters.role)),
    )
  )
    throw new Error('پاسخ فهرست کارکنان معتبر نیست؛ دوباره دریافت کنید.');
  return parsed.data;
}
export function readStaffDetail(raw: unknown, expectedId: string) {
  const parsed = staffDetailSchema.safeParse(raw);
  if (!parsed.success || parsed.data.staff.id.toLowerCase() !== expectedId.toLowerCase())
    throw new Error('اطلاعات کارمند معتبر نیست؛ تغییر دسترسی باز نشد.');
  return parsed.data.staff;
}
const validEventId = (value: string) =>
  /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
export const staffHistorySchema = z
  .object({
    schemaVersion: z.literal(1),
    pageSize: z.literal(50),
    items: z
      .array(
        z
          .object({
            id: z.string().refine(validEventId),
            action: z.string().regex(/^STAFF_[A-Z_]+(?::[A-Za-z][A-Za-z0-9]{0,79})?$/),
            actorId: staffId,
            actorName: z.string().max(450),
            at: z.iso.datetime({ offset: true }),
            traceId: z.string().max(100),
          })
          .strict(),
      )
      .max(50),
    nextCursor: cursor.nullable(),
  })
  .strict()
  .refine(
    (v) =>
      (!v.nextCursor || v.items.length === 50) &&
      v.items.every(
        (item, i) =>
          validEventId(item.id) && (i === 0 || BigInt(v.items[i - 1].id) > BigInt(item.id)),
      ),
  );
export function staffHistoryPath(id: string, page: string | null) {
  staffId.parse(id);
  return (
    `/admin/staff/${encodeURIComponent(id)}/history` +
    (page ? '?cursor=' + encodeURIComponent(cursor.parse(page)) : '')
  );
}
export function staffRolesPayload(selected: string[], catalog: StaffRole[]) {
  roles.parse(selected);
  if (selected.some((id) => !catalog.some((r) => r.id === id)))
    throw new Error('تعریف نقش‌ها تغییر کرده است؛ ابتدا اطلاعات تازه را دریافت کنید.');
  return [...selected].sort();
}
export function eligibleStaffCandidate(candidate: StaffCandidate) {
  return (
    candidate.isActive &&
    candidate.contactVerified &&
    candidate.hasPassword &&
    !candidate.alreadyStaff &&
    !candidate.mfaRecoveryPending &&
    candidate.userName.length > 0
  );
}
