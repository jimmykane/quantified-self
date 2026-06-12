import { MapStyleName, SUPPORTED_MAP_STYLES } from './map-style.types';
import { TrackMapPosition } from './track-map.manager';

export interface TrackMapViewSettingsState {
  showArrows: boolean;
  strokeWidth: number;
  mapStyle: MapStyleName;
  is3D: boolean;
}

export interface EventTrackMapViewSettingsState extends TrackMapViewSettingsState {
  showLaps: boolean;
}

export interface TrackMapInitialCamera {
  center: [number, number];
  zoom: number;
}

const DEFAULT_TRACK_MAP_VIEW_SETTINGS: TrackMapViewSettingsState = {
  showArrows: true,
  strokeWidth: 2,
  mapStyle: 'default',
  is3D: false,
};

const DEFAULT_EVENT_TRACK_MAP_VIEW_SETTINGS: EventTrackMapViewSettingsState = {
  ...DEFAULT_TRACK_MAP_VIEW_SETTINGS,
  showLaps: true,
};

const SUPPORTED_MAP_STYLE_SET = new Set<MapStyleName>(SUPPORTED_MAP_STYLES);

export function normalizeTrackMapViewSettings(
  settings: unknown,
  defaults: Partial<TrackMapViewSettingsState> = {},
): TrackMapViewSettingsState {
  const source = asRecord(settings);
  const fallback = { ...DEFAULT_TRACK_MAP_VIEW_SETTINGS, ...defaults };
  return {
    showArrows: normalizeBoolean(source.showArrows, fallback.showArrows),
    strokeWidth: normalizeStrokeWidth(source.strokeWidth, fallback.strokeWidth),
    mapStyle: normalizeMapStyle(source.mapStyle, fallback.mapStyle),
    is3D: normalizeBoolean(source.is3D, fallback.is3D),
  };
}

export function normalizeEventTrackMapViewSettings(
  settings: unknown,
  defaults: Partial<EventTrackMapViewSettingsState> = {},
): EventTrackMapViewSettingsState {
  const source = asRecord(settings);
  const fallback = { ...DEFAULT_EVENT_TRACK_MAP_VIEW_SETTINGS, ...defaults };
  return {
    ...normalizeTrackMapViewSettings(source, fallback),
    showLaps: normalizeBoolean(source.showLaps, fallback.showLaps),
  };
}

export function hasTrackMapLayerSettingsDelta(
  previous: TrackMapViewSettingsState,
  next: TrackMapViewSettingsState,
): boolean {
  return previous.showArrows !== next.showArrows
    || previous.strokeWidth !== next.strokeWidth;
}

export function hasEventTrackMapLayerSettingsDelta(
  previous: EventTrackMapViewSettingsState,
  next: EventTrackMapViewSettingsState,
): boolean {
  return hasTrackMapLayerSettingsDelta(previous, next)
    || previous.showLaps !== next.showLaps;
}

export function resolveTrackMapInitialCamera(
  positions: Array<Partial<TrackMapPosition> | null | undefined>,
  options: { trackZoom?: number; fallbackZoom?: number } = {},
): TrackMapInitialCamera {
  const position = (positions || []).find((candidate) =>
    Number.isFinite(candidate?.latitudeDegrees)
    && Number.isFinite(candidate?.longitudeDegrees)
  );

  if (position) {
    return {
      center: [position.longitudeDegrees as number, position.latitudeDegrees as number],
      zoom: options.trackZoom ?? 12,
    };
  }

  return {
    center: [0, 0],
    zoom: options.fallbackZoom ?? 2,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeStrokeWidth(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function normalizeMapStyle(value: unknown, fallback: MapStyleName): MapStyleName {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase() as MapStyleName;
  return SUPPORTED_MAP_STYLE_SET.has(normalized) ? normalized : fallback;
}
