import { ChangeDetectorRef, NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivityInterface, EventInterface, SwimPaceUnits, UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
    expect(component.swimLengthViews).toHaveLength(1);
    expect(component.swimLengthViews[0].activity).toBe(activity);
    expect(component.swimLengthViews[0].dataSource.data).toHaveLength(1);
    expect(component.swimLengthViews[0].columnNames).toContain('Swim Pace');
    expect(component.swimLengthViews[0].columnNames).toContain('Stroke');
    expect(component.swimLengthViews[0].columns.find(column => column.name === '#')?.sticky).toBe(true);
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

    expect(component.swimLengthViews[0].dataSource.data[0]['Swim Pace']).toContain('min/100yrd');
  });

  it('should hide the section when no selected activity has swim lengths', () => {
    component.selectedActivities = [createActivity([])];

    component.ngOnChanges();
    fixture.detectChanges();

    expect(component.activitiesWithSwimLengths).toEqual([]);
    expect(component.swimLengthViews).toEqual([]);
    expect(fixture.nativeElement.querySelector('app-event-section-header')).toBeNull();
  });

  it('should bind precomputed view fields in the template', () => {
    const template = readFileSync(
      resolve(process.cwd(), 'src/app/components/event/swim-lengths/event.card.swim-lengths.component.html'),
      'utf8',
    );

    expect(template).toContain('@for (view of swimLengthViews; track view.key)');
    expect(template).toContain('[dataSource]="view.dataSource"');
    expect(template).toContain('*matHeaderRowDef="view.columnNames"');
    expect(template).not.toContain('getDataSource(');
    expect(template).not.toContain('getColumns(');
    expect(template).not.toContain('getActivityTabLabel(');
    expect(template).not.toContain('isSticky(');
  });
});
