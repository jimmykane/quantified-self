import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardTodayComponent } from './dashboard-today.component';
import { DashboardTodayDataService, type TodayRecordedActivities } from '../../../services/dashboard-today-data.service';
import { AppUserService } from '../../../services/app.user.service';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { CalendarDayDetailsNavigationService } from '../../../services/calendar-day-details-navigation.service';
import { defaultDashboardTodaySettings } from '../../../helpers/dashboard-today-settings.helper';
import type { AppUserInterface } from '../../../models/app-user.interface';

const owner = { uid: 'owner' } as AppUserInterface;
const row = { id: 'ride', name: 'Morning mountain bike ride', tags: ['Race'], activityType: 'Mountain Biking',
  duration: '1h 36m', route: ['/user', 'owner', 'event', 'ride'] };
const ready = (): TodayRecordedActivities => ({ ownerUid: 'owner', date: '2026-11-11', status: 'ready', rows: [row], complete: true });

describe('Today recorded activities', () => {
  const users = { user: signal<AppUserInterface | null>(null) };
  const data = { connect: vi.fn(), metrics: signal({}), activities: signal(ready()), retryActivities: vi.fn() };
  const haptics = { selection: vi.fn() };
  const navigation = { prepareReturn: vi.fn() };
  const config = (enabled: boolean) => ({ ...defaultDashboardTodaySettings(), trainingState: false,
    readiness: false, metrics: [], recordedActivities: enabled });
  beforeEach(() => {
    vi.clearAllMocks(); users.user.set(owner); data.activities.set(ready()); data.retryActivities.mockReturnValue(true);
    TestBed.configureTestingModule({ imports: [DashboardTodayComponent], providers: [provideRouter([]),
      { provide: AppUserService, useValue: users }, { provide: AppHapticsService, useValue: haptics },
      { provide: CalendarDayDetailsNavigationService, useValue: navigation },
      { provide: AppEventColorService, useValue: { getColorForActivityTypeByActivityTypeGroup: () => '' } },
    ] });
    TestBed.overrideComponent(DashboardTodayComponent, { set: { providers: [{ provide: DashboardTodayDataService, useValue: data }] } });
  });
  const render = (enabled = true) => {
    const fixture = TestBed.createComponent(DashboardTodayComponent);
    for (const [key, value] of Object.entries({ account: owner, owner: true, localDate: '2026-11-11',
      settings: config(enabled), readiness: {}, trainingState: {} })) fixture.componentRef.setInput(key, value);
    fixture.detectChanges(); return fixture;
  };
  it('renders the reused calendar row only when selected, with tags, duration and event navigation', () => {
    const fixture = render(false), host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('app-calendar-activity-row')).toBeNull();
    expect(host.textContent).toContain('No items selected');
    fixture.componentRef.setInput('settings', config(true)); fixture.detectChanges();
    const shared = host.querySelector('app-calendar-activity-row')!;
    expect(shared.textContent).toContain(row.name); expect(shared.textContent).toContain('Race');
    expect(shared.textContent).toContain('1h 36m');
    expect(shared.querySelector('a')?.getAttribute('href')).toBe('/user/owner/event/ride');
    expect(host.querySelector('a[mat-button]')?.getAttribute('href')).toBe('/calendar/day/2026-11-11?from=dashboard');
    expect(host.querySelector('.dashboard-today-empty')).toBeNull();
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('distinguishes loading, empty, failed and partial reads; retry emits one accepted-action haptic', () => {
    const fixture = render(), host = fixture.nativeElement as HTMLElement;
    data.activities.set({ ...ready(), status: 'loading', rows: [] }); fixture.detectChanges();
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(host.textContent).toContain('Loading today’s activities');
    data.activities.set({ ...ready(), rows: [] }); fixture.detectChanges();
    expect(host.textContent).toContain('No activities recorded today.');
    data.activities.set({ ...ready(), status: 'error', rows: [] }); fixture.detectChanges();
    expect(host.textContent).toContain('Unable to load');
    host.querySelector<HTMLButtonElement>('button')!.click();
    expect(data.retryActivities).toHaveBeenCalledTimes(1); expect(haptics.selection).toHaveBeenCalledTimes(1);
    data.retryActivities.mockReturnValue(false); host.querySelector<HTMLButtonElement>('button')!.click();
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    data.activities.set({ ...ready(), complete: false }); fixture.detectChanges();
    expect(host.textContent).toContain('Some activities could not be loaded.');
    expect(host.querySelector('app-calendar-activity-row')).not.toBeNull();
  });
  it('never displays an old owner’s or previous day’s activity rows, including before the data effect reconnects', () => {
    const fixture = render(), host = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('localDate', '2026-11-12'); fixture.detectChanges();
    expect(host.querySelector('app-calendar-activity-row')).toBeNull();
    fixture.componentRef.setInput('localDate', '2026-11-11');
    users.user.set({ ...owner, uid: 'other' }); fixture.detectChanges();
    expect(host.querySelector('.dashboard-today-activities')).toBeNull();
    users.user.set(owner); fixture.componentRef.setInput('owner', false); fixture.detectChanges();
    expect(host.querySelector('.dashboard-today-activities')).toBeNull();
  });
  it('retains the calendar return date and gives event and full-day navigation one feedback owner each', () => {
    const fixture = render(), host = fixture.nativeElement as HTMLElement;
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const activity = host.querySelector<HTMLAnchorElement>('app-calendar-activity-row a')!;
    activity.addEventListener('click', event => event.preventDefault()); activity.click();
    expect(navigation.prepareReturn).toHaveBeenCalledWith('/', '2026-11-11');
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    const fullDay = host.querySelector<HTMLAnchorElement>('a[mat-button]')!;
    fullDay.addEventListener('click', event => event.preventDefault()); fullDay.click();
    expect(haptics.selection).toHaveBeenCalledTimes(2);
  });
});
