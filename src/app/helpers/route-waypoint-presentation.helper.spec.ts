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
      turnGlyphPath: undefined,
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

  it('maps Suunto GPX turn-by-turn waypoint types to directional compact markers', () => {
    expect(resolveRouteWaypointPresentation({ type: 'Right_turn' })).toMatchObject({
      category: 'right',
      icon: 'turn_right',
      label: 'Right turn',
      sourceLabel: 'Right_turn',
      isRouteTurnInstruction: true,
      markerVariant: 'compact',
      turnGlyphPath: 'M8 12h9m-3.5-3.5L17 12l-3.5 3.5',
    });
    expect(resolveRouteWaypointPresentation({ type: 'Sharp_left_turn' })).toMatchObject({
      category: 'sharp_left',
      icon: 'turn_sharp_left',
      label: 'Sharp left turn',
      sourceLabel: 'Sharp_left_turn',
      isRouteTurnInstruction: true,
      markerVariant: 'compact',
      turnGlyphPath: 'M16 12H7m3.5-3.5L7 12l3.5 3.5',
    });
    expect(resolveRouteWaypointPresentation({ type: 'Slight-right-turn' })).toMatchObject({
      category: 'slight_right',
      icon: 'turn_slight_right',
      label: 'Slight right turn',
      sourceLabel: 'Slight-right-turn',
      isRouteTurnInstruction: true,
      markerVariant: 'compact',
    });
    expect(resolveRouteWaypointPresentation({ type: 'Left at fork turn' })).toMatchObject({
      category: 'fork_left',
      icon: 'turn_left',
      label: 'Left at fork',
      sourceLabel: 'Left at fork turn',
      isRouteTurnInstruction: true,
      markerVariant: 'compact',
      turnGlyphPath: 'M16 16 8 8m0 5V8h5',
    });
    expect(resolveRouteWaypointPresentation({ type: 'Right_at_fork_turn' })).toMatchObject({
      category: 'fork_right',
      icon: 'turn_right',
      label: 'Right at fork',
      sourceLabel: 'Right_at_fork_turn',
      isRouteTurnInstruction: true,
      markerVariant: 'compact',
      turnGlyphPath: 'M8 16l8-8m-5 0h5v5',
    });
    expect(resolveRouteWaypointPresentation({ type: 'U_turn' })).toMatchObject({
      category: 'u_turn',
      icon: 'u_turn_left',
      label: 'U-turn',
      sourceLabel: 'U_turn',
      isRouteTurnInstruction: true,
      markerVariant: 'compact',
      turnGlyphPath: 'M16 17v-5a4 4 0 0 0-4-4H7m3.5-3.5L7 8l3.5 3.5',
    });
  });

  it('maps Suunto begin and end waypoint types to route endpoint presentations', () => {
    expect(resolveRouteWaypointPresentation({ type: 'Begin' })).toMatchObject({
      category: 'start',
      icon: 'flag',
      label: 'Start',
      sourceLabel: 'Begin',
      isRouteTurnInstruction: false,
      markerVariant: 'pin',
    });
    expect(resolveRouteWaypointPresentation({ type: 'End' })).toMatchObject({
      category: 'finish',
      icon: 'sports_score',
      label: 'Finish',
      sourceLabel: 'End',
      isRouteTurnInstruction: false,
      markerVariant: 'pin',
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

  it('maps FIT numeric turn course-point values to fine-grained directional compact markers', () => {
    expect(resolveRouteWaypointPresentation({ type: '16' })).toMatchObject({
      category: 'fork_left',
      icon: 'turn_left',
      label: 'Left at fork',
      isRouteTurnInstruction: true,
      markerVariant: 'compact',
      turnGlyphPath: 'M16 16 8 8m0 5V8h5',
    });
    expect(resolveRouteWaypointPresentation({ type: '20' })).toMatchObject({
      category: 'sharp_left',
      icon: 'turn_sharp_left',
      label: 'Sharp left turn',
      isRouteTurnInstruction: true,
      markerVariant: 'compact',
      turnGlyphPath: 'M16 12H7m3.5-3.5L7 12l3.5 3.5',
    });
    expect(resolveRouteWaypointPresentation({ type: '22' })).toMatchObject({
      category: 'sharp_right',
      icon: 'turn_sharp_right',
      label: 'Sharp right turn',
      isRouteTurnInstruction: true,
      markerVariant: 'compact',
      turnGlyphPath: 'M8 12h9m-3.5-3.5L17 12l-3.5 3.5',
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
