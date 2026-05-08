import { z } from 'zod';

import { RESOURCE_TYPES } from '../constants.js';

export const changesSchema = z
  .object({
    since: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe('Start date in YYYY-MM-DD format, e.g. "2024-01-01"'),
    resource_type: z
      .enum(RESOURCE_TYPES)
      .default('any')
      .describe(
        'Document type filter: REG, DIR, DEC, JUDG, REG_IMPL, REG_DEL, RECO, ORDER, OPIN_AG, or any',
      ),
    language: z.enum(['DEU', 'ENG', 'FRA']).default('ENG').describe('Language for document titles'),
    limit: z.number().int().min(1).max(200).default(50).describe('Max results (1-200)'),
  })
  .strict();

export type ChangesInput = z.infer<typeof changesSchema>;
