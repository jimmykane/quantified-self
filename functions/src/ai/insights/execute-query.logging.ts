import { trimPromptSample } from './repaired-prompt-backlog';

const AI_INSIGHTS_EXECUTION_LOG_PROMPT_PREVIEW_MAX_CHARS = 60;

export function buildExecutionPromptLogContext(prompt?: string): {
  promptLength: number;
  promptPreview: string | null;
} {
  const normalizedPrompt = typeof prompt === 'string'
    ? prompt.trim()
    : '';

  return {
    promptLength: normalizedPrompt.length,
    promptPreview: normalizedPrompt
      ? trimPromptSample(normalizedPrompt, AI_INSIGHTS_EXECUTION_LOG_PROMPT_PREVIEW_MAX_CHARS)
      : null,
  };
}
