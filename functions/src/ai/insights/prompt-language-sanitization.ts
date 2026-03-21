import { z } from 'genkit';
import type { AiInsightsUnsupportedReasonCode } from '../../../../shared/ai-insights.types';
import { aiInsightsGenkit } from './genkit';
import { getSuggestedInsightPrompts } from './metric-catalog';

export type PromptLanguage = 'english' | 'non_english' | 'uncertain';

export interface PromptSanitizationResultEnglish {
  status: 'english';
  prompt: string;
}

export interface PromptSanitizationResultUnsupported {
  status: 'unsupported';
  reasonCode: AiInsightsUnsupportedReasonCode;
  suggestedPrompts: string[];
}

export type PromptSanitizationResult =
  | PromptSanitizationResultEnglish
  | PromptSanitizationResultUnsupported;

interface PromptLanguageSanitizationDependencies {
  sanitizeWithModel: (input: { prompt: string }) => Promise<{
    status: 'english' | 'unsupported';
    englishPrompt?: string;
    unsupportedReasonCode?: AiInsightsUnsupportedReasonCode;
  } | null>;
}

const NON_LATIN_SCRIPT_REGEX = /[\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const ENGLISH_CONTEXT_TOKENS = new Set([
  'show',
  'what',
  'when',
  'where',
  'how',
  'my',
  'in',
  'for',
  'by',
  'over',
  'time',
  'year',
  'month',
  'week',
  'day',
  'distance',
  'duration',
  'cadence',
  'power',
  'speed',
  'pace',
  'heart',
  'rate',
  'max',
  'min',
  'total',
  'average',
  'activity',
  'sport',
  'cycling',
  'running',
  'columns',
  'line',
  'chart',
]);

const SanitizePromptOutputSchema = z.object({
  status: z.enum(['english', 'unsupported']),
  englishPrompt: z.string().optional(),
  unsupportedReasonCode: z.enum([
    'invalid_prompt',
    'unsupported_metric',
    'ambiguous_metric',
    'unsupported_capability',
    'too_many_metrics',
    'unsupported_multi_metric_combination',
  ]).optional(),
});

const defaultPromptLanguageSanitizationDependencies: PromptLanguageSanitizationDependencies = {
  sanitizeWithModel: async ({ prompt }) => {
    const { output } = await aiInsightsGenkit.generate({
      system: [
        'You convert non-English fitness analytics prompts into concise English.',
        'Preserve metric intent, aggregation words, date constraints, activity filters, exclusions, and chart hints exactly.',
        'Do not add new constraints or remove explicit ones.',
        'If prompt intent is not recoverable, return unsupported.',
      ].join(' '),
      prompt: JSON.stringify({ prompt }),
      output: { schema: SanitizePromptOutputSchema },
    });

    return output ?? null;
  },
};

export interface PromptLanguageSanitizationApi {
  sanitizePromptToEnglish: (prompt: string) => Promise<PromptSanitizationResult>;
}

function isAsciiOnly(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 0x7F) {
      return false;
    }
  }

  return true;
}

export function detectPromptLanguageDeterministic(prompt: string): PromptLanguage {
  const trimmedPrompt = `${prompt || ''}`.trim();
  if (!trimmedPrompt) {
    return 'uncertain';
  }

  if (NON_LATIN_SCRIPT_REGEX.test(trimmedPrompt)) {
    return 'non_english';
  }

  const lowerPrompt = trimmedPrompt.toLowerCase();
  const tokens = lowerPrompt.match(/[a-z]+/g) ?? [];
  if (!tokens.length) {
    return 'uncertain';
  }

  const englishTokenMatches = tokens.filter(token => ENGLISH_CONTEXT_TOKENS.has(token)).length;
  if (englishTokenMatches >= 1) {
    return 'english';
  }

  const containsOnlyAscii = isAsciiOnly(trimmedPrompt);
  if (containsOnlyAscii) {
    return 'english';
  }

  return 'uncertain';
}

export function createPromptLanguageSanitization(
  dependencies: Partial<PromptLanguageSanitizationDependencies> = {},
): PromptLanguageSanitizationApi {
  const resolvedDependencies: PromptLanguageSanitizationDependencies = {
    ...defaultPromptLanguageSanitizationDependencies,
    ...dependencies,
  };

  return {
    sanitizePromptToEnglish: async (prompt: string): Promise<PromptSanitizationResult> => {
      const sanitized = await resolvedDependencies.sanitizeWithModel({ prompt });
      if (!sanitized) {
        return {
          status: 'unsupported',
          reasonCode: 'invalid_prompt',
          suggestedPrompts: getSuggestedInsightPrompts(3, prompt),
        };
      }

      if (sanitized.status === 'unsupported') {
        return {
          status: 'unsupported',
          reasonCode: sanitized.unsupportedReasonCode || 'invalid_prompt',
          suggestedPrompts: getSuggestedInsightPrompts(3, prompt),
        };
      }

      const sanitizedPrompt = `${sanitized.englishPrompt || ''}`.trim();
      if (!sanitizedPrompt) {
        return {
          status: 'unsupported',
          reasonCode: 'invalid_prompt',
          suggestedPrompts: getSuggestedInsightPrompts(3, prompt),
        };
      }

      if (detectPromptLanguageDeterministic(sanitizedPrompt) !== 'english') {
        return {
          status: 'unsupported',
          reasonCode: 'invalid_prompt',
          suggestedPrompts: getSuggestedInsightPrompts(3, prompt),
        };
      }

      return {
        status: 'english',
        prompt: sanitizedPrompt,
      };
    },
  };
}

const promptLanguageSanitizationRuntime = createPromptLanguageSanitization();

export async function sanitizePromptToEnglish(prompt: string): Promise<PromptSanitizationResult> {
  return promptLanguageSanitizationRuntime.sanitizePromptToEnglish(prompt);
}
