import { getEventChartUnitSource } from './event-chart-units.helper';

export interface EventChartOverlayOption {
  dataType: string;
  label: string;
  unit: string;
  color: string;
}

export type EventChartOverlayDataTypeByPrimary = Record<string, string>;

const UNSAFE_OVERLAY_MAP_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Unit changes preserve the source identity; ambiguous shared variants are not guessed. */
export const getEventChartOverlaySelectionKey = getEventChartUnitSource;

/** Resolve aliases only when both the available unit and any inherited saved choices agree. */
export function resolveEventChartOverlayDataType(
  primary: string,
  availableTypes: readonly string[],
  overlayMap: EventChartOverlayDataTypeByPrimary,
): string | null {
  const available = new Set(availableTypes);
  const resolveTarget = (saved: string): string | null => {
    const matches = available.has(saved) ? [saved] : availableTypes.filter(type =>
      getEventChartOverlaySelectionKey(type) === getEventChartOverlaySelectionKey(saved));
    return matches.length === 1 && matches[0] !== primary ? matches[0] : null;
  };
  if (Object.prototype.hasOwnProperty.call(overlayMap, primary)) return resolveTarget(overlayMap[primary]);

  const source = getEventChartOverlaySelectionKey(primary);
  if (availableTypes.filter(type => getEventChartOverlaySelectionKey(type) === source).length !== 1) return null;
  const inherited = new Set(Object.entries(overlayMap)
    .filter(([key]) => getEventChartOverlaySelectionKey(key) === source)
    .map(([, target]) => resolveTarget(target)));
  return inherited.size === 1 ? [...inherited][0] : null;
}

export function normalizeEventChartOverlayDataTypeByPrimary(
  value: unknown
): EventChartOverlayDataTypeByPrimary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value as Record<string, unknown>)
    .reduce<EventChartOverlayDataTypeByPrimary>((normalized, [primaryDataType, overlayDataType]) => {
      const primary = `${primaryDataType || ''}`.trim();
      const overlay = typeof overlayDataType === 'string' ? overlayDataType.trim() : '';

      if (
        !primary
        || !overlay
        || primary === overlay
        || UNSAFE_OVERLAY_MAP_KEYS.has(primary)
        || UNSAFE_OVERLAY_MAP_KEYS.has(overlay)
      ) {
        return normalized;
      }

      normalized[primary] = overlay;
      return normalized;
    }, {});
}

export function areEventChartOverlayMapsEqual(left: unknown, right: unknown): boolean {
  const normalizedLeft = normalizeEventChartOverlayDataTypeByPrimary(left);
  const normalizedRight = normalizeEventChartOverlayDataTypeByPrimary(right);
  const leftKeys = Object.keys(normalizedLeft).sort((a, b) => a.localeCompare(b));
  const rightKeys = Object.keys(normalizedRight).sort((a, b) => a.localeCompare(b));

  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key, index) => key === rightKeys[index] && normalizedLeft[key] === normalizedRight[key]);
}
