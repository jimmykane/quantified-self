import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';
import { MetricHistoryChartComponent } from './metric-history-chart.component';

const time = Date.UTC(2026, 7, 3);
const history = {
  caption: '8-week history', points: [
    { time, value: -2, valueText: '-2' },
    { time: time + 7 * 86400000, value: null, valueText: 'Unavailable' },
    { time: time + 14 * 86400000, value: 3.2, valueText: '+3.2' },
  ],
};

async function setup() {
  const chart = { dispatchAction: vi.fn(), isDisposed: vi.fn(() => false) };
  const detach = vi.fn();
  const loader = {
    init: vi.fn().mockResolvedValue(chart), setOption: vi.fn(), dispose: vi.fn(), resize: vi.fn(),
    attachMobileSeriesTapFeedback: vi.fn(() => detach), subscribeToViewportResize: vi.fn(() => () => undefined),
  };
  const haptics = { selection: vi.fn() };
  await TestBed.configureTestingModule({
    imports: [MetricHistoryChartComponent],
    providers: [
      { provide: EChartsLoaderService, useValue: loader },
      { provide: LoggerService, useValue: { error: vi.fn() } },
      { provide: AppHapticsService, useValue: haptics },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(MetricHistoryChartComponent);
  fixture.componentRef.setInput('history', history);
  fixture.componentRef.setInput('label', 'Form now');
  fixture.detectChanges();
  await fixture.whenStable();
  await vi.waitFor(() => expect(loader.setOption).toHaveBeenCalled());
  const option = () => loader.setOption.mock.calls.at(-1)![1] as any;
  return { fixture, loader, chart, detach, haptics, option };
}

describe('MetricHistoryChartComponent', () => {
  it('shares the host lifecycle and haptic owner while hydration stays silent', async () => {
    const { fixture, loader, chart, detach, haptics, option } = await setup();
    expect(option().series[0].type).toBe('bar');
    expect(loader.attachMobileSeriesTapFeedback).toHaveBeenCalledTimes(1);
    expect(haptics.selection).not.toHaveBeenCalled();
    const image = fixture.nativeElement.querySelector('[role="img"]') as HTMLElement;
    expect(image.getAttribute('aria-label')).toContain('+3.2');
    expect(image.getAttribute('aria-label')).toContain('Unavailable');

    fixture.componentRef.setInput('darkTheme', true);
    fixture.detectChanges();
    await vi.waitFor(() => expect(loader.init).toHaveBeenLastCalledWith(image, 'dark', undefined));
    await vi.waitFor(() => expect(loader.setOption).toHaveBeenCalledTimes(2));
    expect(haptics.selection).not.toHaveBeenCalled();
    fixture.destroy();
    expect(detach).toHaveBeenCalled();
    expect(loader.dispose).toHaveBeenCalledWith(chart);
  });

  it('uses preformatted values and the shared escaped tooltip for weekly history', async () => {
    const { option } = await setup();
    const tooltip = option().tooltip.formatter([{ data: [time + 14 * 86400000, 3.2] }]);
    expect(tooltip).toContain('+3.2');
    expect(tooltip).toContain('Week');
    expect(option().series[0].data[1]).toEqual([time + 7 * 86400000, null]);
  });

  it('uses click tooltips on phones and identifies the forecast as a scenario', async () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as any;
    try {
      const { fixture, option, loader, haptics } = await setup();
      expect(option().tooltip.triggerOn).toBe('click');
      fixture.componentRef.setInput('history', { ...history, mode: 'forecast', caption: 'Next 7 days · no additional load' });
      fixture.detectChanges();
      await vi.waitFor(() => expect(loader.setOption).toHaveBeenCalledTimes(2));
      expect(option().series[0]).toMatchObject({ type: 'line', connectNulls: false, lineStyle: { type: 'dashed' } });
      expect(option().tooltip.formatter([{ data: [time, -2] }])).toContain('a scenario, not a prediction');
      expect(haptics.selection).not.toHaveBeenCalled();
    } finally {
      window.matchMedia = original;
    }
  });
});
