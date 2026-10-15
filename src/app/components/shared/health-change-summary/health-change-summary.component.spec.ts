import { TestBed } from '@angular/core/testing';
import { HealthChangeSummaryComponent } from './health-change-summary.component';
import { AppHapticsService } from '../../../services/app.haptics.service';
import type { HealthChangeSignal } from '../../../helpers/health-change-summary.helper';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
    expect(host.querySelector('.health-change-glance-icon')).toBeNull();
    expect(host.querySelector('section')?.hasAttribute('data-glance-state')).toBe(false);
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
    expect(host.querySelector('section')?.getAttribute('data-glance-state')).toBe('within-range');
    expect(host.querySelector('.health-change-glance-icon')).toBeNull();
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

  it('keeps Dashboard attention states sentence-only without mounting a duplicate breakdown', () => {
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
    expect(host.querySelector('section')?.getAttribute('data-glance-state')).toBe('outside-range');
    expect(host.querySelector('.health-change-glance-icon')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Your 7-day HRV average is outside your usual range.');
    expect(host.querySelector('button')).toBeNull();
    expect(host.querySelector('#glance-details')).toBeNull();
    expect(host.querySelector('dl')).toBeNull();
    expect(host.querySelectorAll('p')).toHaveLength(1);
    fixture.componentInstance.toggleDetails(); fixture.detectChanges();
    expect(fixture.componentInstance.expanded()).toBe(false);
    expect(haptics.selection).not.toHaveBeenCalled();
  });

  it('removes an open Health disclosure when switching to Dashboard mode and restores Health collapsed', () => {
    const fixture = TestBed.createComponent(HealthChangeSummaryComponent);
    fixture.componentRef.setInput('scopeKey', 'owner');
    fixture.componentRef.setInput('summaryId', 'summary');
    fixture.componentRef.setInput('signals', [{ id: 'hrv', label: 'HRV', state: 'outside-range',
      sourceLabel: 'Suunto', statusText: 'Outside range', detailText: '7-day average compared with 60 days' }]);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    host.querySelector('button')!.click(); fixture.detectChanges();
    expect(host.querySelector<HTMLElement>('#summary-details')?.hidden).toBe(false);
    fixture.componentRef.setInput('compact', true); fixture.detectChanges();
    expect(host.querySelector('button')).toBeNull();
    expect(host.querySelector('#summary-details')).toBeNull();
    expect(fixture.componentInstance.expanded()).toBe(false);
    fixture.componentInstance.toggleDetails();
    fixture.componentRef.setInput('compact', false); fixture.detectChanges();
    expect(host.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector<HTMLElement>('#summary-details')?.hidden).toBe(true);
    expect(host.querySelector('#summary-details')?.textContent).toContain('Suunto');
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    host.querySelector('button')!.click();
    fixture.detectChanges();
    expect(host.querySelector<HTMLElement>('#summary-details')?.hidden).toBe(false);
    expect(haptics.selection).toHaveBeenCalledTimes(2);
  });

  it.each(['within-range', 'outside-range', 'attention', 'available', 'unavailable', 'loading', 'insufficient', 'recorded'] as const)('uses a %s rail without a standalone status icon', state => {
    const fixture = TestBed.createComponent(HealthChangeSummaryComponent);
    fixture.componentRef.setInput('compact', true);
    fixture.componentRef.setInput('scopeKey', 'owner');
    fixture.componentRef.setInput('summaryId', 'glance');
    fixture.componentRef.setInput('signals', [{ id: state === 'attention' || state === 'available' ? 'readiness' : 'hrv', label: 'HRV', sourceLabel: 'Suunto',
      state, statusText: state, detailText: 'Same-source evidence' }]);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('section')?.getAttribute('data-glance-state')).toBe(state);
    expect(host.querySelector('.health-change-glance-icon')).toBeNull();
    expect(host.querySelector('.health-change-heading > mat-icon')).toBeNull();
    expect(host.querySelector('button')).toBeNull();
    expect(host.querySelector('dl')).toBeNull();
    expect(host.querySelectorAll('p')).toHaveLength(1);
    expect(haptics.selection).not.toHaveBeenCalled();
  });
});

describe('Dashboard accent rail style contract', () => {
  it('keeps the rail surface-free with wrapping content and Health’s existing touch target', () => {
    const styles = readFileSync(resolve(__dirname, 'health-change-summary.component.scss'), 'utf8');
    expect(styles).toContain('border-inline-start: 3px solid var(--health-glance-accent)');
    expect(styles).toContain('border-bottom: 0');
    expect(styles).toContain('grid-template-columns: minmax(0, 1fr); align-items: start');
    expect(styles).not.toContain('grid-template-columns: minmax(0, 1fr) auto');
    expect(styles).not.toContain('.health-change-heading button { grid-column:');
    expect(styles).toContain('overflow-wrap: anywhere');
    expect(styles).toContain('min-height: 44px');
    expect(styles).not.toMatch(/box-shadow|background:|border-radius|::ng-deep|\.mdc-/);
  });
});
