import { HEALTH_FEATURE_CONTENT } from '../components/public-seo/health-feature.content';

/** Shared by the home route and SEO fallback; no chart or account dependencies. */
export const HOME_SEO_DESCRIPTION = 'Bring your activities, sleep and health data together. Analyze training, build structured workouts and plan your next session with Quantified Self.';

export const HOME_SEO_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Quantified Self',
  applicationCategory: 'HealthApplication',
  operatingSystem: 'Web',
  description: HOME_SEO_DESCRIPTION,
  featureList: [
    'Week, Month, and Year activity calendar with duration-scaled activity groups',
    'Curated training analysis for readiness, load, intensity, durability, sleep context, and best builds',
    'Training plans with named date phases and standalone structured workouts for running and cycling',
    'Automatic Garmin to Suunto activity sync',
    'Automatic COROS to Suunto activity sync',
    'Automatic Wahoo to Suunto activity sync',
    'Activity and route delivery to Wahoo',
    'Permission-scoped MCP access for compatible clients',
    'Sync past activities to Suunto by date',
    ...HEALTH_FEATURE_CONTENT.seo.featureList,
  ],
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  url: 'https://quantified-self.io/',
};
