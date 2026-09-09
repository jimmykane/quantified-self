import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { HEALTH_METRIC_IDS } from '@shared/health';
import { buildHealthMetricCatalogGroups } from '../../helpers/health-workspace.helper';
import { AppHapticsService } from '../../services/app.haptics.service';
import { HealthMetricsBottomSheetComponent, type HealthMetricsData } from './health-metrics-bottom-sheet.component';

describe('HealthMetricsBottomSheetComponent', () => {
  async function create() {
    const groups = signal(buildHealthMetricCatalogGroups([HEALTH_METRIC_IDS.RestingHeartRate, HEALTH_METRIC_IDS.BodyWeight]));
    const showSleep = signal(true);
    const data: HealthMetricsData = { groups, showSleep, selected: HEALTH_METRIC_IDS.RestingHeartRate };
    const dismiss = vi.fn();
    const haptics = { selection: vi.fn() };
    await TestBed.configureTestingModule({ imports: [HealthMetricsBottomSheetComponent], providers: [
      { provide: MAT_BOTTOM_SHEET_DATA, useValue: data },
      { provide: MatBottomSheetRef, useValue: { dismiss } },
      { provide: AppHapticsService, useValue: haptics },
    ] }).compileComponents();
    const fixture = TestBed.createComponent(HealthMetricsBottomSheetComponent);
    fixture.detectChanges();
    return { fixture, groups, showSleep, dismiss, haptics, component: fixture.componentInstance };
  }

  it('shows available grouped metrics with icons and marks the current selection', async () => {
    const { fixture, haptics, dismiss } = await create();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('button[mat-list-item]')).toHaveLength(3);
    expect(host.querySelector('[aria-pressed="true"]')?.textContent).toContain('Resting heart rate');
    expect(host.textContent).toContain('Sleep overview');
    expect(host.textContent).toContain('Cardiovascular');
    expect(host.textContent).not.toContain('Steps');
    expect(host.querySelectorAll('button[mat-list-item] mat-icon[matListItemIcon]')).toHaveLength(3);
    expect(haptics.selection).not.toHaveBeenCalled();
    host.querySelector<HTMLButtonElement>('button[mat-list-item]')!.click();
    expect(dismiss).toHaveBeenCalledWith('sleep');
    expect(haptics.selection).not.toHaveBeenCalled();
  });

  it('updates availability while open and rejects removed choices', async () => {
    const { fixture, groups, showSleep, component, dismiss } = await create();
    groups.set([]);
    showSleep.set(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('button[mat-list-item]')).toHaveLength(0);
    expect(fixture.nativeElement.textContent).toContain('No imported Health metrics yet');
    component.select('sleep'); component.select(HEALTH_METRIC_IDS.BodyWeight);
    expect(dismiss).not.toHaveBeenCalled();
    component.close();
    expect(dismiss).toHaveBeenCalledWith();
  });
});
