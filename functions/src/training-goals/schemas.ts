import { z } from 'zod';
import { normalizeTrainingLocalDate } from '../../../shared/training-plans';
export const GOAL_PROGRESS_REQUEST = z.strictObject({
  localDate: z.string().length(10).refine(value => { try { return normalizeTrainingLocalDate(value) === value; } catch { return false; } }),
  timeZone: z.string().min(1).max(100).refine(timeZone => { try { new Intl.DateTimeFormat('en', { timeZone }).format(); return true; } catch { return false; } }),
  weekStartsOn: z.number().int().min(0).max(6).optional(),
});
