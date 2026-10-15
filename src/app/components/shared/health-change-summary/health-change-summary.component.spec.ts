import { TestBed } from '@angular/core/testing';
import { HealthChangeSummaryComponent } from './health-change-summary.component';
import { AppHapticsService } from '../../../services/app.haptics.service';
import type { HealthChangeSignal } from '../../../helpers/health-change-summary.helper';

describe('Health change summary disclosure', () => {
  const haptics = { selection: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({ imports: [HealthChangeSummaryComponent], providers: [
      { provide: AppHapticsService, useValue: haptics },
    ] });
  });
  it('keeps changes visible with details collapsed and resets silently for another owner', () => {
    const fixture = TestBed.createComponent(HealthChangeSummaryComponent);
    const signals: HealthChangeSignal[] = [{ id: 'hrv', label: 'HRV', sourceLabel: 'Suunto · Overnight average',
      state: 'outside-range', statusText: 'Outside personal range', detailText: '7-day average compared with 60 days' }];
    fixture.componentRef.setInput('signals', signals);
    fixture.componentRef.setInput('scopeKey', 'first-owner');
    fixture.componentRef.setInput('summaryId', 'test-summary');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const button = host.querySelector('button')!;
    const details = host.querySelector<HTMLElement>('#test-summary-details')!;
    expect(details.hidden).toBe(true);
    expect(host.querySelector('h2')?.textContent).toBe('Your recovery');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('outside your usual range');
    expect(host.querySelector('.health-change-scope')?.textContent).toBe('From your latest sleep and nightly HRV readings.');
    const coverage = host.querySelector('.health-change-coverage')!;
    expect(coverage.textContent).toBe('1 outside usual range');
    expect(details.contains(coverage)).toBe(false);
    expect(coverage.closest('[hidden]')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('.health-change-notice')?.textContent).toContain('Outside personal range');
    expect(haptics.selection).not.toHaveBeenCalled();
    button.click(); fixture.detectChanges();
    expect(details.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(details.textContent).toContain('Suunto · Overnight average');
    expect(details.textContent).toContain('7-day average compared with 60 days');
    expect(details.querySelector('.health-change-footnote')).toBeNull();
    expect(details.textContent).not.toContain('This is not medical advice');
    expect(details.textContent).not.toContain('Your charts remain below');
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('signals', [{ ...signals[0], state: 'within-range', statusText: 'Within personal range' }]);
    fixture.detectChanges();
    expect(details.hidden).toBe(false);
    expect(host.querySelector('.health-change-notice')).toBeNull();
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('scopeKey', 'second-owner'); fixture.detectChanges();
    expect(details.hidden).toBe(true);
    expect(coverage.textContent).toBe('1 within usual range');
    expect(coverage.closest('[hidden]')).toBeNull();
    expect(haptics.selection).toHaveBeenCalledTimes(1);
  });

  it('shows only one sentence on ordinary Dashboard days without extra rows or a disclosure', () => {
    const fixture = TestBed.createComponent(HealthChangeSummaryComponent);
    fixture.componentRef.setInput('compact', true);
    fixture.componentRef.setInput('scopeKey', 'owner');
    fixture.componentRef.setInput('summaryId', 'glance');
    fixture.componentRef.setInput('signals', [
      { id: 'hrv', label: 'HRV', sourceLabel: 'Suunto', state: 'within-range',
        statusText: 'Within range', detailText: '7-day average compared with 60 days' },
      { id: 'sleep', label: 'Sleep', sourceLabel: 'Suunto', state: 'recorded',
        statusText: 'Latest night', detailText: 'Latest sleep reading' },
    ]);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('h2')?.textContent).toBe('At a glance');
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Your 7-day HRV average is within your usual range.');
    expect(host.querySelector('button')).toBeNull();
    expect(host.querySelectorAll('p')).toHaveLength(1);
    expect(host.querySelectorAll('dt')).toHaveLength(0);
    expect(host.querySelector('.health-change-notice')).toBeNull();
    expect(host.textContent).not.toContain('This is not medical advice');
    fixture.componentInstance.toggleDetails(); fixture.detectChanges();
    expect(fixture.componentInstance.expanded()).toBe(false);
    expect(haptics.selection).not.toHaveBeenCalled();
  });

  it('discloses only signals needing attention and closes silently when they resolve or the owner changes', () => {
    const fixture = TestBed.createComponent(HealthChangeSummaryComponent);
    const attention: HealthChangeSignal = { id: 'hrv', label: 'HRV', sourceLabel: 'Suunto · Overnight average',
      state: 'outside-range', statusText: 'Below your usual range', detailText: '7-day average compared with 60 days' };
    const sleep: HealthChangeSignal = { id: 'sleep', label: 'Sleep', sourceLabel: 'Garmin · Selected source',
      state: 'unavailable', statusText: 'No reading from selected source', detailText: 'No recent Garmin sleep reading' };
    fixture.componentRef.setInput('compact', true);
    fixture.componentRef.setInput('scopeKey', 'first-owner');
    fixture.componentRef.setInput('summaryId', 'glance');
    fixture.componentRef.setInput('signals', [attention, sleep]);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const details = host.querySelector<HTMLElement>('#glance-details')!;
    const button = host.querySelector('button')!;
    expect(button.getAttribute('aria-controls')).toBe('glance-details');
    expect(details.hidden).toBe(true);
    button.click(); fixture.detectChanges();
    expect(details.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(details.textContent).toContain('Suunto · Overnight average');
    expect(details.textContent).toContain('7-day average compared with 60 days');
    expect(details.textContent).toContain('No recent Garmin sleep reading');
    expect(haptics.selection).toHaveBeenCalledTimes(1);

    fixture.componentRef.setInput('signals', [attention, { ...sleep, state: 'recorded' }]);
    fixture.detectChanges();
    expect(details.hidden).toBe(false);
    expect(details.querySelectorAll('dt')).toHaveLength(1);
    expect(details.textContent).not.toContain('Garmin');
    fixture.componentRef.setInput('scopeKey', 'second-owner'); fixture.detectChanges();
    expect(details.hidden).toBe(true);
    button.click(); fixture.detectChanges();
    expect(details.hidden).toBe(false);
    expect(haptics.selection).toHaveBeenCalledTimes(2);

    fixture.componentRef.setInput('signals', [{ ...attention, state: 'within-range' }]);
    fixture.detectChanges();
    expect(host.querySelector('button')).toBeNull();
    expect(details.hidden).toBe(true);
    expect(fixture.componentInstance.expanded()).toBe(false);
    expect(haptics.selection).toHaveBeenCalledTimes(2);
    fixture.componentRef.setInput('signals', [{ ...attention, state: 'insufficient' }]);
    fixture.detectChanges();
    expect(host.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
    expect(details.textContent).toContain('7-day average compared with 60 days');
    expect(haptics.selection).toHaveBeenCalledTimes(2);
  });
});
