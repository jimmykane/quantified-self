import { ChangeDetectorRef, NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ActivityInterface,
  DataSpeed,
  DataSwimPace,
  DataSwimPaceMinutesPer100Yard,
  EventInterface,
  SwimPaceUnits,
  UserUnitSettingsInterface
} from '@sports-alliance/sports-lib';
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

function createSwimLength(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const index = typeof overrides.index === 'number' ? overrides.index : 1;
  const duration = typeof overrides.timerTime === 'number' ? overrides.timerTime : 25;
  const startDate = 1778945229000 + ((index - 1) * 25000);

  return {
    index,
    lapIndex: 1,
    startDate,
    endDate: startDate + (duration * 1000),
    type: 'active',
    stroke: 'freestyle',
    strokes: 8,
    elapsedTime: duration,
    timerTime: duration,
    distance: 25,
    poolLength: 25,
    avgSpeed: 1,
    avgCadence: 20,
    avgHeartRate: 140,
    maxHeartRate: 150,
    swolf: 39,
    calories: 4,
    ...overrides,
  };
}

describe('EventCardSwimLengthsComponent', () => {
  let component: EventCardSwimLengthsComponent;
  let fixture: ComponentFixture<EventCardSwimLengthsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonModule],
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
      createSwimLength(),
    ]);

    component.selectedActivities = [activity];
    component.ngOnChanges();

    expect(component.activitiesWithSwimLengths).toEqual([activity]);
    expect(component.swimLengthViews).toHaveLength(1);
    expect(component.swimLengthViews[0].activity).toBe(activity);
    expect(component.swimLengthViews[0].groups).toHaveLength(1);
    expect(component.swimLengthViews[0].groups[0].rows).toHaveLength(1);
    expect(component.swimLengthViews[0].groups[0].columnNames).toContain('Split');
    expect(component.swimLengthViews[0].groups[0].columnNames).toContain('Swim Pace');
    expect(component.swimLengthViews[0].groups[0].columnNames).toContain('Stroke');
    expect(component.swimLengthViews[0].groups[0].columns.find(column => column.name === '#')?.sticky).toBe(true);
    expect(component.swimLengthViews[0].groups[0].columns.find(column => column.name === '#')?.numeric).toBe(true);
    expect(component.swimLengthViews[0].groups[0].columns.find(column => column.name === 'Stroke')?.numeric).toBe(false);
  });

  it('should render a single swim activity without a tab group', () => {
    component.selectedActivities = [createActivity([createSwimLength()])];

    component.ngOnChanges();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('mat-tab-group')).toBeNull();
    expect(fixture.nativeElement.querySelector('mat-accordion')).not.toBeNull();
  });

  it('should format swim pace with selected 100-yard units', () => {
    const speedGetValueSpy = vi.spyOn(DataSpeed.prototype, 'getValue');
    const activity = createActivity([
      createSwimLength(),
    ]);

    component.unitSettings = {
      swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard],
    } as UserUnitSettingsInterface;
    component.selectedActivities = [activity];
    component.ngOnChanges();

    expect(component.swimLengthViews[0].groups[0].rows[0]['Swim Pace']).toContain('01:31');
    expect(component.swimLengthViews[0].groups[0].rows[0]['Swim Pace'])
      .toContain(DataSwimPaceMinutesPer100Yard.unit);
    expect(component.swimLengthViews[0].groups[0].summaryRow['Swim Pace']).toContain('01:31');
    expect(component.swimLengthViews[0].groups[0].summaryRow['Swim Pace'])
      .toContain(DataSwimPaceMinutesPer100Yard.unit);
    expect(speedGetValueSpy).not.toHaveBeenCalledWith(DataSwimPace.type);
    speedGetValueSpy.mockRestore();
  });

  it('should group active rows through the following idle row and keep a final active group', () => {
    const activity = createActivity([
      createSwimLength({ index: 1, strokes: 8, avgCadence: 20, avgHeartRate: 100, swolf: 33, calories: 4 }),
      createSwimLength({ index: 2, strokes: 9, avgCadence: 24, avgHeartRate: 120, swolf: 35, calories: 5 }),
      createSwimLength({ index: 3, type: 'idle', stroke: null, strokes: null, distance: null, timerTime: 10, elapsedTime: 10, avgCadence: null, avgHeartRate: null, swolf: null, calories: null }),
      createSwimLength({ index: 4 }),
    ]);

    component.selectedActivities = [activity];
    component.ngOnChanges();

    const groups = component.swimLengthViews[0].groups;
    expect(groups).toHaveLength(2);
    expect(groups[0].label).toBe('Lengths 1-3');
    expect(groups[0].rows.map(row => row['#'])).toEqual([1, 2, 3]);
    expect(groups[0].summaryRow.Type).toBe('Set + Rest');
    expect(groups[0].summaryRow.Stroke).toBe('Freestyle');
    expect(groups[0].summaryRow.Strokes).toBe('17');
    expect(groups[0].summaryRow['Average Cadence']).toContain('22');
    expect(groups[0].summaryRow['Average Heart Rate']).toContain('110');
    expect(groups[0].summaryRow.SWOLF).toBe('34');
    expect(groups[0].summaryRow.Energy).toContain('9');
    expect(groups[0].restDuration).toContain('10');
    expect(groups[0].expanded).toBe(false);
    expect(groups[1].label).toBe('Length 4');
    expect(groups[1].summaryRow.Type).toBe('Set');
    expect(groups[1].restDuration).toBe('');
    expect(groups[1].expanded).toBe(false);
  });

  it('should display active length split progress and keep rest rows out of the split count', () => {
    const activity = createActivity([
      createSwimLength({ index: 1, distance: 25, timerTime: 24.4, elapsedTime: 24.4 }),
      createSwimLength({ index: 2, distance: 25, timerTime: 26.4, elapsedTime: 26.4 }),
      createSwimLength({ index: 3, distance: 25, timerTime: 27.6, elapsedTime: 27.6 }),
      createSwimLength({ index: 4, distance: 25, timerTime: 32, elapsedTime: 32 }),
      createSwimLength({ index: 5, type: 'idle', stroke: null, distance: null, timerTime: 33, elapsedTime: 33 }),
    ]);

    component.selectedActivities = [activity];
    component.ngOnChanges();

    const rows = component.swimLengthViews[0].groups[0].rows;
    expect(rows.map(row => row.Split)).toEqual(['25.0 m', '50.0 m', '75.0 m', '100.0 m', 'Rest']);
    expect(component.swimLengthViews[0].groups[0].columnNames).toContain('Split');
  });

  it('should fall back to pool length when computing active split progress', () => {
    const activity = createActivity([
      createSwimLength({ index: 1, distance: null, poolLength: 25 }),
      createSwimLength({ index: 2, distance: null, poolLength: 25 }),
    ]);

    component.selectedActivities = [activity];
    component.ngOnChanges();

    expect(component.swimLengthViews[0].groups[0].rows.map(row => row.Split)).toEqual(['25.0 m', '50.0 m']);
  });

  it('should create rest-only groups for consecutive idle rows', () => {
    const activity = createActivity([
      createSwimLength({ index: 1 }),
      createSwimLength({ index: 2, type: 'idle', stroke: null, distance: null }),
      createSwimLength({ index: 3, type: 'rest', stroke: null, distance: null }),
    ]);

    component.selectedActivities = [activity];
    component.ngOnChanges();

    const groups = component.swimLengthViews[0].groups;
    expect(groups).toHaveLength(2);
    expect(groups[0].rows.map(row => row['#'])).toEqual([1, 2]);
    expect(groups[1].rows.map(row => row['#'])).toEqual([3]);
    expect(groups[1].label).toBe('Length 3');
    expect(groups[1].summaryRow.Type).toBe('Set + Rest');
    expect(groups[1].summaryRow.Stroke).toBe('');
  });

  it('should mark mixed active strokes in group summaries', () => {
    const activity = createActivity([
      createSwimLength({ index: 1, stroke: 'freestyle' }),
      createSwimLength({ index: 2, stroke: 'backstroke' }),
      createSwimLength({ index: 3, type: 'idle', stroke: null }),
    ]);

    component.selectedActivities = [activity];
    component.ngOnChanges();

    expect(component.swimLengthViews[0].groups[0].summaryRow.Stroke).toBe('Mixed');
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
    expect(template).toContain('@for (group of view.groups; track group.key)');
    expect(template).toContain('swimLengthViews.length === 1');
    expect(template).toContain('*ngTemplateOutlet="swimLengthGroups; context: { $implicit: view }"');
    expect(template).toContain('[dataSource]="group.rows"');
    expect(template).toContain('*matHeaderRowDef="group.columnNames"');
    expect(template).toContain('[expanded]="group.expanded"');
    expect(template).toContain('class="swim-length-group-panel mat-elevation-z0 qs-overlay-flat"');
    expect(template).toContain('collapsedHeight="auto"');
    expect(template).toContain('group.restDuration');
    expect(template).toContain("@if (column.name !== '#')");
    expect(template).toContain('class="swim-length-table-value"');
    expect(template).toContain("[class.swim-length-index-cell]=\"column.name === '#'");
    expect(template).toContain("[class.swim-length-lap-cell]=\"column.name === 'Lap'");
    expect(template).toContain("[class.swim-length-split-cell]=\"column.name === 'Split'");
    expect(template).toContain('[class.swim-length-number]="column.numeric"');
    expect(template).not.toContain('mat-chip');
    expect(template).not.toContain('getDataSource(');
    expect(template).not.toContain('getColumns(');
    expect(template).not.toContain('getActivityTabLabel(');
    expect(template).not.toContain('isSticky(');
  });
});
