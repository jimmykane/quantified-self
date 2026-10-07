import { ChangeDetectorRef, NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import {
  ActivityInterface,
  DataSpeed,
  DataSwimPace,
  DataSwimDistance,
  DataSwimPaceMinutesPer100Yard,
  DistanceUnits,
  EventInterface,
  SwimPaceUnits,
  UserUnitSettingsInterface
} from '@sports-alliance/sports-lib';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { vi } from 'vitest';
import { EventCardSwimLengthsComponent } from './event.card.swim-lengths.component';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { HapticTapDirective } from '../../../directives/haptic-tap.directive';

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

function formatExpectedSwimDistance(distance: number): string {
  const swimDistance = new DataSwimDistance(distance);
  return `${swimDistance.getDisplayValue()} ${swimDistance.getDisplayUnit()}`;
}

describe('EventCardSwimLengthsComponent', () => {
  let component: EventCardSwimLengthsComponent;
  let fixture: ComponentFixture<EventCardSwimLengthsComponent>;
  let haptics: { selection: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    haptics = { selection: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [CommonModule, MatExpansionModule, MatTableModule, MatTabsModule, NoopAnimationsModule],
      declarations: [EventCardSwimLengthsComponent, HapticTapDirective],
      providers: [
        { provide: ChangeDetectorRef, useValue: { markForCheck: vi.fn(), detectChanges: vi.fn() } },
        { provide: AppHapticsService, useValue: haptics },
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
    expect(groups[0].summaryRow['Average Stroke Rate']).toBe('22 spm');
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

  it.each([SwimPaceUnits.MinutesPer100Meter, SwimPaceUnits.MinutesPer100Yard])(
    'separates swim/rest timing, preserves total and details, and excludes rest from pace with %s', swimPaceUnit => {
      const lengths = [
        createSwimLength({ index: 1, timerTime: 24.4, elapsedTime: 30, distance: 25 }),
        createSwimLength({ index: 2, timerTime: 26.4, elapsedTime: 32, distance: 25 }),
        createSwimLength({ index: 3, type: 'idle', timerTime: 10, elapsedTime: 12, distance: null }),
        createSwimLength({ index: 4, timerTime: 23, distance: 25 }),
      ];
      const originalLengths = structuredClone(lengths);
      component.unitSettings = { swimPaceUnits: [swimPaceUnit] } as UserUnitSettingsInterface;
      component.selectedActivities = [createActivity(lengths)];
      component.ngOnChanges();
      fixture.detectChanges();

      const groups = component.swimLengthViews[0].groups;
      const group = groups[0];
      expect(group.activeDuration).toBe('50.8s');
      expect(group.restDuration).toBe('10s');
      expect(group.summaryRow.Duration).toBe('01m 00.8s');
      expect(group.rows.map(row => row.Duration)).toEqual(['24.4s', '26.4s', '10s']);
      expect(group.rows.map(row => row['#'])).toEqual([1, 2, 3]);
      expect(group.rows.map(row => row.Type)).toEqual(['Active', 'Active', 'Idle']);
      expect(group.rows[2].Split).toBe('Rest');
      expect(group.summaryRow['Swim Pace']).toContain(swimPaceUnit === SwimPaceUnits.MinutesPer100Meter ? '01:41' : '01:32');
      expect(groups[1].activeDuration).toBe('23s');
      expect(groups[1].restDuration).toBe('');
      expect(groups[1].summaryRow.Duration).toBe('23s');

      const header = fixture.nativeElement.querySelector('mat-expansion-panel-header') as HTMLElement;
      expect(header.textContent).toMatch(/Swim\s+50\.8s/);
      expect(header.textContent).toMatch(/Rest\s+10s/);
      expect(header.textContent).toMatch(/Total\s+01m 00\.8s/);
      header.click();
      fixture.detectChanges();
      const table = fixture.nativeElement.querySelector('table') as HTMLElement;
      expect(table.querySelectorAll('mat-row')).toHaveLength(3);
      expect(table.textContent).toContain('24.4s');
      expect(table.textContent).toContain('26.4s');
      expect(table.textContent).toContain('10s');
      expect(table.textContent).toContain('Freestyle');
      expect(lengths).toEqual(originalLengths);
    },
  );

  it('uses elapsed time only when timer time is missing and preserves explicit zero timing', () => {
    component.selectedActivities = [createActivity([
      createSwimLength({ index: 1, timerTime: null, elapsedTime: 20.5 }),
      createSwimLength({ index: 2, timerTime: 0, elapsedTime: 99 }),
      createSwimLength({ index: 3, type: ' REST ', timerTime: null, elapsedTime: 9.5, distance: null }),
    ])];
    component.ngOnChanges();
    const group = component.swimLengthViews[0].groups[0];
    expect(group.activeDuration).toBe('20.5s');
    expect(group.restDuration).toBe('09.5s');
    expect(group.summaryRow.Duration).toBe('30s');
    expect(group.rows.map(row => row.Duration)).toEqual(['20.5s', '00s', '09.5s']);
  });

  it('does not invent missing durations or rest from timestamps', () => {
    component.selectedActivities = [createActivity([
      createSwimLength({ index: 1, timerTime: null, elapsedTime: null }),
      createSwimLength({ index: 2, type: 'idle', timerTime: null, elapsedTime: null, distance: null }),
    ])];
    component.ngOnChanges();
    fixture.detectChanges();
    const group = component.swimLengthViews[0].groups[0];
    expect(group.activeDuration).toBe('');
    expect(group.restDuration).toBe('');
    expect(group.summaryRow.Duration).toBe('');
    expect(group.summaryRow['Swim Pace']).toBe('');
    expect(group.rows.map(row => row.Duration)).toEqual(['', '']);
    expect(fixture.nativeElement.querySelector('.swim-length-summary').textContent).not.toContain('00s');
  });

  it('keeps swim timing and active pace separate even if a rest row supplies distance', () => {
    component.selectedActivities = [createActivity([
      createSwimLength({ index: 1, distance: 25, timerTime: 25 }),
      createSwimLength({ index: 2, type: 'rest', distance: 10, timerTime: 50 }),
    ])];
    component.ngOnChanges();
    const group = component.swimLengthViews[0].groups[0];
    expect(group.summaryRow.Distance).toBe('35 m');
    expect(group.rows[1].Distance).toBe('10 m');
    expect(group.summaryRow['Swim Pace']).toContain('01:40');
  });

  it('retains independent activity tabs, set boundaries and all length rows', () => {
    component.selectedActivities = [
      createActivity([createSwimLength({ index: 1 }), createSwimLength({ index: 2, type: 'idle', timerTime: 10 })]),
      createActivity([createSwimLength({ index: 1, timerTime: 30 }), createSwimLength({ index: 2, type: 'rest', timerTime: 5 })]),
    ];
    component.ngOnChanges();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('mat-tab-group')).not.toBeNull();
    expect(component.swimLengthViews.map(view => view.label)).toEqual(['Swimming 1', 'Swimming 2']);
    expect(component.swimLengthViews.map(view => view.groups[0].activeDuration)).toEqual(['25s', '30s']);
    expect(component.swimLengthViews.map(view => view.groups[0].restDuration)).toEqual(['10s', '05s']);
    expect(component.swimLengthViews.map(view => view.groups[0].rows.map(row => row['#']))).toEqual([[1, 2], [1, 2]]);
  });

  it('keeps an expanded set open across unit refreshes with silent initialization and feedback per user toggle', () => {
    component.selectedActivities = [createActivity([
      createSwimLength({ index: 1 }), createSwimLength({ index: 2, type: 'idle', timerTime: 10, distance: null }),
    ])];
    component.ngOnChanges();
    fixture.detectChanges();
    expect(haptics.selection).not.toHaveBeenCalled();
    let header = fixture.nativeElement.querySelector('mat-expansion-panel-header') as HTMLElement;
    header.click();
    fixture.detectChanges();
    expect(component.swimLengthViews[0].groups[0].expanded).toBe(true);
    expect(haptics.selection).toHaveBeenCalledTimes(1);

    component.unitSettings = { swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard] } as UserUnitSettingsInterface;
    component.ngOnChanges();
    fixture.detectChanges();
    expect(component.swimLengthViews[0].groups[0].expanded).toBe(true);
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    header = fixture.nativeElement.querySelector('mat-expansion-panel-header') as HTMLElement;
    expect(header.getAttribute('aria-expanded')).toBe('true');
    header.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    fixture.detectChanges();
    expect(component.swimLengthViews[0].groups[0].expanded).toBe(false);
    expect(haptics.selection).toHaveBeenCalledTimes(2);
    header.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', keyCode: 32, bubbles: true }));
    fixture.detectChanges();
    expect(component.swimLengthViews[0].groups[0].expanded).toBe(true);
    expect(haptics.selection).toHaveBeenCalledTimes(3);
    header.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, ctrlKey: true, bubbles: true }));
    header.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true }));
    fixture.detectChanges();
    expect(component.swimLengthViews[0].groups[0].expanded).toBe(true);
    expect(haptics.selection).toHaveBeenCalledTimes(3);
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
    expect(rows.map(row => row.Split)).toEqual(['25 m', '50 m', '75 m', '100 m', 'Rest']);
    expect(component.swimLengthViews[0].groups[0].columnNames).toContain('Split');
  });

  it('should fall back to pool length when computing active split progress', () => {
    const activity = createActivity([
      createSwimLength({ index: 1, distance: null, poolLength: 25 }),
      createSwimLength({ index: 2, distance: null, poolLength: 25 }),
    ]);

    component.selectedActivities = [activity];
    component.ngOnChanges();

    expect(component.swimLengthViews[0].groups[0].rows.map(row => row.Split)).toEqual(['25 m', '50 m']);
  });

  it('should format swim distances in meters regardless of distance unit preference', () => {
    const activity = createActivity([
      createSwimLength({ index: 1, distance: 1500, timerTime: 1800, elapsedTime: 1800 }),
    ]);

    component.unitSettings = {
      distanceUnits: DistanceUnits.Miles,
    } as UserUnitSettingsInterface;
    component.selectedActivities = [activity];
    component.ngOnChanges();

    const group = component.swimLengthViews[0].groups[0];
    const expectedDistance = formatExpectedSwimDistance(1500);
    expect(group.rows[0].Distance).toBe(expectedDistance);
    expect(group.rows[0].Split).toBe(expectedDistance);
    expect(group.summaryRow.Distance).toBe(expectedDistance);
  });

  it('shows yard lengths, cumulative splits and set totals, and refreshes when units change', () => {
    const lengths = [1, 2, 3, 4].map(index => createSwimLength({ index, distance: 22.86, poolLength: 22.86 }));
    lengths.push(createSwimLength({ index: 5, type: 'idle', distance: null, timerTime: 10, elapsedTime: 10 }));
    component.selectedActivities = [createActivity(lengths)];
    component.unitSettings = { swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard, SwimPaceUnits.MinutesPer100Meter] } as UserUnitSettingsInterface;
    component.ngOnChanges();
    const group = component.swimLengthViews[0].groups[0];
    expect(group.rows.map(row => row.Split)).toEqual(['25 yd', '50 yd', '75 yd', '100 yd', 'Rest']);
    expect(group.rows.slice(0, 4).map(row => row.Distance)).toEqual(['25 yd', '25 yd', '25 yd', '25 yd']);
    expect(group.rows[4].Distance).toBe('');
    expect(group.summaryRow.Distance).toBe('100 yd');
    const duration = group.summaryRow.Duration;
    component.unitSettings = { swimPaceUnits: [SwimPaceUnits.MinutesPer100Meter] } as UserUnitSettingsInterface;
    component.ngOnChanges();
    expect(component.swimLengthViews[0].groups[0].summaryRow.Distance).toBe('91.44 m');
    expect(component.swimLengthViews[0].groups[0].summaryRow.Duration).toBe(duration);
    expect(lengths[0].distance).toBe(22.86);
  });

  it('uses yard pool lengths for fallback splits and keeps long totals in yards', () => {
    component.unitSettings = { swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard] } as UserUnitSettingsInterface;
    component.selectedActivities = [createActivity([
      createSwimLength({ index: 1, distance: null, poolLength: 22.86 }),
      createSwimLength({ index: 2, distance: null, poolLength: 22.86 }),
    ])];
    component.ngOnChanges();
    expect(component.swimLengthViews[0].groups[0].rows.map(row => row.Split)).toEqual(['25 yd', '50 yd']);
    component.selectedActivities = [createActivity([createSwimLength({ distance: 1508.76 })])];
    component.ngOnChanges();
    expect(component.swimLengthViews[0].groups[0].summaryRow.Distance).toBe('1.650 yd');
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
    expect(groups[1].summaryRow.Type).toBe('Rest');
    expect(groups[1].summaryRow.Stroke).toBe('');
    expect(groups[1].activeDuration).toBe('');
    expect(groups[1].restDuration).toBe('25s');
    expect(groups[1].summaryRow.Duration).toBe('25s');
    expect(groups[1].summaryRow['Swim Pace']).toBe('');
  });

  it('should mark mixed active strokes in group summaries', () => {
    const activity = createActivity([
      createSwimLength({ index: 1, stroke: 'freestyle' }),
      createSwimLength({ index: 2, stroke: 'backstroke' }),
      createSwimLength({ index: 3, type: 'idle', stroke: null }),
    ]);

    component.selectedActivities = [activity];
    component.ngOnChanges();
    fixture.detectChanges();

    expect(component.swimLengthViews[0].groups[0].summaryRow.Stroke).toBe('Mixed');
    expect(fixture.nativeElement.querySelector('mat-expansion-panel-header').textContent).toContain('Stroke: Mixed');
  });

  it('shows stroke in each set header by default without borrowing stroke from rest rows', () => {
    component.selectedActivities = [createActivity([
      createSwimLength({ index: 1, stroke: 'freestyle' }),
      createSwimLength({ index: 2, type: 'idle', stroke: 'backstroke' }),
      createSwimLength({ index: 3, stroke: 'breaststroke' }),
      createSwimLength({ index: 4, type: 'rest', stroke: 'freestyle' }),
      createSwimLength({ index: 5, type: 'idle', stroke: 'freestyle' }),
      createSwimLength({ index: 6, stroke: null }),
    ])];
    component.ngOnChanges();
    fixture.detectChanges();
    const headers = [...fixture.nativeElement.querySelectorAll('mat-expansion-panel-header')] as HTMLElement[];
    expect(headers[0].textContent).toContain('Stroke: Freestyle');
    expect(headers[1].textContent).toContain('Stroke: Breaststroke');
    expect(headers[2].textContent).not.toContain('Stroke:');
    expect(headers[3].textContent).not.toContain('Stroke:');
    expect(component.swimLengthViews[0].groups.flatMap(group => group.rows).map(row => row['#']))
      .toEqual([1, 2, 3, 4, 5, 6]);
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
