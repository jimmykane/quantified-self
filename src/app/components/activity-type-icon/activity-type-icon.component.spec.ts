import { ActivityTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it, vi } from 'vitest';
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
