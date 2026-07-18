import { describe, expect, it } from 'vitest';
import {
  hasEventTrackMapLayerSettingsDelta,
  hasTrackMapLayerSettingsDelta,
  normalizeEventTrackMapViewSettings,
  normalizeTrackMapViewSettings,
  resolveTrackMapInitialCamera,
} from './track-map-view-state.helper';

describe('track-map-view-state.helper', () => {
  it('normalizes common track map settings with stable defaults', () => {
    expect(normalizeTrackMapViewSettings({
      showArrows: false,
      strokeWidth: '4',
      mapStyle: 'SATELLITE',
      is3D: true,
    })).toEqual({
      showArrows: false,
      strokeWidth: 4,
      mapStyle: 'satellite',
      is3D: true,
    });

    expect(normalizeTrackMapViewSettings({
      showArrows: 'false',
      strokeWidth: 0,
      mapStyle: 'bogus',
      is3D: 'true',
    })).toEqual({
      showArrows: true,
      strokeWidth: 2,
      mapStyle: 'default',
      is3D: false,
    });
  });

  it('normalizes event-only lap settings on top of shared track settings', () => {
    expect(normalizeEventTrackMapViewSettings({
      showLaps: false,
      showArrows: false,
      strokeWidth: 5,
      mapStyle: 'outdoors',
      is3D: true,
    })).toEqual({
      showLaps: false,
      showArrows: false,
      strokeWidth: 5,
      mapStyle: 'outdoors',
      is3D: true,
    });
  });

  it('detects only layer-affecting setting changes', () => {
    const previous = normalizeTrackMapViewSettings({ showArrows: true, strokeWidth: 2, mapStyle: 'default', is3D: false });
    expect(hasTrackMapLayerSettingsDelta(previous, { ...previous, mapStyle: 'satellite' })).toBe(false);
    expect(hasTrackMapLayerSettingsDelta(previous, { ...previous, is3D: true })).toBe(false);
    expect(hasTrackMapLayerSettingsDelta(previous, { ...previous, strokeWidth: 3 })).toBe(true);

    const eventPrevious = normalizeEventTrackMapViewSettings({ showLaps: true });
    expect(hasEventTrackMapLayerSettingsDelta(eventPrevious, { ...eventPrevious, showLaps: false })).toBe(true);
  });

  it('resolves a first valid track camera with a global fallback', () => {
    expect(resolveTrackMapInitialCamera([
      { latitudeDegrees: Number.NaN, longitudeDegrees: 22 },
      { latitudeDegrees: 120, longitudeDegrees: 22 },
      { latitudeDegrees: 40, longitudeDegrees: 181 },
      { latitudeDegrees: 40.1, longitudeDegrees: 22.1 },
    ])).toEqual({
      center: [22.1, 40.1],
      zoom: 12,
    });

    expect(resolveTrackMapInitialCamera([])).toEqual({
      center: [0, 0],
      zoom: 2,
    });

    expect(resolveTrackMapInitialCamera([
      { latitudeDegrees: -91, longitudeDegrees: 22 },
      { latitudeDegrees: 40, longitudeDegrees: -181 },
    ])).toEqual({
      center: [0, 0],
      zoom: 2,
    });
  });
});
