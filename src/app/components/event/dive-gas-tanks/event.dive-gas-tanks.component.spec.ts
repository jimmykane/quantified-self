import { Component, Input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatTableModule } from '@angular/material/table';
import {
  ActivityInterface,
  ActivityTypes,
  DiveSourceRecords,
} from '@sports-alliance/sports-lib';
import { describe, expect, it, beforeEach } from 'vitest';
import { EventDiveGasTanksComponent } from './event.dive-gas-tanks.component';

@Component({
  selector: 'app-event-section-header',
  template: '',
  standalone: false,
})
class EventSectionHeaderStubComponent {
  @Input() icon = '';
  @Input() title = '';
}

function buildDivingActivity(id: string, records: DiveSourceRecords): ActivityInterface {
  return {
    type: ActivityTypes.ScubaDiving,
    getID: () => id,
    getDiveSourceRecords: () => records,
  } as ActivityInterface;
}

describe('EventDiveGasTanksComponent', () => {
  let fixture: ComponentFixture<EventDiveGasTanksComponent>;
  let component: EventDiveGasTanksComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [EventDiveGasTanksComponent, EventSectionHeaderStubComponent],
      imports: [CommonModule, MatTableModule, NoopAnimationsModule],
    }).compileComponents();

    fixture = TestBed.createComponent(EventDiveGasTanksComponent);
    component = fixture.componentInstance;
  });

  it('renders parser-provided gases, tank summaries, and pressure updates without deriving records', () => {
    fixture.componentRef.setInput('selectedActivities', [buildDivingActivity('dive-1', {
      gases: [{
        messageIndex: { value: 2, selected: true },
        oxygenContent: 32,
        heliumContent: 15,
        status: 'enabled',
        mode: 'open_circuit',
      }],
      tankSummaries: [{
        timestamp: new Date('2026-08-20T10:15:00.000Z'),
        sensor: 3578158576,
        startPressure: 199.46,
        endPressure: 74.67,
        volumeUsed: 1396.01,
      }],
      tankUpdates: [{
        timestamp: new Date('2026-08-20T10:16:00.000Z'),
        sensor: 3578158576,
        pressure: 198.4,
      }],
    })]);

    fixture.detectChanges();

    expect(component.sourceActivityViews).toEqual([
      expect.objectContaining({
        label: ActivityTypes.ScubaDiving,
        gasRows: [expect.objectContaining({
          messageIndex: '2 (selected)',
          oxygenContent: '32 %',
          heliumContent: '15 %',
          status: 'enabled',
          mode: 'open_circuit',
        })],
        tankSummaryRows: [expect.objectContaining({
          timestamp: '2026-08-20T10:15:00.000Z',
          sensor: '3578158576',
          startPressure: '199.46 bar',
          endPressure: '74.67 bar',
          volumeUsed: '1396.01 L',
        })],
        tankUpdateRows: [expect.objectContaining({
          timestamp: '2026-08-20T10:16:00.000Z',
          sensor: '3578158576',
          pressure: '198.4 bar',
        })],
      }),
    ]);
    const sectionHeader = fixture.debugElement.query(By.directive(EventSectionHeaderStubComponent))
      .componentInstance as EventSectionHeaderStubComponent;
    expect(sectionHeader).toMatchObject({ icon: 'scuba_diving', title: 'Gas & Tanks' });
    expect(fixture.nativeElement.textContent).toContain('Tank pressure updates');
  });

  it('keeps source records in separate activity sections instead of flattening them', () => {
    fixture.componentRef.setInput('selectedActivities', [
      buildDivingActivity('dive-1', {
        gases: [{ oxygenContent: 21 }],
        tankSummaries: [],
        tankUpdates: [],
      }),
      buildDivingActivity('dive-2', {
        gases: [],
        tankSummaries: [{ startPressure: 200, endPressure: 80, volumeUsed: 1200 }],
        tankUpdates: [],
      }),
    ]);

    fixture.detectChanges();

    expect(component.sourceActivityViews.map((view) => view.label)).toEqual([
      `${ActivityTypes.ScubaDiving} 1`,
      `${ActivityTypes.ScubaDiving} 2`,
    ]);
    expect(component.sourceActivityViews[0].gasRows).toHaveLength(1);
    expect(component.sourceActivityViews[0].tankSummaryRows).toHaveLength(0);
    expect(component.sourceActivityViews[1].gasRows).toHaveLength(0);
    expect(component.sourceActivityViews[1].tankSummaryRows).toHaveLength(1);
    expect(fixture.nativeElement.querySelectorAll('.dive-source-activity')).toHaveLength(2);
  });
});
