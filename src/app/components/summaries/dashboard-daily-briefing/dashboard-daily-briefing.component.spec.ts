import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DashboardDailyBriefingComponent } from './dashboard-daily-briefing.component';
import { AppUserService } from '../../../services/app.user.service';
import { AppHapticsService } from '../../../services/app.haptics.service';
import type { AppUserInterface } from '../../../models/app-user.interface';
import type { HealthChangeSignal } from '../../../helpers/health-change-summary.helper';

const owner = { uid: 'owner' } as AppUserInterface;
const evidence: HealthChangeSignal[] = [{ id: 'readiness', label: 'Readiness', sourceLabel: '', state: 'attention',
  statusText: 'Mixed', summaryText: 'Readiness is Mixed', detailText: '' }];

describe('Dashboard daily briefing', () => {
  function render(user = owner) {
    const authenticated = signal<AppUserInterface | null>(owner);
    const haptics = { selection: vi.fn() };
    // No Calendar, Training, Firestore or clock providers: presentation reuses Today inputs only.
    TestBed.configureTestingModule({ imports: [DashboardDailyBriefingComponent], providers: [
      { provide: AppUserService, useValue: { user: authenticated } }, { provide: AppHapticsService, useValue: haptics },
    ] });
    const fixture = TestBed.createComponent(DashboardDailyBriefingComponent);
    fixture.componentRef.setInput('user', user); fixture.componentRef.setInput('signals', evidence); fixture.detectChanges();
    return { fixture, authenticated, haptics, host: fixture.nativeElement as HTMLElement };
  }
  it('renders one colored sentence as an accessible Today details control without duplicate metrics', () => {
    const { host, haptics } = render();
    expect(host.querySelector('[role=status]')?.textContent).toBe('Readiness is Mixed.');
    expect(host.querySelector('[aria-label="At a glance"]')?.getAttribute('aria-label')).toBe('At a glance');
    expect(host.querySelector('[aria-label="At a glance"]')?.getAttribute('data-tone')).toBe('caution');
    expect(host.querySelector('h2, h3, dl')).toBeNull();
    expect(host.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('button')?.getAttribute('aria-controls')).toBe('dashboard-today-details');
    expect(host.querySelector('button')?.getAttribute('aria-label')).toBe('Show Today details: Readiness is Mixed.');
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('joins the greeting and assessment in one continuous sentence with no separate row or status icon', () => {
    const { fixture, host, haptics } = render();
    fixture.componentRef.setInput('greeting', 'Good morning, Morgan'); fixture.detectChanges();
    const button = host.querySelector('button')!;
    expect(button.textContent?.trim()).toBe('Good morning, Morgan — readiness is Mixed.');
    expect(button.querySelector('.dashboard-today-greeting')?.textContent).toBe('Good morning, Morgan');
    expect(button.querySelector('[role=status]')?.textContent).toBe('readiness is Mixed.');
    expect(host.querySelector('section, p, br, mat-icon, .dashboard-briefing-dot')).toBeNull();
    expect(button.getAttribute('aria-label')).toBe('Show Today details: Good morning, Morgan — readiness is Mixed.');
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('renders green, caution and unavailable phrases independently in the same sentence', () => {
    const { fixture, host } = render();
    fixture.componentRef.setInput('greeting', 'Good morning, Morgan');
    fixture.componentRef.setInput('signals', [
      { ...evidence[0], id: 'training-load', state: 'available', summaryText: 'Training state is Balanced' },
      evidence[0],
      { ...evidence[0], id: 'hrv', state: 'within-range' },
    ]); fixture.detectChanges();
    const phrases = () => [...host.querySelectorAll<HTMLElement>('.dashboard-briefing-phrase')]
      .filter(phrase => phrase.dataset.tone !== 'neutral');
    expect(phrases().map(phrase => phrase.dataset.tone)).toEqual(['positive', 'caution', 'positive']);
    expect(host.querySelector('[role=status]')?.textContent).toBe('training state is Balanced, readiness is Mixed, and 7-day HRV is within your usual range.');
    fixture.componentRef.setInput('signals', [
      { ...evidence[0], id: 'training-load', state: 'available', summaryText: 'Training state is Balanced' },
      { ...evidence[0], state: 'unavailable', summaryText: 'Readiness is unavailable' },
    ]); fixture.detectChanges();
    expect(phrases().map(phrase => phrase.dataset.tone)).toEqual(['positive', 'error']);
  });
  it('requests disclosure once per accepted tap and reflects the parent’s expanded state', () => {
    const { fixture, host, haptics } = render();
    const toggle = vi.fn(); fixture.componentInstance.detailsToggle.subscribe(toggle);
    host.querySelector<HTMLButtonElement>('button')!.click();
    expect(toggle).toHaveBeenCalledOnce(); expect(haptics.selection).toHaveBeenCalledOnce();
    fixture.componentRef.setInput('detailsExpanded', true); fixture.detectChanges();
    expect(host.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('button')?.getAttribute('aria-label')).toBe('Hide Today details: Readiness is Mixed.');
    expect(haptics.selection).toHaveBeenCalledOnce();
  });
  it('does not render another owner and clears on sign-out', () => {
    const { fixture, authenticated, host } = render({ ...owner, uid: 'other' });
    expect(host.querySelector('[aria-label="At a glance"]')).toBeNull();
    fixture.componentRef.setInput('user', owner); fixture.detectChanges(); expect(host.querySelector('[aria-label="At a glance"]')).not.toBeNull();
    authenticated.set(null); fixture.detectChanges(); expect(host.querySelector('[aria-label="At a glance"]')).toBeNull();
  });
  it('updates from Today assessment resets without keeping a stale caution message', () => {
    const { fixture, host, haptics } = render();
    fixture.componentRef.setInput('signals', evidence.map(signal => ({ ...signal, state: 'loading' }))); fixture.detectChanges();
    expect(host.querySelector('[role=status]')?.textContent).toBe('Today’s training and recovery signals are still loading.');
    expect(host.querySelector('[aria-label="At a glance"]')?.getAttribute('data-tone')).toBe('neutral');
    expect(haptics.selection).not.toHaveBeenCalled();
  });
});
