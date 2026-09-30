import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDashboardFormPointsFromDailyLoads } from '../../helpers/dashboard-form.helper';
import { chartViewportQueue } from '../../helpers/chart-viewport-queue';
import { AppHapticsService } from '../../services/app.haptics.service';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';
import { TrainingImpactRecapComponent } from './training-impact-recap.component';

describe('TrainingImpactRecapComponent', () => {
  const haptics = { selection: vi.fn() };
  const chart = { isDisposed: vi.fn(() => false), dispatchAction: vi.fn() };
  const loader = {
    init: vi.fn().mockResolvedValue(chart),
    load: vi.fn().mockResolvedValue(undefined),
    setOption: vi.fn(),
    dispose: vi.fn(),
    resize: vi.fn(),
    subscribeToViewportResize: vi.fn(() => () => undefined),
    attachMobileSeriesTapFeedback: vi.fn(() => () => undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(chartViewportQueue, 'wait').mockReturnValue({
      ready: Promise.resolve(true),
      cancel: vi.fn(),
    });
    TestBed.configureTestingModule({
      imports: [TrainingImpactRecapComponent],
      providers: [
        provideNoopAnimations(),
        { provide: AppHapticsService, useValue: haptics },
        { provide: EChartsLoaderService, useValue: loader },
        { provide: LoggerService, useValue: { error: vi.fn() } },
      ],
    });
  });

  function createReadyFixture() {
    const fixture = TestBed.createComponent(TrainingImpactRecapComponent);
    fixture.componentRef.setInput('nowMs', Date.UTC(2026, 8, 30, 12));
    fixture.componentRef.setInput('formStatus', 'ready');
    fixture.componentRef.setInput('points', buildDashboardFormPointsFromDailyLoads([
      { dayMs: Date.UTC(2026, 8, 20), load: 84, activityCount: 1 },
      { dayMs: Date.UTC(2026, 8, 24), load: 42, activityCount: 2 },
      { dayMs: Date.UTC(2026, 8, 29), load: 21, activityCount: 1 },
    ]));
    fixture.detectChanges();
    return fixture;
  }

  it('renders the seven-day result, exact counts, and chart by default', async () => {
    const fixture = createReadyFixture();
    await fixture.whenStable();
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('Training impact recap');
    expect(text).toContain('Completed activities');
    expect(text).toContain('3');
    expect(text).toContain('Daily');
    expect(fixture.componentInstance.periodDays()).toBe(7);
    await vi.waitFor(() => expect(loader.setOption).toHaveBeenCalled());
    expect(fixture.nativeElement.querySelector('[role="img"]')?.getAttribute('aria-label'))
      .toContain('7-day Training impact chart');
  });

  it('switches to four seven-day blocks with one selection haptic', async () => {
    const fixture = createReadyFixture();
    await fixture.whenStable();
    haptics.selection.mockClear();

    fixture.componentInstance.selectPeriod(28);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.periodDays()).toBe(28);
    expect(fixture.componentInstance.recap?.bars).toHaveLength(4);
    expect(fixture.nativeElement.textContent).toContain('Four consecutive 7-day blocks');
    const option = (fixture.componentInstance as unknown as {
      buildChartOption: () => { xAxis: { data: string[]; axisLabel: { interval: number } } };
    }).buildChartOption();
    expect(option.xAxis.axisLabel.interval).toBe(0);
    expect(option.xAxis.data).toHaveLength(4);
    expect(option.xAxis.data.every(label => !label.includes(' – '))).toBe(true);
    expect(haptics.selection).toHaveBeenCalledOnce();
    fixture.componentInstance.selectPeriod(28);
    expect(haptics.selection).toHaveBeenCalledOnce();
  });

  it('keeps retained results visible while updating or after a failed refresh', () => {
    const fixture = createReadyFixture();

    fixture.componentRef.setInput('formStatus', 'building');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Updating from the latest Form snapshot');

    fixture.componentRef.setInput('formStatus', 'failed');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Showing the last complete recap');
    expect(fixture.nativeElement.textContent).toContain('Actual result after decay');
  });

  it('renders a true held result without a signed zero or misleading positive-only axis', () => {
    const fixture = TestBed.createComponent(TrainingImpactRecapComponent);
    fixture.componentRef.setInput('nowMs', Date.UTC(2026, 8, 30, 12));
    fixture.componentRef.setInput('formStatus', 'ready');
    fixture.componentRef.setInput('points', buildDashboardFormPointsFromDailyLoads([
      { dayMs: Date.UTC(2026, 8, 29), load: 0, activityCount: 1 },
    ]));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Fitness load held');
    expect(fixture.nativeElement.textContent).not.toContain('+0 CTL');
    const option = (fixture.componentInstance as unknown as {
      buildChartOption: () => { yAxis: { min: number; max: number } };
    }).buildChartOption();
    expect(option.yAxis).toMatchObject({ min: -1, max: 1 });
  });

  it('distinguishes no history, preparing, and unavailable states', () => {
    const fixture = TestBed.createComponent(TrainingImpactRecapComponent);
    fixture.componentRef.setInput('points', []);
    fixture.componentRef.setInput('formStatus', 'ready');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No Training impact history yet');

    fixture.componentRef.setInput('points', null);
    fixture.componentRef.setInput('formStatus', 'stale');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Preparing Training impact recap');

    fixture.componentRef.setInput('formStatus', 'failed');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Training impact recap unavailable');
  });
});
