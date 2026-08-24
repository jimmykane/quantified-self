import { describe, expect, it } from 'vitest';
import { ActivityTypeGroups, ActivityTypes } from '@sports-alliance/sports-lib';
import {
  SUPPORTED_ACTIVITIES_PATH,
  SUPPORTED_ACTIVITIES_ROUTE_DATA,
  SUPPORTED_ACTIVITIES_URL,
  SUPPORTED_ACTIVITY_FAMILIES,
  SUPPORTED_ACTIVITY_SPECIALIZED_SURFACES,
  SUPPORTED_ACTIVITY_TYPE_COUNT,
} from './supported-activities-page.content';

describe('supported-activities-page.content', () => {
  it('derives a complete public catalog from canonical activity groups', () => {
    const catalogTypes = SUPPORTED_ACTIVITY_FAMILIES.flatMap(family => family.activityTypes);
    const unspecified = SUPPORTED_ACTIVITY_FAMILIES.find(family => family.id === ActivityTypeGroups.UnspecifiedGroup);

    expect(SUPPORTED_ACTIVITY_FAMILIES).toHaveLength(17);
    expect(SUPPORTED_ACTIVITY_TYPE_COUNT).toBe(131);
    expect(SUPPORTED_ACTIVITY_FAMILIES.map(family => family.id).sort()).toEqual(
      [...new Set(Object.values(ActivityTypeGroups))].sort(),
    );
    expect(new Set(catalogTypes).size).toBe(SUPPORTED_ACTIVITY_TYPE_COUNT);
    SUPPORTED_ACTIVITY_FAMILIES.forEach(family => {
      expect(family.icon.trim()).not.toBe('');
      expect(family.color).toMatch(/^#[0-9A-F]{6}$/i);
      expect(family.gradient).toContain('linear-gradient(');
    });
    expect(unspecified).toMatchObject({
      label: 'Other activities',
      icon: 'category',
      fallback: true,
    });
    expect(unspecified?.activityTypes).toContain(ActivityTypes.unknown);
    expect(SUPPORTED_ACTIVITY_FAMILIES.find(family => family.id === ActivityTypeGroups.SkatingGroup)).toMatchObject({
      icon: 'roller_skating',
    });
    expect(SUPPORTED_ACTIVITY_FAMILIES.find(family => family.id === ActivityTypeGroups.MotorizedGroup)).toMatchObject({
      icon: 'directions_car',
      color: '#546E7A',
    });
    expect(SUPPORTED_ACTIVITY_SPECIALIZED_SURFACES).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Laps and swim lengths',
        copy: expect.stringContaining('individual pool lengths'),
      }),
      expect.objectContaining({
        title: 'Jump details',
        copy: expect.stringContaining('jump events'),
      }),
    ]));
  });

  it('defines discoverable route metadata without provider compatibility guarantees', () => {
    expect(SUPPORTED_ACTIVITIES_PATH).toBe('features/supported-activities');
    expect(SUPPORTED_ACTIVITIES_URL).toBe('https://quantified-self.io/features/supported-activities');
    expect(SUPPORTED_ACTIVITIES_ROUTE_DATA).toMatchObject({
      title: 'Supported Activity Types',
      preload: true,
      animation: 'Features',
    });
    expect(SUPPORTED_ACTIVITIES_ROUTE_DATA.description).toContain('activity types Quantified Self recognizes');
    expect(SUPPORTED_ACTIVITIES_ROUTE_DATA.description).toContain('device, connected service, or uploaded file');
    expect(SUPPORTED_ACTIVITIES_ROUTE_DATA.description).not.toContain('every provider');
    expect(SUPPORTED_ACTIVITIES_ROUTE_DATA.jsonLd).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      url: SUPPORTED_ACTIVITIES_URL,
      inLanguage: 'en',
    });
  });
});
