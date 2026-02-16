import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatTabsModule } from '@angular/material/tabs';
import { describe, expect, it, beforeEach } from 'vitest';

import { EventPerformanceChartsComponent } from './event.performance-charts.component';

describe('EventPerformanceChartsComponent', () => {
  let fixture: ComponentFixture<EventPerformanceChartsComponent>;
  let component: EventPerformanceChartsComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MatTabsModule, NoopAnimationsModule],
      declarations: [EventPerformanceChartsComponent],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(EventPerformanceChartsComponent);
    component = fixture.componentInstance;
    component.activities = [{ getID: () => 'a1' } as any];
  });

  it('should render tabs when both intensity and performance curve are available', async () => {
    component.hasIntensity = true;
    component.hasPerformanceCurve = true;

    fixture.detectChanges();
    await fixture.whenStable();

    const nativeElement = fixture.nativeElement as HTMLElement;

    expect(nativeElement.querySelector('mat-tab-group')).not.toBeNull();
    expect(nativeElement.textContent).toContain('Intensity');
    expect(nativeElement.textContent).toContain('Performance Curve');
  });

  it('should render intensity only without tabs when only intensity is available', () => {
    component.hasIntensity = true;
    component.hasPerformanceCurve = false;

    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;

    expect(nativeElement.querySelector('mat-tab-group')).toBeNull();
    expect(nativeElement.querySelector('app-event-intensity-zones')).not.toBeNull();
    expect(nativeElement.querySelector('app-event-power-curve')).toBeNull();
  });

  it('should render performance curve only without tabs when only performance curve is available', () => {
    component.hasIntensity = false;
    component.hasPerformanceCurve = true;

    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;

    expect(nativeElement.querySelector('mat-tab-group')).toBeNull();
    expect(nativeElement.querySelector('app-event-intensity-zones')).toBeNull();
    expect(nativeElement.querySelector('app-event-power-curve')).not.toBeNull();
  });

  it('should render nothing when neither chart is available', () => {
    component.hasIntensity = false;
    component.hasPerformanceCurve = false;

    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;

    expect(nativeElement.querySelector('mat-tab-group')).toBeNull();
    expect(nativeElement.querySelector('app-event-intensity-zones')).toBeNull();
    expect(nativeElement.querySelector('app-event-power-curve')).toBeNull();
  });
});
