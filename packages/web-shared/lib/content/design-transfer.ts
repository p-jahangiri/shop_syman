import { z } from '../config/schema-runtime.ts';
import { portableHomeBlocksSchema } from './home-blocks-contract.ts';
import { siteDesignSchema } from './site-design.ts';
import { sitePaletteSchema } from './site-palette.ts';

export const designTransferMaxBytes = 96_000;
const designTransferSchema = z.strictObject({
  format: z.literal('sayman-store-design'),
  schemaVersion: z.literal(1),
  design: siteDesignSchema,
  palette: sitePaletteSchema.optional(),
  homeBlocks: portableHomeBlocksSchema.optional(),
});
export type DesignTransfer = z.infer<typeof designTransferSchema>;

export function readDesignTransfer(json: string): DesignTransfer {
  if (new TextEncoder().encode(json).length > designTransferMaxBytes)
    throw new Error('فایل قالب بیش از حد بزرگ است.');
  const parsed = designTransferSchema.safeParse(JSON.parse(json));
  if (!parsed.success)
    throw new Error('نسخه یا محتوای قالب معتبر نیست. از فایل JSON خروجی سایمان استفاده کنید.');
  return parsed.data;
}
