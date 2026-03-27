import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ActivityInterface,
  DynamicDataLoader,
  EventInterface,
  UserUnitSettingsInterface,
} from '@sports-alliance/sports-lib';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { EventCardJumpsComponent } from './event.card.jumps.component';

function createStat(displayValue: string, displayUnit = '', numericValue?: number): any {
  return {
    getDisplayValue: vi.fn(() => displayValue),
    getDisplayUnit: vi.fn(() => displayUnit),
    getValue: vi.fn(() => numericValue),
  };
}

function createJumpEvent(timestamp: number, overrides: Record<string, unknown> = {}): any {
  return {
    timestamp,
    jumpData: {
      distance: createStat('10', 'm', 10),
      score: createStat('8.2', '', 8.2),
      ...overrides,
    },
  };
}

function createActivity(activityID: string, activityType: string, events: any[]): ActivityInterface {
  return {
    type: activityType,
    creator: {
      name: `${activityType} Device`,
      swInfo: '1.0.0',
    },
    getID: () => activityID,
    getAllEvents: () => events,
  } as unknown as ActivityInterface;
}

describe('EventCardJumpsComponent', () => {
  let component: EventCardJumpsComponent;
  let fixture: ComponentFixture<EventCardJumpsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [EventCardJumpsComponent],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(EventCardJumpsComponent);
    component = fixture.componentInstance;
    component.event = { isMerge: false } as EventInterface;
    component.unitSettings = {} as UserUnitSettingsInterface;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders tabs only for selected activities that contain jump events', () => {
    const jumpActivity = createActivity('activity-1', 'Running', [createJumpEvent(90)]);
    const noJumpActivity = createActivity('activity-2', 'Cycling', []);

    component.selectedActivities = [jumpActivity, noJumpActivity];
    component.ngOnChanges();
    fixture.detectChanges();

    expect(component.activitiesWithJumps).toEqual([jumpActivity]);
    expect(fixture.nativeElement.querySelectorAll('mat-tab')).toHaveLength(1);
  });

  it('shows all supported jump columns when values exist', () => {
    const jumpActivity = createActivity('activity-1', 'Snowboarding', [createJumpEvent(120, {
      height: createStat('3.1', 'm', 3.1),
      hang_time: { getDisplayValue: vi.fn(() => '01.2s') },
      speed: createStat('12.4', 'm/s', 12.4),
      rotations: createStat('1.5', '', 1.5),
    })]);

    component.selectedActivities = [jumpActivity];
    component.ngOnChanges();

    const columns = component.getColumns(jumpActivity);
    expect(columns).toEqual([
      '#',
      'At',
      'Jump Distance',
      'Jump Height',
      'Jump Hang Time',
      'Jump Speed',
      'Jump Rotations',
      'Jump Score',
    ]);
  });

  it('hides the rotations column when no jump row has rotations', () => {
    const jumpActivity = createActivity('activity-1', 'Kitesurfing', [
      createJumpEvent(75, {
        height: createStat('2.0', 'm', 2),
        hang_time: { getDisplayValue: vi.fn(() => '00.9s') },
      }),
      createJumpEvent(110, {
        speed: createStat('10.8', 'm/s', 10.8),
      }),
    ]);

    component.selectedActivities = [jumpActivity];
    component.ngOnChanges();

    const columns = component.getColumns(jumpActivity);
    expect(columns.includes('Jump Rotations')).toBe(false);
  });

  it('ignores malformed jump-like events with empty jumpData payloads', () => {
    const jumpActivity = createActivity('activity-1', 'Kitesurfing', [
      { timestamp: 20, jumpData: null },
      { timestamp: 22, jumpData: '' },
    ]);

    component.selectedActivities = [jumpActivity];
    component.ngOnChanges();

    expect(component.activitiesWithJumps).toEqual([]);
    expect(component.getDataSource(jumpActivity)).toBeUndefined();
  });

  it('formats unit-based jump values using converted user unit preferences', () => {
    const distanceStat = createStat('10', 'm', 10);
    const speedStat = createStat('10', 'm/s', 10);
    const heightStat = createStat('2', 'm', 2);

    const jumpActivity = createActivity('activity-1', 'Skiing', [createJumpEvent(50, {
      distance: distanceStat,
      height: heightStat,
      speed: speedStat,
    })]);

    vi.spyOn(DynamicDataLoader, 'getUnitBasedDataFromDataInstance').mockImplementation((stat: any) => {
      if (stat === distanceStat) {
        return [createStat('32.8', 'ft', 32.8)];
      }
      if (stat === heightStat) {
        return [createStat('6.6', 'ft', 6.6)];
      }
      if (stat === speedStat) {
        return [createStat('22.4', 'mph', 22.4)];
      }
      return [stat];
    });

    component.selectedActivities = [jumpActivity];
    component.ngOnChanges();

    const row = component.getDataSource(jumpActivity)?.data?.[0];
    expect(row?.['Jump Distance']).toBe('32.8 ft');
    expect(row?.['Jump Height']).toBe('6.6 ft');
    expect(row?.['Jump Speed']).toBe('22.4 mph');
  });

  it('falls back to raw jump stat display values when conversion fails', () => {
    const distanceStat = createStat('10', 'm', 10);
    const jumpActivity = createActivity('activity-1', 'Skiing', [createJumpEvent(50, {
      distance: distanceStat,
    })]);

    vi.spyOn(DynamicDataLoader, 'getUnitBasedDataFromDataInstance').mockImplementation(() => {
      throw new Error('conversion failed');
    });

    component.selectedActivities = [jumpActivity];
    component.ngOnChanges();

    const row = component.getDataSource(jumpActivity)?.data?.[0];
    expect(row?.['Jump Distance']).toBe('10 m');
  });
});
