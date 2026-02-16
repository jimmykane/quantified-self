import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatTabsModule } from '@angular/material/tabs';
import { beforeEach, describe, expect, it } from 'vitest';

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

  it('should render tabs in locked order when multiple charts are available', async () => {
    component.hasIntensity = true;
    component.hasPowerCurve = true;
    component.hasDurability = true;
    component.hasCadencePower = true;

    fixture.detectChanges();
    await fixture.whenStable();

    const nativeElement = fixture.nativeElement as HTMLElement;
    const fullText = nativeElement.textContent ?? '';

    expect(nativeElement.querySelector('mat-tab-group')).not.toBeNull();

    const intensityIndex = fullText.indexOf('Intensity');
    const powerIndex = fullText.indexOf('Power Curve');
    const durabilityIndex = fullText.indexOf('Durability');
    const cadenceIndex = fullText.indexOf('Cadence vs Power');

    expect(intensityIndex).toBeGreaterThanOrEqual(0);
    expect(powerIndex).toBeGreaterThan(intensityIndex);
    expect(durabilityIndex).toBeGreaterThan(powerIndex);
    expect(cadenceIndex).toBeGreaterThan(durabilityIndex);
  });

  it('should render direct durability chart without tabs when only durability is available', () => {
    component.hasIntensity = false;
    component.hasPowerCurve = false;
    component.hasDurability = true;
    component.hasCadencePower = false;

    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;

    expect(nativeElement.querySelector('mat-tab-group')).toBeNull();
    expect(nativeElement.querySelector('app-event-durability-curve')).not.toBeNull();
  });

  it('should render direct cadence-power chart without tabs when only cadence-power is available', () => {
    component.hasIntensity = false;
    component.hasPowerCurve = false;
    component.hasDurability = false;
    component.hasCadencePower = true;

    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;

    expect(nativeElement.querySelector('mat-tab-group')).toBeNull();
    expect(nativeElement.querySelector('app-event-cadence-power')).not.toBeNull();
  });

  it('should render nothing when no charts are available', () => {
    component.hasIntensity = false;
    component.hasPowerCurve = false;
    component.hasDurability = false;
    component.hasCadencePower = false;

    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;

    expect(nativeElement.querySelector('mat-tab-group')).toBeNull();
    expect(nativeElement.querySelector('app-event-intensity-zones')).toBeNull();
    expect(nativeElement.querySelector('app-event-power-curve')).toBeNull();
    expect(nativeElement.querySelector('app-event-durability-curve')).toBeNull();
    expect(nativeElement.querySelector('app-event-cadence-power')).toBeNull();
  });
});
