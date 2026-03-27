export function resolveMapboxAccessToken(): string {
  return `${process.env.MAPBOX_ACCESS_TOKEN || ''}`.trim();
}
