import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ActivityToggleComponent } from './activity-toggle.component';
import { AppActivitySelectionService } from '../../../services/activity-selection-service/app-activity-selection.service';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { MatSlideToggleChange } from '@angular/material/slide-toggle';

const createActivity = (id: string): any => ({
  getID: () => id,
  type: 'Run',
  creator: { name: 'Garmin', swInfo: '1.0' },
  startDate: new Date('2025-01-01T10:00:00.000Z'),
  getDuration: () => ({ getDisplayValue: () => '1:00:00' }),
  getDistance: () => ({ getDisplayValue: () => 10, getDisplayUnit: () => 'km' }),
});

describe('ActivityToggleComponent', () => {
  let component: ActivityToggleComponent;
  let fixture: ComponentFixture<ActivityToggleComponent>;

  const mockSelectionService = {
    selectedActivities: {
      select: vi.fn(),
      deselect: vi.fn(),
    },
  };

  const mockColorService = {
    getActivityColor: vi.fn(() => '#ff0000'),
  };

  const setRequiredInputs = (activity: any, selectedActivities: any[]) => {
    const event = {
      isMerge: true,
      getActivities: () => [activity],
    } as any;

    fixture.componentRef.setInput('event', event);
    fixture.componentRef.setInput('activity', activity);
    fixture.componentRef.setInput('selectedActivities', selectedActivities);
    fixture.detectChanges();
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    await TestBed.configureTestingModule({
      declarations: [ActivityToggleComponent],
      providers: [
        { provide: AppActivitySelectionService, useValue: mockSelectionService },
        { provide: AppEventColorService, useValue: mockColorService },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ActivityToggleComponent);
    component = fixture.componentInstance;
  });

  it('treats same-ID activity as selected even when object references differ', () => {
    const renderedActivity = createActivity('a1');
    const selectedClone = createActivity('a1');

    setRequiredInputs(renderedActivity, [selectedClone]);

    expect(component.isSelected()).toBe(true);
  });

  it('deselects using the selected reference when IDs match but refs differ', () => {
    const renderedActivity = createActivity('a1');
    const selectedClone = createActivity('a1');

    setRequiredInputs(renderedActivity, [selectedClone]);

    component.onActivityClick(renderedActivity);

    expect(mockSelectionService.selectedActivities.deselect).toHaveBeenCalledWith(selectedClone);
    expect(mockSelectionService.selectedActivities.select).not.toHaveBeenCalled();
  });

  it('does not select again from slide toggle when same ID is already selected', () => {
    const renderedActivity = createActivity('a1');
    const selectedClone = createActivity('a1');

    setRequiredInputs(renderedActivity, [selectedClone]);

    component.onActivitySelect({ checked: true } as MatSlideToggleChange, renderedActivity);

    expect(mockSelectionService.selectedActivities.select).not.toHaveBeenCalled();
    expect(mockSelectionService.selectedActivities.deselect).not.toHaveBeenCalled();
  });
});
