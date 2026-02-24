import { describe, expect, it } from 'vitest';
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
});
