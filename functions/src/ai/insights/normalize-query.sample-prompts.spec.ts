import { describe, expect, it, vi } from 'vitest';
import {
  AI_INSIGHTS_CURATED_PROMPT_CATALOG,
  AI_INSIGHTS_PROMPT_CATALOG,
  getAiInsightsDefaultPickerPromptSections,
  getAiInsightsPromptEntriesBySurface,
  type AiInsightsPromptDefinition,
} from '../../../../shared/ai-insights-prompts';
import { createNormalizeQuery } from './normalize-query.flow';

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => await importOriginal());

function collectDefaultSurfacePrompts(): readonly AiInsightsPromptDefinition[] {
  const pickerPromptTexts = new Set(
    getAiInsightsDefaultPickerPromptSections()
      .flatMap(section => section.groups)
      .flatMap(group => group.prompts)
      .map(prompt => prompt.prompt),
  );

  const catalogPromptByText = new Map<string, AiInsightsPromptDefinition>();
  [...AI_INSIGHTS_CURATED_PROMPT_CATALOG, ...AI_INSIGHTS_PROMPT_CATALOG]
    .forEach((entry) => {
      if (!catalogPromptByText.has(entry.prompt)) {
        catalogPromptByText.set(entry.prompt, entry);
      }
    });

  return [...pickerPromptTexts]
    .map((prompt) => catalogPromptByText.get(prompt))
    .filter((entry): entry is AiInsightsPromptDefinition => Boolean(entry));
}

function toComparableMetricKey(
  metricKey: string,
): string {
  return metricKey === 'body_weight' ? 'weight' : metricKey;
}

describe('normalizeInsightQuery sample prompts', () => {
  it('normalizes default picker prompts successfully', async () => {
    const normalizeQueryApi = createNormalizeQuery({
      now: () => new Date('2026-03-22T12:00:00.000Z'),
    });

    const promptEntries = collectDefaultSurfacePrompts();
    const failures: string[] = [];

    for (const promptEntry of promptEntries) {
      const result = await normalizeQueryApi.normalizeInsightQuery({
        prompt: promptEntry.prompt,
        clientTimezone: 'UTC',
      });
      if (result.status !== 'ok') {
        failures.push(`${promptEntry.id}: status=${result.status} reason=${result.reasonCode}`);
        continue;
      }

      if (promptEntry.metricKey && result.metricKey) {
        const expectedMetricKey = toComparableMetricKey(promptEntry.metricKey);
        const actualMetricKey = toComparableMetricKey(result.metricKey);
        if (expectedMetricKey !== actualMetricKey) {
          failures.push(`${promptEntry.id}: expected metricKey=${expectedMetricKey} but received ${actualMetricKey}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it('normalizes unsupported-surface suggestion prompts successfully', async () => {
    const normalizeQueryApi = createNormalizeQuery({
      now: () => new Date('2026-03-22T12:00:00.000Z'),
    });
    const unsupportedPromptEntries = getAiInsightsPromptEntriesBySurface('unsupported');
    const failures: string[] = [];

    for (const promptEntry of unsupportedPromptEntries) {
      const result = await normalizeQueryApi.normalizeInsightQuery({
        prompt: promptEntry.prompt,
        clientTimezone: 'UTC',
      });
      if (result.status !== 'ok') {
        failures.push(`${promptEntry.id}: status=${result.status} reason=${result.reasonCode}`);
      }
    }

    expect(failures).toEqual([]);
  });
});
