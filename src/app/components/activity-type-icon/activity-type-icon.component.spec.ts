import { ActivityTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it, vi } from 'vitest';
import { resolveActivityTypeIconColor } from '../../helpers/activity-type-presentation.helper';
import { ActivityTypeIconComponent } from './activity-type-icon.component';

describe('ActivityTypeIconComponent', () => {
  it('returns fallback icon for empty activity type', () => {
    const component = new ActivityTypeIconComponent();
    component.activityType = '';
    expect(component.getIcon()).toBe('category');
  });

  it('keeps Trail Running unchanged (group fallback)', () => {
    const component = new ActivityTypeIconComponent();
    component.activityType = 'Trail Running';
    expect(component.getIcon()).toBe('directions_run');
  });

  it('uses activity-family icons for Training discipline labels', () => {
    const component = new ActivityTypeIconComponent();
    const expectedIcons = new Map([
      ['Running', 'directions_run'],
      ['Cycling', 'directions_bike'],
      ['Swimming', 'pool'],
    ]);

    for (const [activityType, expectedIcon] of expectedIcons) {
      component.activityType = activityType;
      expect(component.getIcon()).toBe(expectedIcon);
    }
  });

  it('exposes the matching activity-family color for native Material option icons', () => {
    expect(resolveActivityTypeIconColor('Cycling')).toBe('#FF7C3B');
    expect(resolveActivityTypeIconColor('Swimming')).toBe('#40C4FF');
  });

  it('uses the Diving icon for snorkeling and mermaiding aliases', () => {
    const component = new ActivityTypeIconComponent();

    for (const activityType of ['Snorkeling', 'snorkeling', 'Mermaiding', 'mermaiding']) {
      component.activityType = activityType;
      expect(component.getIcon()).toBe('scuba_diving');
    }
  });

  it('resolves virtual activities to computer icon', () => {
    const component = new ActivityTypeIconComponent();
    component.activityType = 'VirtualRide';
    expect(component.getIcon()).toBe('computer');

    component.activityType = 'virtual_cycling';
    expect(component.getIcon()).toBe('computer');
  });

  it('resolves selected individual sport overrides', () => {
    const component = new ActivityTypeIconComponent();

    component.activityType = 'Open Water Swimming';
    expect(component.getIcon()).toBe('waves');

    component.activityType = 'Kayaking';
    expect(component.getIcon()).toBe('kayaking');

    component.activityType = 'American Football';
    expect(component.getIcon()).toBe('sports_football');

    component.activityType = 'Tennis';
    expect(component.getIcon()).toBe('sports_tennis');

    component.activityType = 'Weight Training';
    expect(component.getIcon()).toBe('fitness_center');

    component.activityType = 'Strength Training';
    expect(component.getIcon()).toBe('exercise');

    component.activityType = 'Kettlebell';
    expect(component.getIcon()).toBe('weight');
  });

  it('uses mountain-biking group icon for MTB variants', () => {
    const component = new ActivityTypeIconComponent();

    component.activityType = 'Mountain Biking';
    expect(component.getIcon()).toBe('terrain');

    component.activityType = 'cycling_mountain_enduro';
    expect(component.getIcon()).toBe('terrain');

    component.activityType = 'Downhill Cycling';
    expect(component.getIcon()).toBe('terrain');
  });

  it.each([
    ['Road Running', 'directions_run'],
    ['Indoor Track Running', 'directions_run'],
    ['Vertical Running', 'directions_run'],
    ['Road Cycling', 'directions_bike'],
    ['Gravel Cycling', 'directions_bike'],
    ['Indoor Walking', 'directions_walk'],
    ['Speed Walking', 'directions_walk'],
    ['Mountain Bike Orienteering', 'terrain'],
    ['E-Mountain Biking', 'electric_bike'],
    ['E-Enduro MTB', 'electric_bike'],
    ['Stretching', 'self_improvement'],
    ['Meditation', 'self_improvement'],
    ['Breathwork', 'self_improvement'],
    ['Table Tennis', 'sports'],
    ['American Football', 'sports_football'],
  ])('uses approved bundled icons for %s', (type, icon) => {
    const component = new ActivityTypeIconComponent();
    component.activityType = type;
    expect(component.getIcon()).toBe(icon);
  });

  it('falls back safely for numeric activity type values', () => {
    const component = new ActivityTypeIconComponent();
    component.activityType = 4;
    expect(component.getIcon()).toBe('category');
  });

  it('handles array activity type values', () => {
    const component = new ActivityTypeIconComponent();
    component.activityType = ['VirtualRide', 'Run'];
    expect(component.getIcon()).toBe('computer');
  });

  it('handles object activity type values', () => {
    const component = new ActivityTypeIconComponent();
    component.activityType = { type: 'Open Water Swimming' };
    expect(component.getIcon()).toBe('waves');
  });

  it('resolves icon color from activity context via AppEventColorService', () => {
    const mockColorService = {
      getActivityColor: vi.fn().mockReturnValue('#ff5500'),
      getColorForActivityTypeByActivityTypeGroup: vi.fn().mockReturnValue('#00aa00'),
    } as any;
    const activities = [
      { getID: () => 'a1' },
      { getID: () => 'a2' },
    ] as any[];
    const component = new ActivityTypeIconComponent(mockColorService);
    component.activityType = 'Run';
    component.activities = activities as any;
    component.activity = activities[1] as any;

    expect(component.resolvedIconColor).toBe('#ff5500');
    expect(mockColorService.getActivityColor).toHaveBeenCalledWith(activities, activities[1]);
    expect(mockColorService.getColorForActivityTypeByActivityTypeGroup).not.toHaveBeenCalled();
  });

  it('falls back to activity type group color when no activity context exists', () => {
    const mockColorService = {
      getActivityColor: vi.fn(),
      getColorForActivityTypeByActivityTypeGroup: vi.fn().mockReturnValue('#22aa44'),
    } as any;
    const component = new ActivityTypeIconComponent(mockColorService);
    component.activityType = 'Run';

    expect(component.resolvedIconColor).toBe('#22aa44');
    expect(mockColorService.getColorForActivityTypeByActivityTypeGroup).toHaveBeenCalledWith(ActivityTypes.Running);
    expect(mockColorService.getActivityColor).not.toHaveBeenCalled();
  });
});
