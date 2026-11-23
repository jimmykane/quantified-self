import { z } from 'zod';

export const planAttributionSchema = z.strictObject({
  title: z.string().min(1).max(120), originalAuthor: z.string().min(1).max(100),
  sourceUrl: z.string().max(512).regex(/^https:\/\//),
  license: z.string().min(1).max(80), licenseUrl: z.string().max(512).regex(/^https:\/\//),
  changes: z.string().min(1).max(650), notice: z.string().min(1).max(400), privateCopy: z.literal(true).optional(),
});
