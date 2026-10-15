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
    expect(host.querySelector('[role="status"]')?.textContent).toContain('outside its usual range');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('.health-change-notice')?.textContent).toContain('Outside personal range');
    expect(haptics.selection).not.toHaveBeenCalled();
    button.click(); fixture.detectChanges();
    expect(details.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('signals', [{ ...signals[0], state: 'within-range', statusText: 'Within personal range' }]);
    fixture.detectChanges();
    expect(details.hidden).toBe(false);
    expect(host.querySelector('.health-change-notice')).toBeNull();
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('scopeKey', 'second-owner'); fixture.detectChanges();
    expect(details.hidden).toBe(true);
    expect(haptics.selection).toHaveBeenCalledTimes(1);
  });
});
