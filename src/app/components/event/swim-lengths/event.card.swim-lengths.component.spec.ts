import { ChangeDetectorRef, NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivityInterface, EventInterface, SwimPaceUnits, UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { vi } from 'vitest';
import { EventCardSwimLengthsComponent } from './event.card.swim-lengths.component';

function createActivity(swimLengths: unknown[]): ActivityInterface {
  return {
    type: 'Swimming',
    getID: () => 'activity-1',
    getSwimLengths: () => swimLengths,
  } as unknown as ActivityInterface;
}

describe('EventCardSwimLengthsComponent', () => {
  let component: EventCardSwimLengthsComponent;
  let fixture: ComponentFixture<EventCardSwimLengthsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [EventCardSwimLengthsComponent],
      providers: [
        { provide: ChangeDetectorRef, useValue: { markForCheck: vi.fn(), detectChanges: vi.fn() } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(EventCardSwimLengthsComponent);
    component = fixture.componentInstance;
    component.selectedActivities = [];
    component.unitSettings = {} as UserUnitSettingsInterface;
    component.event = { getActivities: () => [] } as EventInterface;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render rows for activities with swim lengths', () => {
    const activity = createActivity([
      {
        index: 1,
        lapIndex: 1,
        startDate: 1778945229000,
        endDate: 1778945254000,
        type: 'active',
        stroke: 'freestyle',
        strokes: 8,
        elapsedTime: 25,
        timerTime: 25,
        distance: 25,
        poolLength: 25,
        avgSpeed: 1,
        avgCadence: 20,
        avgHeartRate: 140,
        maxHeartRate: 150,
        swolf: 39,
        calories: 4,
      },
    ]);

    component.selectedActivities = [activity];
    component.ngOnChanges();

    expect(component.activitiesWithSwimLengths).toEqual([activity]);
    expect(component.getDataSource(activity)?.data).toHaveLength(1);
    expect(component.getColumns(activity)).toContain('Swim Pace');
    expect(component.getColumns(activity)).toContain('Stroke');
  });

  it('should format swim pace with selected 100-yard units', () => {
    const activity = createActivity([
      {
        index: 1,
        lapIndex: 1,
        startDate: 1778945229000,
        endDate: 1778945254000,
        type: 'active',
        stroke: 'freestyle',
        strokes: 8,
        elapsedTime: 25,
        timerTime: 25,
        distance: 25,
        poolLength: 25,
        avgSpeed: 1,
        avgCadence: 20,
        avgHeartRate: 140,
        maxHeartRate: 150,
        swolf: 39,
        calories: 4,
      },
    ]);

    component.unitSettings = {
      swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard],
    } as UserUnitSettingsInterface;
    component.selectedActivities = [activity];
    component.ngOnChanges();

    expect(component.getDataSource(activity)?.data[0]['Swim Pace']).toContain('min/100yrd');
  });

  it('should hide the section when no selected activity has swim lengths', () => {
    component.selectedActivities = [createActivity([])];

    component.ngOnChanges();
    fixture.detectChanges();

    expect(component.activitiesWithSwimLengths).toEqual([]);
    expect(fixture.nativeElement.querySelector('app-event-section-header')).toBeNull();
  });
});
