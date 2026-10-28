/** Validate the destination without rebuilding Garmin's preformed pull URL. */
export function normalizeGarminActivityCallbackURL(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > 8 * 1024) return null;
  for (let index = 0; index < value.length; index += 1) {
    const characterCode = value.charCodeAt(index);
    if (characterCode <= 0x20 || characterCode === 0x7f) return null;
  }
  try {
    const url = new URL(value);
    const ids = url.searchParams.getAll('id');
    const tokens = url.searchParams.getAll('token');
    if (url.protocol !== 'https:' || url.hostname !== 'apis.garmin.com'
      || (url.port && url.port !== '443') || url.username || url.password || url.hash
      || url.pathname !== '/wellness-api/rest/activityFile'
      || ids.length !== 1 || !ids[0] || ids[0].length > 512
      || tokens.length > 1 || (tokens.length === 1 && (!tokens[0] || tokens[0].length > 4096))) return null;
    return value;
  } catch {
    return null;
  }
}
