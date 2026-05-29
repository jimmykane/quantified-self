import { describe, expect, it } from 'vitest';
import {
  COMPARISON_FAQ_ITEMS,
  COMPARISON_FEATURE_ITEMS,
  COMPARISON_FREE_PLAN_ACTIVITY_LIMIT,
  COMPARISON_PROVIDER_SOURCES,
  COMPARISON_SEARCH_INTENT_ITEMS,
  WORKOUT_DATA_COMPARISON_PATH,
  WORKOUT_DATA_COMPARISON_ROUTE_DATA,
  WORKOUT_DATA_COMPARISON_URL,
} from './workout-data-comparison-page.content';

describe('workout-data-comparison-page.content', () => {
  it('defines route metadata for the static comparison feature page', () => {
    expect(WORKOUT_DATA_COMPARISON_PATH).toBe('features/workout-data-comparison');
    expect(WORKOUT_DATA_COMPARISON_URL).toBe('https://quantified-self.io/features/workout-data-comparison');
    expect(WORKOUT_DATA_COMPARISON_ROUTE_DATA.title).toBe('Workout Data Comparison');
    expect(WORKOUT_DATA_COMPARISON_ROUTE_DATA.description).toContain('custom FIT, TCX, or GPX workout data');
    expect(WORKOUT_DATA_COMPARISON_ROUTE_DATA.description).toContain('free-plan manual uploads');
    expect(WORKOUT_DATA_COMPARISON_ROUTE_DATA.description).toContain('reviewer-ready device comparisons');
    expect(WORKOUT_DATA_COMPARISON_ROUTE_DATA.keywords).toContain('Garmin vs COROS data');
    expect(WORKOUT_DATA_COMPARISON_ROUTE_DATA.keywords).toContain('compare FIT files workout data');
    expect(WORKOUT_DATA_COMPARISON_ROUTE_DATA.keywords).toContain('free workout data comparison');
    expect(WORKOUT_DATA_COMPARISON_ROUTE_DATA.keywords).toContain('sports watch review benchmark');
    expect(WORKOUT_DATA_COMPARISON_ROUTE_DATA.keywords).toContain('sync Garmin data to Suunto automatically');
    expect(WORKOUT_DATA_COMPARISON_ROUTE_DATA.keywords).not.toContain('AI insights');
    expect(WORKOUT_DATA_COMPARISON_ROUTE_DATA.jsonLd).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'Compare Garmin, Suunto, and COROS workout data',
      url: WORKOUT_DATA_COMPARISON_URL,
      inLanguage: 'en',
    });
    expect(WORKOUT_DATA_COMPARISON_ROUTE_DATA.jsonLd).toMatchObject({
      audience: [
        { '@type': 'Audience', audienceType: 'Endurance athletes' },
        { '@type': 'Audience', audienceType: 'Sports technology reviewers' },
      ],
    });
  });

  it('keeps the visible feature content complete and natural', () => {
    const visibleCopy = [
      ...COMPARISON_FEATURE_ITEMS.flatMap(item => [item.title, item.copy]),
      ...COMPARISON_SEARCH_INTENT_ITEMS.flatMap(item => [item.title, item.copy]),
      ...COMPARISON_FAQ_ITEMS.flatMap(item => [item.question, item.answer]),
      WORKOUT_DATA_COMPARISON_ROUTE_DATA.description,
      WORKOUT_DATA_COMPARISON_ROUTE_DATA.keywords,
    ].join(' ');

    expect(COMPARISON_PROVIDER_SOURCES.map(source => source.label)).toEqual(['Garmin', 'Suunto', 'COROS']);
    expect(COMPARISON_FREE_PLAN_ACTIVITY_LIMIT).toBe(100);
    expect(COMPARISON_FEATURE_ITEMS).toHaveLength(4);
    expect(COMPARISON_SEARCH_INTENT_ITEMS).toHaveLength(5);
    expect(COMPARISON_FAQ_ITEMS).toHaveLength(5);
    expect(visibleCopy).toContain('Centralize Garmin, Suunto, and COROS workout data');
    expect(visibleCopy).toContain('manual FIT, TCX, GPX, JSON, and SML imports');
    expect(visibleCopy).toContain('custom activity files');
    expect(visibleCopy).toContain('YouTube reviews, blog posts, coaching notes, and device QA');
    expect(visibleCopy).toContain('lab tests, beta firmware, review units, exported workouts, or unsupported services');
    expect(visibleCopy).toContain('private dashboard rather than a standalone public file viewer');
    expect(visibleCopy).toContain('Reviewers, YouTube creators, bloggers, coaches, and testers');
    expect(visibleCopy).toContain('available on the free plan for up to 100 activities');
    expect(visibleCopy).toContain('Automatic service sync and higher limits require a paid plan');
    expect(visibleCopy).not.toContain('AI insights');
    expect(visibleCopy).not.toContain('AI-backed');
    expect(visibleCopy).not.toContain('AI analysis');
    expect(visibleCopy).not.toContain('centralize Garmin Suunto and COROS workout data');
    expect(visibleCopy).not.toContain('compare Garmin Suunto COROS workout data');
  });
});
