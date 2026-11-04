import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';
import { DashboardPerformanceTrendComponent } from './dashboard-performance-trend.component';
import { TRAINING_PREVIEW_POWER, TRAINING_PREVIEW_DURABILITY } from '../../public-seo/training-explorer-preview.data';
import type { DashboardPerformanceTrendContext } from '../../../helpers/dashboard-performance-trend.helper';

describe('Dashboard performance chart chrome', () => {
  const haptics = { selection: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({ imports: [DashboardPerformanceTrendComponent], providers: [provideNoopAnimations(),
      { provide: AppHapticsService, useValue: haptics },
      { provide: EChartsLoaderService, useValue: { init: vi.fn(async () => null), dispose: vi.fn() } },
      { provide: LoggerService, useValue: { error: vi.fn() } },
    ] });
  });
  const context = (): DashboardPerformanceTrendContext => ({ options: [{ value: 'Cycling', label: 'Cycling' }, { value: 'Mountain Biking', label: 'Mountain Biking' }],
    selectedKey: 'Cycling', powerTrend: TRAINING_PREVIEW_POWER[0], trajectory: null,
    valueText: '241 watt', detailText: 'Modeled capacity', evidenceText: '3 usable power workouts',
  });

  it('renders the reused power chart and emits one accepted context selection; initialization and no-ops stay silent', async () => {
    const fixture = TestBed.createComponent(DashboardPerformanceTrendComponent);
    fixture.componentRef.setInput('context', context());
    fixture.componentRef.setInput('title', 'Critical power');
    fixture.detectChanges(); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('app-training-power-systems-trend-chart')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('241 watt');
    expect(fixture.nativeElement.querySelector('[data-dashboard-chart-plot]')).not.toBeNull();
    expect(haptics.selection).not.toHaveBeenCalled();
    const emitted = vi.fn(); fixture.componentInstance.contextChange.subscribe(emitted);
    fixture.componentInstance.selectContext('Cycling'); fixture.componentInstance.selectContext('unknown');
    expect(emitted).not.toHaveBeenCalled();
    fixture.nativeElement.querySelector('.performance-context button').click(); fixture.detectChanges();
    expect(haptics.selection).toHaveBeenCalledTimes(1); // Opening the menu is its own accepted action.
    haptics.selection.mockClear();
    const option = [...document.querySelectorAll<HTMLButtonElement>('[mat-menu-item]')].find(button => button.textContent?.includes('Mountain Biking'))!;
    option.click(); fixture.detectChanges();
    expect(emitted).toHaveBeenCalledExactlyOnceWith('Mountain Biking');
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('disabled', true); fixture.detectChanges();
    fixture.componentInstance.selectContext('Mountain Biking');
    expect(emitted).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });

  it('renders the shared durability chart and retains recorded evidence during a failed refresh', async () => {
    const fixture = TestBed.createComponent(DashboardPerformanceTrendComponent);
    fixture.componentRef.setInput('context', { ...context(), powerTrend: null, trajectory: TRAINING_PREVIEW_DURABILITY });
    fixture.componentRef.setInput('status', 'failed');
    fixture.detectChanges(); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('app-training-durability-trajectory-chart')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.durability-dashboard')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Could not refresh');
    expect(fixture.nativeElement.textContent).toContain('3 usable power workouts');
    fixture.destroy();
  });
});
