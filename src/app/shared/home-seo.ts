import { HEALTH_FEATURE_CONTENT } from '../components/public-seo/health-feature.content';

/** Shared by the home route and SEO fallback; no chart or account dependencies. */
export const HOME_SEO_DESCRIPTION = 'Connect Garmin, Suunto, COROS and Wahoo. Analyze training, sleep and HRV in one dashboard; log blood pressure and weight, and add timeline notes.';

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
    'Automatic Garmin to Suunto activity sync',
    'Automatic COROS to Suunto activity sync',
    'Automatic Wahoo to Suunto activity sync',
    'Activity and route delivery to Wahoo',
    'Read-only MCP access for compatible clients',
    'Sync past activities to Suunto by date',
    ...HEALTH_FEATURE_CONTENT.seo.featureList,
  ],
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  url: 'https://quantified-self.io/',
};
