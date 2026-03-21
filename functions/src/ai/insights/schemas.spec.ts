import { describe, expect, it, vi } from 'vitest';
import { AiInsightsResponseSchema } from './schemas';

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => await importOriginal());

describe('AiInsightsResponseSchema', () => {
  it('is defined as a discriminated union on status', () => {
    expect((AiInsightsResponseSchema as any)._def?.typeName).toBe('ZodDiscriminatedUnion');
  });

  it('parses unsupported responses through the status discriminator', () => {
    const parsed = AiInsightsResponseSchema.safeParse({
      status: 'unsupported',
      narrative: 'Unsupported prompt',
      reasonCode: 'unsupported_capability',
      suggestedPrompts: ['Show my total distance for last month'],
    });

    expect(parsed.success).toBe(true);
  });

  it('rejects payloads without the status discriminator', () => {
    const parsed = AiInsightsResponseSchema.safeParse({
      narrative: 'Missing status',
    });

    expect(parsed.success).toBe(false);
  });
});
