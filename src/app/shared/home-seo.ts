import { HEALTH_FEATURE_CONTENT } from '../components/public-seo/health-feature.content';

/** Shared by the home route and SEO fallback; no chart or account dependencies. */
export const HOME_SEO_DESCRIPTION = 'Bring activities, sleep and health together. Analyze training, generate AI workouts and build plans. Pro includes opt-in daily workout suggestions.';

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
    'Training plans with named date phases and standalone structured workouts for endurance and strength',
    'AI workout generation using selected recovery, training and Timeline context',
    'Opt-in daily workout or rest suggestions included with Pro',
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
