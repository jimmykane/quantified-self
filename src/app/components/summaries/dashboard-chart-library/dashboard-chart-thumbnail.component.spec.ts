import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardChartThumbnailComponent } from './dashboard-chart-thumbnail.component';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';
import { buildDashboardExamplePreview } from '../../../helpers/dashboard-chart-preview.helper';
import { getDashboardChartCatalog } from '../../../helpers/dashboard-chart-catalog.helper';

describe('chart list miniature rendering', () => {
  const chart = { isDisposed: () => false };
  const loader = { init: vi.fn(), setOption: vi.fn(), dispose: vi.fn(), resize: vi.fn(),
    subscribeToViewportResize: vi.fn(() => vi.fn()), attachMobileSeriesTapFeedback: vi.fn() };
  const example = buildDashboardExamplePreview(getDashboardChartCatalog().find(entry => entry.definition.id === 'curated-freshness-forecast')!.tile);
  beforeEach(() => {
    vi.clearAllMocks(); loader.init.mockResolvedValue(chart);
    TestBed.configureTestingModule({ imports: [DashboardChartThumbnailComponent], providers: [
      { provide: EChartsLoaderService, useValue: loader }, { provide: LoggerService, useValue: { error: vi.fn() } },
    ] });
  });
  it('renders the supplied preview without backend services, tooltips, focus targets or haptic handlers', async () => {
    const fixture = TestBed.createComponent(DashboardChartThumbnailComponent);
    fixture.componentRef.setInput('preview', example); fixture.detectChanges(); await fixture.whenStable();
    await vi.waitFor(() => expect(loader.setOption).toHaveBeenCalledWith(chart, expect.objectContaining({ tooltip: { show: false, triggerOn: 'none' } }), expect.anything()));
    expect(fixture.nativeElement.querySelector('[aria-hidden="true"][inert]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('button, input, [tabindex]')).toBeNull();
    expect(loader.attachMobileSeriesTapFeedback).not.toHaveBeenCalled();
    fixture.destroy(); expect(loader.dispose).toHaveBeenCalledWith(chart);
  });
  it('updates the chart for a theme change without adding interaction listeners', async () => {
    const fixture = TestBed.createComponent(DashboardChartThumbnailComponent);
    fixture.componentRef.setInput('preview', example); fixture.detectChanges(); await fixture.whenStable();
    await vi.waitFor(() => expect(loader.setOption).toHaveBeenCalledOnce());
    fixture.componentRef.setInput('darkTheme', true); fixture.detectChanges(); await fixture.whenStable();
    await vi.waitFor(() => expect(loader.setOption).toHaveBeenCalledTimes(2));
    expect(loader.init).toHaveBeenLastCalledWith(expect.any(HTMLElement), 'dark', undefined);
    expect(loader.attachMobileSeriesTapFeedback).not.toHaveBeenCalled();
  });
  it('does not paint after the picker closes during initialization', async () => {
    let resolve!: (value: typeof chart) => void;
    loader.init.mockReturnValueOnce(new Promise(done => resolve = done));
    const fixture = TestBed.createComponent(DashboardChartThumbnailComponent);
    fixture.componentRef.setInput('preview', example); fixture.detectChanges();
    fixture.destroy(); resolve(chart); await Promise.resolve(); await Promise.resolve();
    expect(loader.setOption).not.toHaveBeenCalled();
    expect(loader.dispose).toHaveBeenCalledWith(chart);
  });
});
