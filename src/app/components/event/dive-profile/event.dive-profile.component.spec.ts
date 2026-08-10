import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  ActivityInterface,
  ActivityTypes,
  ChartCursorBehaviours,
  DataDepth,
  DataHeartRate,
  DataTemperature,
  DistanceUnits,
  SwimPaceUnits,
  XAxisTypes,
} from '@sports-alliance/sports-lib';
import { beforeEach, describe, expect, it } from 'vitest';
import { EventDiveProfileComponent } from './event.dive-profile.component';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { AppUserSettingsQueryService } from '../../../services/app.user-settings-query.service';
import type { EventChartOverlayOption } from '../../../helpers/event-chart-overlay.helper';
import type { EventChartPanelModel } from '../../../helpers/event-echarts-data.helper';
import type { EventChartRange } from '../../../helpers/event-echarts-xaxis.helper';

@Component({
  selector: 'app-event-section-header',
  template: '',
  standalone: false,
})
class EventSectionHeaderStubComponent {
  @Input() icon = '';
  @Input() title = '';
}

@Component({
  selector: 'app-event-card-chart-panel',
  template: '',
  standalone: false,
})
class EventChartPanelStubComponent {
  @Input() panel: EventChartPanelModel | null = null;
  @Input() overlayPanel: EventChartPanelModel | null = null;
  @Input() overlayOptions: EventChartOverlayOption[] = [];
  @Input() selectedOverlayDataType: string | null = null;
  @Input() xAxisType = XAxisTypes.Duration;
  @Input() darkTheme = false;
  @Input() useAnimations = false;
  @Input() xDomain: EventChartRange | null = null;
  @Input() cursorBehaviour = ChartCursorBehaviours.ZoomX;
  @Input() showDateOnTimeAxis = true;
  @Input() showLaps = true;
  @Input() showSwimLengths = true;
  @Input() strokeWidth = 1;
  @Input() fillOpacity = 0;
  @Input() userUnitSettings: unknown;
  @Input() showActivityNamesInTooltip = false;
  @Output() overlayDataTypeChange = new EventEmitter<string | null>();
}

function buildDivingActivity(): ActivityInterface {
  const streams = [
    { type: DataDepth.type, getData: () => [0, 1.5, null, 4.25] },
    { type: DataTemperature.type, getData: () => [22, 21.5, null, 21] },
    { type: DataHeartRate.type, getData: () => [88, 92, null, 98] },
  ];
  const timeStream = { type: XAxisTypes.Time, getData: () => [0, 1, 2, 3] };
  return {
    type: ActivityTypes.FreeDiving,
    startDate: new Date('2026-08-10T12:00:00.000Z'),
    endDate: new Date('2026-08-10T12:00:03.000Z'),
    creator: { name: 'Dive', devices: [] },
    intensityZones: [],
    getID: () => 'dive-1',
    getAllStreams: () => streams,
    getStream: (type: string) => type === XAxisTypes.Time
      ? timeStream
      : streams.find((stream) => stream.type === type),
  } as ActivityInterface;
}

describe('EventDiveProfileComponent', () => {
  let fixture: ComponentFixture<EventDiveProfileComponent>;
  let component: EventDiveProfileComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [
        EventDiveProfileComponent,
        EventSectionHeaderStubComponent,
        EventChartPanelStubComponent,
      ],
      providers: [
        {
          provide: AppEventColorService,
          useValue: { getActivityColor: () => '#0088aa' },
        },
        {
          provide: AppUserSettingsQueryService,
          useValue: {
            chartSettings: signal({
              chartCursorBehaviour: ChartCursorBehaviours.ZoomX,
              strokeWidth: 1.5,
              fillOpacity: 0,
              fillOpacityVersion: 1,
            }),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventDiveProfileComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('activities', [buildDivingActivity()]);
    fixture.componentRef.setInput('unitSettings', {
      speedUnits: [],
      gradeAdjustedSpeedUnits: [],
      verticalSpeedUnits: [],
      paceUnits: [],
      gradeAdjustedPaceUnits: [],
      swimPaceUnits: [SwimPaceUnits.MinutesPer100Meter],
      distanceUnits: DistanceUnits.Kilometers,
      startOfTheWeek: 1,
    } as never);
  });

  it('renders depth through the standard Event Details chart panel', () => {
    fixture.detectChanges();

    const panelDebugElement = fixture.debugElement.query(By.directive(EventChartPanelStubComponent));
    const panel = panelDebugElement.componentInstance as EventChartPanelStubComponent;
    const sectionHeader = fixture.debugElement.query(By.directive(EventSectionHeaderStubComponent))
      .componentInstance as EventSectionHeaderStubComponent;

    expect(sectionHeader).toMatchObject({ icon: 'scuba_diving', title: 'Dive Profile' });
    expect(panel.panel?.dataType).toBe(DataDepth.type);
    expect(panel.xAxisType).toBe(XAxisTypes.Duration);
    expect(panel.xDomain).toEqual({ start: 0, end: 3 });
    expect(panel.strokeWidth).toBe(1.5);
    expect(panel.overlayOptions.map((option) => option.dataType)).toEqual([
      DataTemperature.type,
      DataHeartRate.type,
    ]);
    expect(fixture.nativeElement.querySelector('mat-checkbox')).toBeNull();
  });

  it('shows at most one optional overlay using the standard chart overlay picker', () => {
    fixture.detectChanges();

    let panel = fixture.debugElement.query(By.directive(EventChartPanelStubComponent))
      .componentInstance as EventChartPanelStubComponent;
    panel.overlayDataTypeChange.emit(DataTemperature.type);
    fixture.detectChanges();

    panel = fixture.debugElement.query(By.directive(EventChartPanelStubComponent))
      .componentInstance as EventChartPanelStubComponent;
    expect(component.selectedOverlayDataType()).toBe(DataTemperature.type);
    expect(panel.overlayPanel?.dataType).toBe(DataTemperature.type);

    panel.overlayDataTypeChange.emit(null);
    fixture.detectChanges();
    expect(component.selectedOverlayDataType()).toBeNull();
  });
});
