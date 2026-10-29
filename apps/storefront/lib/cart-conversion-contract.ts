import { z } from './schema-runtime.ts';
import {
  offerIdSchema as id,
  offerCommandIdSchema as commandId,
  offerVersionSchema as version,
  offerFingerprintSchema as hash,
  offerRialSchema as money,
  offerSkuSchema,
} from './offer-contract.ts';
import { marketIdSchema as identifier } from './market-contract.ts';
const date = z.iso.datetime({ offset: true }).refine((value) => /(?:Z|\+00:00)$/.test(value));
const unique = (values: string[]) => new Set(values).size === values.length;
const quantity = z.number().int().min(1).max(1000000);
const link = z.object({ lineId: id, agreementLineId: id, offerLineId: id }).strict();
const links = z
  .array(link)
  .min(1)
  .max(64)
  .refine(
    (values) =>
      unique(values.map((line) => line.lineId)) &&
      unique(values.map((line) => line.agreementLineId)) &&
      unique(values.map((line) => line.offerLineId)),
  );
const agreementLine = z
  .object({
    id,
    offerLineId: id,
    listingId: id,
    quantity,
    unitPriceRial: money,
    lineTotalRial: money,
    sku: offerSkuSchema,
  })
  .strict()
  .refine(
    (line) => BigInt(line.unitPriceRial) * BigInt(line.quantity) === BigInt(line.lineTotalRial),
  );
export const sourcingPriceAgreementSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    requestId: id,
    taskId: id,
    offerId: id,
    revision: z.number().int().min(1).max(2147483647),
    acceptanceId: id,
    termsHash: hash,
    allocationId: id,
    state: z.enum(['Active', 'Revoked', 'Consumed']),
    effectiveState: z.enum(['Active', 'Expired', 'Revoked', 'Consumed']),
    version,
    termsFa: z.string().max(4000),
    termsEn: z.string().max(4000),
    purchaseUntil: date,
    isDemo: z.boolean(),
    lines: z.array(agreementLine).min(1).max(64),
    canPay: z.literal(false),
  })
  .strict()
  .refine(
    (value) =>
      (value.state === value.effectiveState ||
        (value.state === 'Active' && value.effectiveState === 'Expired')) &&
      unique(value.lines.map((line) => line.id)) &&
      unique(value.lines.map((line) => line.offerLineId)) &&
      value.lines.reduce((sum, line) => sum + BigInt(line.lineTotalRial), 0n) <=
        9223372036854775807n,
  );
export const sourcingConversionProofSchema = z
  .object({
    allocationId: id,
    requestId: id,
    taskId: id,
    offerId: id,
    acceptanceId: id,
    termsHash: hash,
    version,
    expiresAt: date,
    isDemo: z.boolean(),
    lines: z
      .array(z.object({ offerLineId: id, variantId: identifier, quantity }).strict())
      .min(1)
      .max(64),
  })
  .strict()
  .refine((value) => unique(value.lines.map((line) => line.offerLineId)));
export const cartConversionCandidateSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: id,
    requestVersion: version,
    taskId: id,
    taskVersion: version,
    offerId: id,
    offerVersion: version,
    acceptanceId: id,
    termsHash: hash,
    purchaseUntil: date,
    agreement: sourcingPriceAgreementSchema.nullable(),
    allocation: sourcingConversionProofSchema.nullable(),
    cartVersion: version.nullable(),
    conversion: z.object({ id, cartVersion: version, lines: links }).strict().nullable(),
    canConvert: z.boolean(),
    canCheckout: z.literal(false),
    canPay: z.literal(false),
    blockers: z.array(z.string().regex(/^[a-z_]{1,100}$/)).max(64),
  })
  .strict()
  .refine((value) => {
    for (const child of [value.agreement, value.allocation])
      if (
        child &&
        (child.requestId !== value.requestId ||
          child.taskId !== value.taskId ||
          child.offerId !== value.offerId ||
          child.acceptanceId !== value.acceptanceId ||
          child.termsHash !== value.termsHash)
      )
        return false;
    if (
      (value.agreement && value.agreement.purchaseUntil !== value.purchaseUntil) ||
      (value.allocation && Date.parse(value.allocation.expiresAt) > Date.parse(value.purchaseUntil))
    )
      return false;
    if (
      value.agreement &&
      value.allocation &&
      (value.agreement.lines.length !== value.allocation.lines.length ||
        value.agreement.lines.some(
          (line) =>
            !value.allocation!.lines.some(
              (pick) =>
                pick.offerLineId === line.offerLineId &&
                pick.variantId.toUpperCase() === line.sku.variantId.toUpperCase() &&
                pick.quantity === line.quantity,
            ),
        ))
    )
      return false;
    if (
      value.canConvert &&
      (!value.agreement ||
        value.agreement.effectiveState !== 'Active' ||
        !value.allocation ||
        value.conversion !== null ||
        value.blockers.length)
    )
      return false;
    return true;
  });
export const cartConversionInputSchema = z
  .object({
    requestId: commandId,
    taskId: id,
    requestVersion: version,
    taskVersion: version,
    offerVersion: version,
    acceptanceId: id,
    agreementId: id,
    agreementVersion: version,
    allocationId: id,
    allocationVersion: version,
    termsHash: hash,
    cartVersion: version.nullable(),
  })
  .strict();
export const cartConversionMutationSchema = z
  .object({
    schemaVersion: z.literal(1),
    conversionId: id,
    requestId: id,
    taskId: id,
    offerId: id,
    acceptanceId: id,
    agreementId: id,
    allocationId: id,
    cartId: id,
    cartVersion: version,
    lines: links,
    commandId,
    at: date,
    replayed: z.boolean(),
    canCheckout: z.literal(false),
    canPay: z.literal(false),
  })
  .strict();
export const cartOfferRemovalInputSchema = z.object({ requestId: commandId, version }).strict();
export const cartOfferRemovalMutationSchema = z
  .object({
    schemaVersion: z.literal(1),
    agreementId: id,
    cartId: id,
    cartVersion: version,
    lineIds: z.array(id).min(1).max(64).refine(unique),
    commandId,
    at: date,
    replayed: z.boolean(),
    canCheckout: z.literal(false),
    canPay: z.literal(false),
  })
  .strict();
export type CartConversionCandidate = z.infer<typeof cartConversionCandidateSchema>;
export type CartConversionInput = z.infer<typeof cartConversionInputSchema>;
export type CartConversionMutation = z.infer<typeof cartConversionMutationSchema>;
export type CartOfferRemovalInput = z.infer<typeof cartOfferRemovalInputSchema>;
export type CartOfferRemovalMutation = z.infer<typeof cartOfferRemovalMutationSchema>;
export type CartCommand =
  | {
      kind: 'cart-convert';
      id: string;
      offerId: string;
      locale: 'fa' | 'en';
      body: CartConversionInput;
    }
  | { kind: 'cart-remove'; id: string; locale: 'fa' | 'en'; body: CartOfferRemovalInput };
export type CartCommandReceipt = CartConversionMutation | CartOfferRemovalMutation;
export function conversionInput(
  candidate: CartConversionCandidate,
  requestId: string,
  now = Date.now(),
): CartConversionInput {
  const value = cartConversionCandidateSchema.parse(candidate);
  if (
    !value.canConvert ||
    !value.agreement ||
    !value.allocation ||
    Date.parse(value.purchaseUntil) <= now ||
    Date.parse(value.allocation.expiresAt) <= now
  )
    throw new Error('cart_conversion_review_required');
  return cartConversionInputSchema.parse({
    requestId,
    taskId: value.taskId,
    requestVersion: value.requestVersion,
    taskVersion: value.taskVersion,
    offerVersion: value.offerVersion,
    acceptanceId: value.acceptanceId,
    agreementId: value.agreement.id,
    agreementVersion: value.agreement.version,
    allocationId: value.allocation.allocationId,
    allocationVersion: value.allocation.version,
    termsHash: value.termsHash,
    cartVersion: value.cartVersion,
  });
}
export function cartCommandReceiptMatches(
  command: CartCommand,
  raw: unknown,
  receipt = false,
): CartCommandReceipt {
  const canonical = (value: string) => value.replaceAll('-', '').toLowerCase();
  if (command.kind === 'cart-convert') {
    const value = cartConversionMutationSchema.parse(raw);
    if (
      value.requestId !== command.id ||
      value.offerId !== command.offerId ||
      value.taskId !== command.body.taskId ||
      value.acceptanceId !== command.body.acceptanceId ||
      value.agreementId !== command.body.agreementId ||
      value.allocationId !== command.body.allocationId ||
      canonical(value.commandId) !== canonical(command.body.requestId) ||
      (receipt && !value.replayed)
    )
      throw new Error('cart_conversion_response_mismatch');
    return value;
  }
  const value = cartOfferRemovalMutationSchema.parse(raw);
  if (
    value.agreementId !== command.id ||
    canonical(value.commandId) !== canonical(command.body.requestId) ||
    (receipt && !value.replayed)
  )
    throw new Error('cart_remove_response_mismatch');
  return value;
}
