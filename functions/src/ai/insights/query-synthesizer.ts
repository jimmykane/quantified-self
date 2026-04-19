export interface SupportedSynthesisCandidate {
  prompt: string;
  confidence: number;
  reason: string;
}

const HEART_RATE_TOKEN_PATTERN = /\bheartrate\b/gi;
const HEART_RATE_HYPHEN_TOKEN_PATTERN = /\bheart-rate\b/gi;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function synthesizeSupportedPromptCandidate(
  prompt: string,
): SupportedSynthesisCandidate | null {
  const normalizedPrompt = normalizeWhitespace(`${prompt || ''}`);
  if (!normalizedPrompt) {
    return null;
  }

  const spellingCorrectedPrompt = normalizedPrompt
    .replace(HEART_RATE_TOKEN_PATTERN, 'heart rate')
    .replace(HEART_RATE_HYPHEN_TOKEN_PATTERN, 'heart rate');

  if (spellingCorrectedPrompt !== normalizedPrompt) {
    return {
      prompt: spellingCorrectedPrompt,
      confidence: 0.92,
      reason: 'Normalized common heart-rate metric spelling tokens.',
    };
  }

  return null;
}
