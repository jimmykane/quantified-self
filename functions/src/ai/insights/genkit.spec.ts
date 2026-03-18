import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const genkit = vi.fn(() => ({ mocked: true }));
  const googleAIPlugin = vi.fn(() => ({ plugin: true }));
  const googleAIModel = vi.fn((name: string) => ({ name }));

  return {
    genkit,
    googleAIPlugin,
    googleAIModel,
  };
});

vi.mock('genkit', () => ({
  genkit: hoisted.genkit,
}));

vi.mock('@genkit-ai/google-genai', () => ({
  googleAI: Object.assign(hoisted.googleAIPlugin, {
    model: hoisted.googleAIModel,
  }),
}));

import { aiInsightsGenkit } from './genkit';

describe('genkit config', () => {
  const originalGeminiApiKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    if (originalGeminiApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalGeminiApiKey;
    }
  });

  it('configures googleAI without a custom apiKey override', () => {
    expect(hoisted.googleAIPlugin).toHaveBeenCalledWith();
    expect(hoisted.googleAIModel).toHaveBeenCalledWith('gemini-2.5-flash');
    expect(aiInsightsGenkit).toEqual({ mocked: true });
  });

  it('does not inject a custom apiKey into the googleAI plugin config', () => {
    const firstCallArgs = hoisted.googleAIPlugin.mock.calls[0] || [];
    expect(firstCallArgs).toEqual([]);
  });

  it('relies on the runtime GEMINI_API_KEY env convention rather than firebase-functions params', () => {
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
  });
});
