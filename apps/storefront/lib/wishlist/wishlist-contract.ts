import { z } from '@sayman/web-shared/lib/config/schema-runtime.ts';
const id = z.string().regex(/^[a-z0-9_-]{1,64}$/),
  version = z
    .string()
    .regex(/^[A-Za-z0-9+/]{11}=$/)
    .refine((v) => {
      try {
        return btoa(atob(v)) === v;
      } catch {
        return false;
      }
    });
const ids = z
  .array(id)
  .max(200)
  .refine((v) => new Set(v).size === v.length);
export const wishlistInputSchema = z
  .object({ productIds: ids, version: version.nullable() })
  .strict();
export const wishlistSchema = z
  .object({
    schemaVersion: z.literal(1),
    ownerId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    capacity: z.literal(200),
    version: version.nullable(),
    productIds: ids,
  })
  .strict()
  .refine(
    (v) =>
      (v.version !== null || v.productIds.length === 0) &&
      v.productIds.every((id, i) => i === 0 || id > v.productIds[i - 1]),
  );
export type WishlistData = z.infer<typeof wishlistSchema>;
export const isWishlistPath = (path: string, method = 'GET') =>
  path === '/api/wishlist' && ['GET', 'PUT'].includes(method);
export function readWishlist(input: unknown, owner: string) {
  const value = wishlistSchema.parse(input);
  if (value.ownerId.toUpperCase() !== owner.toUpperCase()) throw Error('wishlist_owner_changed');
  return value;
}
export function mergeWishlist(account: string[], guest: string[]) {
  const ids = [...new Set([...account, ...guest])].sort();
  return wishlistInputSchema.shape.productIds.parse(ids);
}
