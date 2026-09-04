export interface SocialImageRouteData {
  socialImage?: string;
  socialImageAlt?: string;
}

const SITE_ORIGIN = 'https://quantified-self.io';
const SOCIAL_IMAGE_PATH = `${SITE_ORIGIN}/assets/images/social`;

export const DEFAULT_SOCIAL_IMAGE = `${SITE_ORIGIN}/assets/images/og-image-v4.jpg`;
export const DEFAULT_SOCIAL_IMAGE_ALT = 'Quantified Self activity map visualization';

export const SOCIAL_IMAGES = {
  trainingAnalysis: {
    socialImage: `${SOCIAL_IMAGE_PATH}/training-analysis-social-v1.jpg`,
    socialImageAlt: 'Quantified Self Training charts for freshness, intensity, efficiency, and cycling power.',
  },
  integrations: {
    socialImage: `${SOCIAL_IMAGE_PATH}/integrations-social-v1.jpg`,
    socialImageAlt: 'Quantified Self provider-path matrix for Garmin, Suunto, COROS, and Wahoo.',
  },
  mcpServer: {
    socialImage: `${SOCIAL_IMAGE_PATH}/mcp-server-social-v1.jpg`,
    socialImageAlt: 'Quantified Self MCP flow from ChatGPT or Claude to approved read-only data access.',
  },
  activityMap: {
    socialImage: `${SOCIAL_IMAGE_PATH}/activity-map-social-v1.jpg`,
    socialImageAlt: 'Quantified Self My Tracks map with anonymized routes and a destination-visit panel.',
  },
  workoutDataComparison: {
    socialImage: `${SOCIAL_IMAGE_PATH}/workout-data-comparison-social-v1.jpg`,
    socialImageAlt: 'Quantified Self multi-device workout comparison charts for heart rate and altitude.',
  },
} as const satisfies Record<string, Required<SocialImageRouteData>>;
