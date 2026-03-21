import { describe, expect, it, vi } from 'vitest';

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => await importOriginal());
import {
  createPromptLanguageSanitization,
  detectPromptLanguageDeterministic,
} from './prompt-language-sanitization';

describe('prompt-language-sanitization', () => {
  it('detects likely english prompts deterministically', () => {
    expect(detectPromptLanguageDeterministic('show my average cadence for cycling this year')).toBe('english');
  });

  it('detects non-latin prompts as non-english', () => {
    expect(detectPromptLanguageDeterministic('δείξε μου μέσο cadence')).toBe('non_english');
  });

  it('classifies empty prompt as uncertain', () => {
    expect(detectPromptLanguageDeterministic('   ')).toBe('uncertain');
  });

  it('returns sanitized english prompt when model output is valid', async () => {
    const testSubject = createPromptLanguageSanitization({
      sanitizeWithModel: async () => ({
        status: 'english',
        englishPrompt: 'show my average power over time for cycling',
      }),
    });

    const result = await testSubject.sanitizePromptToEnglish('zeige mir durchschnittliche leistung');
    expect(result).toEqual({
      status: 'english',
      prompt: 'show my average power over time for cycling',
    });
  });

  it('returns unsupported when model output is null', async () => {
    const testSubject = createPromptLanguageSanitization({
      sanitizeWithModel: async () => null,
    });

    const result = await testSubject.sanitizePromptToEnglish('непонятный запрос');
    expect(result.status).toBe('unsupported');
    if (result.status !== 'unsupported') {
      throw new Error('Expected unsupported sanitization result.');
    }
    expect(result.reasonCode).toBe('invalid_prompt');
    expect(result.suggestedPrompts.length).toBe(3);
  });

  it('returns unsupported when model response remains non-english', async () => {
    const testSubject = createPromptLanguageSanitization({
      sanitizeWithModel: async () => ({
        status: 'english',
        englishPrompt: 'пример запроса',
      }),
    });

    const result = await testSubject.sanitizePromptToEnglish('пример запроса');
    expect(result.status).toBe('unsupported');
    if (result.status !== 'unsupported') {
      throw new Error('Expected unsupported sanitization result.');
    }
    expect(result.reasonCode).toBe('invalid_prompt');
    expect(result.suggestedPrompts.length).toBe(3);
  });
});
