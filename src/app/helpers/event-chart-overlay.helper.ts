import { DataDistance, DataDistanceFeet, DataDistanceMiles, DataGNSSDistance, DataGNSSDistanceMiles } from '@sports-alliance/sports-lib/metrics';

export interface EventChartOverlayOption {
  dataType: string;
  label: string;
  unit: string;
  color: string;
}

export type EventChartOverlayDataTypeByPrimary = Record<string, string>;

const UNSAFE_OVERLAY_MAP_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const DISTANCE_OVERLAY_TYPES = new Set([DataDistance.type, DataDistanceFeet.type, DataDistanceMiles.type]);

/** Retain saved distance-source choices when unit preferences replace their rendered panels. */
export function getEventChartOverlaySelectionKey(dataType: string): string {
  if (DISTANCE_OVERLAY_TYPES.has(dataType)) return DataDistance.type;
  return dataType === DataGNSSDistanceMiles.type ? DataGNSSDistance.type : dataType;
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
