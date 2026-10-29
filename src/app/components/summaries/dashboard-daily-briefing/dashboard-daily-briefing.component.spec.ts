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
  it('renders one colored sentence with an accessible label and no heading, control or duplicate metrics', () => {
    const { host, haptics } = render();
    expect(host.querySelector('[role=status]')?.textContent).toBe('Readiness is Mixed.');
    expect(host.querySelector('section')?.getAttribute('aria-label')).toBe('At a glance');
    expect(host.querySelector('section')?.getAttribute('data-tone')).toBe('caution');
    expect(host.querySelector('h2, h3, button, dl')).toBeNull(); expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('does not render another owner and clears on sign-out', () => {
    const { fixture, authenticated, host } = render({ ...owner, uid: 'other' });
    expect(host.querySelector('section')).toBeNull();
    fixture.componentRef.setInput('user', owner); fixture.detectChanges(); expect(host.querySelector('section')).not.toBeNull();
    authenticated.set(null); fixture.detectChanges(); expect(host.querySelector('section')).toBeNull();
  });
  it('updates from Today assessment resets without keeping a stale caution message', () => {
    const { fixture, host, haptics } = render();
    fixture.componentRef.setInput('signals', evidence.map(signal => ({ ...signal, state: 'loading' }))); fixture.detectChanges();
    expect(host.querySelector('[role=status]')?.textContent).toBe('Today’s training and recovery signals are still loading.');
    expect(host.querySelector('section')?.getAttribute('data-tone')).toBe('neutral');
    expect(haptics.selection).not.toHaveBeenCalled();
  });
});
