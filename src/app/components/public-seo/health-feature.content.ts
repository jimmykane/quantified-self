import type { PublicFeaturePreviewKey } from './public-feature-preview.types';

/** Shared public copy and preview selection for home and the Health feature page. */
export const HEALTH_FEATURE_CONTENT = {
  title: 'Your Health, Beyond Training.',
  intro: 'Follow sleep, heart rate, HRV, and body measurements over time. Bring supported Garmin, Suunto, and COROS health data together, compare each source, and add your own measurements.',
  rows: [
    {
      icon: 'bedtime', title: 'See How You’re Sleeping',
      copy: 'Explore sleep duration, stages, and overnight readings, with each provider clearly identified.',
      preview: 'health-sleep' as PublicFeaturePreviewKey,
    },
    {
      icon: 'monitor_heart', title: 'Get to Know Your Usual',
      copy: 'Follow resting heart rate and HRV over time. Compare nightly HRV with your personal range when enough history is available. Add context with notes about travel, sickness, stress, and time away.',
      preview: 'health-hrv' as PublicFeaturePreviewKey,
    },
    {
      icon: 'monitor_weight', title: 'Log Your Measurements',
      copy: 'Log blood pressure, weight, body composition, blood oxygen, and VO₂ max. Follow your readings over time alongside imported health data, with manual entries clearly labelled.',
      preview: 'health-weight' as PublicFeaturePreviewKey,
    },
  ],
} as const;
