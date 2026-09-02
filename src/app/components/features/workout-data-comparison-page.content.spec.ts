import { describe, expect, it } from 'vitest';
import {
  COMPARISON_ANALYSIS_ITEMS,
  COMPARISON_FAQ_ITEMS,
  COMPARISON_FREE_PLAN_ACTIVITY_LIMIT,
  COMPARISON_PROVIDER_SOURCES,
  COMPARISON_REVIEW_ITEMS,
  COMPARISON_SOURCE_ITEMS,
  WORKOUT_DATA_COMPARISON_PATH,
  WORKOUT_DATA_COMPARISON_ROUTE_DATA,
  WORKOUT_DATA_COMPARISON_URL,
} from './workout-data-comparison-page.content';

describe('workout-data-comparison-page.content', () => {
  it('defines route metadata for the static comparison feature page', () => {
    expect(WORKOUT_DATA_COMPARISON_PATH).toBe('features/workout-data-comparison');
    expect(WORKOUT_DATA_COMPARISON_URL).toBe('https://quantified-self.io/features/workout-data-comparison');
    expect(WORKOUT_DATA_COMPARISON_ROUTE_DATA.title).toBe('Workout File, Provider & Sports Device Comparison');
    expect(WORKOUT_DATA_COMPARISON_ROUTE_DATA.description).toContain('FIT, TCX, GPX, JSON, and SML');
    expect(WORKOUT_DATA_COMPARISON_ROUTE_DATA.description).toContain('synchronized charts');
    expect(WORKOUT_DATA_COMPARISON_ROUTE_DATA.description).toContain('reviewer-ready benchmarks');
    expect(WORKOUT_DATA_COMPARISON_ROUTE_DATA.description.length).toBeLessThanOrEqual(160);
    expect(WORKOUT_DATA_COMPARISON_ROUTE_DATA).not.toHaveProperty('keywords');
    expect(WORKOUT_DATA_COMPARISON_ROUTE_DATA.jsonLd).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'Compare workout files, providers, and sports devices',
      url: WORKOUT_DATA_COMPARISON_URL,
      inLanguage: 'en',
    });
    expect(WORKOUT_DATA_COMPARISON_ROUTE_DATA.jsonLd['about']).toEqual([
      'Garmin vs COROS workout data',
      'Garmin, Suunto, COROS, and Wahoo workout comparison',
      'Custom FIT and TCX workout file comparison',
      'Sports watch review benchmark reports',
      'GNSS track comparison',
      'Heart-rate and power sensor comparison',
    ]);
    expect(WORKOUT_DATA_COMPARISON_ROUTE_DATA.jsonLd).toMatchObject({
      audience: [
        { '@type': 'Audience', audienceType: 'Endurance athletes' },
        { '@type': 'Audience', audienceType: 'Sports technology reviewers' },
      ],
    });
  });

  it('keeps the visible feature content complete and natural', () => {
    const visibleCopy = [
      ...COMPARISON_SOURCE_ITEMS.flatMap(item => [item.title, item.copy]),
      ...COMPARISON_ANALYSIS_ITEMS.flatMap(item => [item.title, item.copy]),
      ...COMPARISON_REVIEW_ITEMS.flatMap(item => [item.title, item.copy]),
      ...COMPARISON_FAQ_ITEMS.flatMap(item => [item.question, item.answer]),
      WORKOUT_DATA_COMPARISON_ROUTE_DATA.description,
    ].join(' ');

    expect(COMPARISON_PROVIDER_SOURCES.map(source => source.label)).toEqual(['Garmin', 'Suunto', 'COROS', 'Wahoo']);
    expect(COMPARISON_FREE_PLAN_ACTIVITY_LIMIT).toBe(100);
    expect(COMPARISON_SOURCE_ITEMS).toHaveLength(3);
    expect(COMPARISON_ANALYSIS_ITEMS).toHaveLength(4);
    expect(COMPARISON_REVIEW_ITEMS).toHaveLength(4);
    expect(COMPARISON_FAQ_ITEMS).toHaveLength(5);
    expect(visibleCopy).toContain('Garmin, Suunto, COROS, and Wahoo');
    expect(visibleCopy).toContain('FIT, TCX, GPX, JSON, and SML');
    expect(visibleCopy).toContain('lab tests, beta firmware, and review units');
    expect(visibleCopy).toContain('Reference and test roles');
    expect(visibleCopy).toContain('Synchronized metric overlays');
    expect(visibleCopy).toContain('CEP50, CEP95, RMSE');
    expect(visibleCopy).toContain('Stable device colors and review tags');
    expect(visibleCopy).toContain('YouTube videos, blog posts, coaching notes, firmware tests, and QA');
    expect(visibleCopy).toContain('works as a FIT and workout-file viewer');
    expect(visibleCopy).toContain('maps, charts, statistics, and recorded metrics');
    expect(visibleCopy).not.toMatch(/\bprivate\b/i);
    expect(visibleCopy).toContain('Manual uploads, core analysis tools, and benchmark comparisons are available on the free plan for up to 100 activities');
    expect(visibleCopy).toContain('Automatic service sync and higher activity limits require a paid plan');
    expect(visibleCopy).not.toContain('AI insights');
    expect(visibleCopy).not.toContain('AI-backed');
    expect(visibleCopy).not.toContain('AI analysis');
    expect(visibleCopy).not.toContain('centralize Garmin Suunto and COROS workout data');
    expect(visibleCopy).not.toContain('compare Garmin Suunto COROS workout data');
  });
});
