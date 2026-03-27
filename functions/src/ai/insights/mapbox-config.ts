import { defineSecret } from 'firebase-functions/params';

export const mapboxAccessTokenSecret = defineSecret('MAPBOX_ACCESS_TOKEN');

export function resolveMapboxAccessToken(): string {
  const envToken = `${process.env.MAPBOX_ACCESS_TOKEN || ''}`.trim();
  if (envToken) {
    return envToken;
  }

  try {
    return `${mapboxAccessTokenSecret.value() || ''}`.trim();
  } catch {
    return '';
  }
}
