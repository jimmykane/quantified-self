import { describe, expect, it } from 'vitest';
import { synthesizeSupportedPromptCandidate } from './query-synthesizer';

describe('query-synthesizer', () => {
  it('returns a high-confidence candidate when correcting heartrate spelling', () => {
    const candidate = synthesizeSupportedPromptCandidate('What should my heartrate be this year?');
    expect(candidate).toEqual({
      prompt: 'What should my heart rate be this year?',
      confidence: 0.92,
      reason: 'Normalized common heart-rate metric spelling tokens.',
    });
  });

  it('returns null when no supported synthesis rewrite exists', () => {
    const candidate = synthesizeSupportedPromptCandidate('Show my distance this year.');
    expect(candidate).toBeNull();
  });
});
