import { APP_HEALTH_HIGHLIGHT_IDS, AppHealthHighlightSources } from '../models/app-user.interface';

/** Only opaque, stable view-source identities belong in this display preference. */
export function normalizeHealthHighlightSources(value: unknown): AppHealthHighlightSources {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: AppHealthHighlightSources = {};
  for (const id of APP_HEALTH_HIGHLIGHT_IDS) {
    const key: unknown = Object.prototype.hasOwnProperty.call(value, id) ? value[id] : undefined;
    if (typeof key === 'string' && /^health-series-[a-f0-9]{16}$/.test(key)) result[id] = key;
  }
  return result;
}
