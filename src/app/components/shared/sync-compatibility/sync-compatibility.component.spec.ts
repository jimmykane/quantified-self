import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { describe, it, expect, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { SyncCompatibilityComponent } from './sync-compatibility.component';
import { AppHapticsService } from '../../../services/app.haptics.service';

function setup() {
  const haptics = { selection: vi.fn() };
  TestBed.configureTestingModule({ imports: [SyncCompatibilityComponent, NoopAnimationsModule], providers: [{ provide: AppHapticsService, useValue: haptics }] });
  const fixture = TestBed.createComponent(SyncCompatibilityComponent);
  fixture.componentRef.setInput('expanded', true); fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, haptics };
}
describe('sync compatibility before checkout', () => {
  it('keeps activities, routes and QS-authored workouts separate for Suunto to Garmin', () => {
    const { fixture, component, haptics } = setup();
    expect(haptics.selection).not.toHaveBeenCalled();
    component.chooseSource(ServiceNames.SuuntoApp); component.chooseDestination(ServiceNames.GarminAPI); fixture.detectChanges();
    expect(component.activities()).toBe(false); expect(component.routes()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('QS cannot send completed activities into Garmin Connect');
    expect(fixture.nativeElement.textContent).toContain('Course Import permission');
    expect(fixture.nativeElement.textContent).toContain('This does not copy training plans between providers');
    const calls = haptics.selection.mock.calls.length;
    component.chooseDestination(ServiceNames.GarminAPI); component.chooseDestination(ServiceNames.SuuntoApp);
    expect(haptics.selection).toHaveBeenCalledTimes(calls);
  });
  it('shows COROS history limits, older-file alternative and all four sources', () => {
    const { fixture, component } = setup(); component.chooseSource(ServiceNames.COROSAPI); fixture.detectChanges();
    expect(component.providers.map(p => p.label)).toEqual(['Garmin', 'Suunto', 'COROS', 'Wahoo']);
    expect(fixture.nativeElement.textContent).toContain('last three months');
    expect(fixture.nativeElement.textContent).toContain('upload exported activity files');
    expect(component.activities()).toBe(true);
    component.chooseSource(ServiceNames.WahooAPI); component.chooseDestination(ServiceNames.COROSAPI); fixture.detectChanges();
    expect(component.activities()).toBe(true); expect(component.routes()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Sending QS workouts to COROS is not yet supported');
  });
});
