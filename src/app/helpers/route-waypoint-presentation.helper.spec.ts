import { describe, expect, it } from 'vitest';
import { resolveRouteWaypointPresentation } from './route-waypoint-presentation.helper';

describe('route waypoint presentation helper', () => {
  it('uses GPX symbol before GPX type when both are present', () => {
    const presentation = resolveRouteWaypointPresentation({
      name: 'High point water',
      symbol: 'Water',
      type: 'Summit',
    });

    expect(presentation).toMatchObject({
      category: 'water',
      icon: 'water_drop',
      label: 'Water',
      sourceLabel: 'Water',
      isRouteShapingPoint: false,
    });
  });

  it('maps FIT decoded course-point enum names', () => {
    const presentation = resolveRouteWaypointPresentation({ type: 'rest_area' });

    expect(presentation).toMatchObject({
      category: 'rest_area',
      icon: 'camping',
      label: 'Rest area',
      sourceLabel: 'rest_area',
    });
  });

  it('maps FIT numeric course-point values', () => {
    const presentation = resolveRouteWaypointPresentation({ type: '29' });

    expect(presentation).toMatchObject({
      category: 'rest_area',
      icon: 'camping',
      label: 'Rest area',
      sourceLabel: '29',
    });
  });

  it('classifies Garmin shaping points as hidden route-shaping metadata', () => {
    expect(resolveRouteWaypointPresentation({ type: '26' })).toMatchObject({
      category: 'shaping_point',
      label: 'Shaping point',
      isRouteShapingPoint: true,
    });
    expect(resolveRouteWaypointPresentation({ type: 'shaping_point' })).toMatchObject({
      category: 'shaping_point',
      label: 'Shaping point',
      isRouteShapingPoint: true,
    });
  });

  it('falls back safely for unknown custom symbols while preserving the source label', () => {
    const presentation = resolveRouteWaypointPresentation({
      name: 'Custom point',
      symbol: 'Blue Diamond',
      type: 'Waypoint',
    });

    expect(presentation).toMatchObject({
      category: 'generic',
      icon: 'place',
      label: 'Waypoint',
      sourceLabel: 'Blue Diamond',
      isRouteShapingPoint: false,
    });
  });

  it('keeps an unknown GPX symbol ahead of name keyword matching', () => {
    const presentation = resolveRouteWaypointPresentation({
      name: 'Water stop',
      symbol: 'Blue Diamond',
      type: 'Waypoint',
    });

    expect(presentation).toMatchObject({
      category: 'generic',
      icon: 'place',
      label: 'Waypoint',
      sourceLabel: 'Blue Diamond',
    });
  });
});
