import { z } from './schema-runtime.ts';
const notes = z
  .string()
  .max(2000)
  .refine(
    (v) =>
      // eslint-disable-next-line no-control-regex -- Reject forbidden control characters at the trust boundary.
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(v),
  );
export const usedConditionSchema = z
  .object({
    inspectionId: z
      .string()
      .regex(/^[a-f0-9]{32}$/)
      .refine((v) => !/^0+$/.test(v)),
    technicalState: z.enum(['unknown', 'passed', 'needsRepair']),
    batteryState: z.enum(['unknown', 'notApplicable', 'measured']),
    batteryHealthPercent: z.number().int().min(0).max(100).nullable(),
    screenState: z.enum(['unknown', 'intact', 'worn', 'damaged']),
    bodyState: z.enum(['unknown', 'intact', 'worn', 'damaged']),
    repairState: z.enum(['unknown', 'noKnownRepair', 'repaired']),
    notesFa: notes,
    notesEn: notes,
    inspectedAt: z.iso
      .datetime({ offset: true })
      .refine(
        (v) =>
          /(?:Z|\+00:00)$/.test(v) &&
          v !== '0001-01-01T00:00:00Z' &&
          v !== '0001-01-01T00:00:00+00:00',
      ),
  })
  .strict()
  .refine((v) => (v.batteryState === 'measured') === (v.batteryHealthPercent !== null));
export type UsedCondition = z.infer<typeof usedConditionSchema>;
