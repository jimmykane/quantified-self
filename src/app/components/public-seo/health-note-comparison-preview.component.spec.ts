import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { MatSelect } from '@angular/material/select';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { AppThemes, WeightUnits } from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { describe, expect, it, vi } from 'vitest';
import { comparisonValueText } from '../../helpers/timeline-note-comparison.helper';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppThemeService } from '../../services/app.theme.service';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';
import { HealthMetricSeriesChartComponent } from '../health/health-metric-series-chart.component';
import { HealthNoteComparisonPreviewComponent } from './health-note-comparison-preview.component';

describe('HealthNoteComparisonPreviewComponent', () => {
  async function render() {
    await TestBed.configureTestingModule({
      imports: [HealthNoteComparisonPreviewComponent, NoopAnimationsModule],
      providers: [
        { provide: AppThemeService, useValue: { appTheme: signal(AppThemes.Dark) } },
        { provide: AppHapticsService, useValue: { selection: vi.fn() } },
        { provide: LoggerService, useValue: { error: vi.fn() } },
        { provide: EChartsLoaderService, useValue: {
          init: vi.fn().mockResolvedValue({ isDisposed: () => false, dispatchAction: vi.fn(), on: vi.fn(), off: vi.fn(), getWidth: () => 320 }),
          setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(),
          subscribeToViewportResize: () => () => undefined, attachMobileSeriesTapFeedback: () => () => undefined,
        } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(HealthNoteComparisonPreviewComponent);
    fixture.detectChanges(); await fixture.whenStable();
    await vi.waitFor(() => expect(TestBed.inject(EChartsLoaderService).setOption).toHaveBeenCalled());
    return fixture;
  }

  it('renders a self-contained public sample through the real comparison chart without account services', async () => {
    const fixture = await render(), component = fixture.componentInstance;
    const chart = fixture.debugElement.query(By.directive(HealthMetricSeriesChartComponent)).componentInstance as HealthMetricSeriesChartComponent;
    expect(chart.model).toBe(component.model());
    expect(chart.comparisonWindow).toBe(component.example.window);
    expect(chart.darkTheme).toBe(true);
    expect(chart.model.displayedPoints).toHaveLength(14);
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Fictional sample'); expect(text).toContain('Nothing is saved');
    expect(text).toContain('Weekend away'); expect(text).toContain('Suunto');
    expect(text).toContain('7/7 nights'); expect(text).toContain('Change day excluded');
    expect(text).toContain('Observed differences, not cause and effect');
    expect(TestBed.inject(AppHapticsService).selection).not.toHaveBeenCalled();
    const options = vi.mocked(TestBed.inject(EChartsLoaderService).setOption).mock.calls[0][1];
    expect(JSON.stringify(options.series)).toContain('Note starts');
  });

  it('updates the real chart and summary using Material selection, with silent unchanged/invalid values', async () => {
    const fixture = await render(), component = fixture.componentInstance;
    const picker = fixture.debugElement.query(By.directive(MatSelect)).componentInstance as MatSelect;
    const haptics = TestBed.inject(AppHapticsService);
    component.chooseMetric(component.selectedMetric());
    component.chooseMetric('invalid' as never);
    expect(haptics.selection).not.toHaveBeenCalled();
    picker.selectionChange.emit({ source: picker, value: 'sleep_duration' });
    fixture.detectChanges();
    expect(component.row().label).toBe('Sleep duration');
    expect(component.model().series.metricId).toBe('sleep_duration');
    expect(fixture.nativeElement.textContent).toContain(component.row().beforeText);
    expect(haptics.selection).toHaveBeenCalledOnce();
    picker.selectionChange.emit({ source: picker, value: 'resting_heart_rate' }); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('7/7 days');
    expect(haptics.selection).toHaveBeenCalledTimes(2);
  });

  it('uses canonical formatters with default and alternate user units for each metric', async () => {
    const fixture = await render(), component = fixture.componentInstance;
    for (const settings of [null, normalizeUserUnitSettings({ weightUnits: WeightUnits.Pounds })]) {
      fixture.componentRef.setInput('unitSettings', settings);
      for (const metric of component.metrics) {
        component.chooseMetric(metric.id); fixture.detectChanges();
        const row = component.row();
        expect(row.beforeText).toBe(comparisonValueText(metric.id, row.before, settings));
        expect(row.afterText).toBe(comparisonValueText(metric.id, row.after, settings));
        expect(row.differenceText).toBe(comparisonValueText(metric.id, row.difference, settings, true));
        expect(fixture.nativeElement.querySelector('dl').textContent).toContain(row.differenceText);
      }
    }
  });
});
