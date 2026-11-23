import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Auth } from 'app/firebase/auth';
import { describe, expect, it, vi } from 'vitest';
import { AppUserService } from '../../services/app.user.service';
import { AppFunctionsService } from '../../services/app.functions.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { PlanCatalogComponent } from './plan-catalog.component';

describe('whole-plan library', () => {
  async function setup() {
    const owner = { uid: 'athlete' }, user = signal(owner);
    const auth = { currentUser: owner };
    const request = vi.fn();
    const haptics = { selection: vi.fn(), error: vi.fn() };
    TestBed.configureTestingModule({ imports: [PlanCatalogComponent], providers: [
      provideRouter([]), { provide: AppHapticsService, useValue: haptics }, { provide: Auth, useValue: auth }, { provide: AppUserService, useValue: { user } },
      { provide: AppFunctionsService, useValue: { call: request } },
    ] });
    const fixture = TestBed.createComponent(PlanCatalogComponent);
    fixture.detectChanges(); await fixture.whenStable();
    return { component: fixture.componentInstance, fixture, request, user, auth, haptics };
  }
  const preview = { id: 'review', name: '10K Race', start: '2026-11-30', end: '2027-02-07', dates: ['2027-02-07'], restDays: [], conflicts: [] };
  it('opens with eight free programs, reads weeks, and requires a new review when a date changes', async () => {
    const { component, fixture, request } = await setup();
    expect(component.items()).toHaveLength(8);
    await component.selectById('10k');
    component.week.set(9);
    component.change({ anchor: 'finish', date: '2027-02-07' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Event week');
    expect(component.weekRows().at(-1)?.title).toBe('10K Race');
    expect(request).not.toHaveBeenCalled();
    request.mockResolvedValue({ data: preview });
    await component.review();
    expect(request.mock.calls[0][1]).toMatchObject({ action: 'preview', id: '10k', options: { longDay: 0 } });
    expect(component.preview()).toEqual(preview);
    component.change({ date: '2027-02-08' });
    await component.confirm();
    expect(request).toHaveBeenCalledTimes(1);
    await component.review();
    request.mockResolvedValue({ data: { planId: 'new-plan' } });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await component.confirm();
    expect(request.mock.calls.at(-1)?.[1]).toEqual({ action: 'apply', proposalId: 'review' });
    expect(navigate).toHaveBeenCalledWith(['/training/plans/plan', 'new-plan']);
  });
  it('keeps the selected public plan in the URL and resets its preview on history navigation', async () => {
    const { component, fixture, request, haptics } = await setup();
    const router = TestBed.inject(Router);
    expect(haptics.selection).not.toHaveBeenCalled();
    await component.selectById('10k');
    expect(router.url).toContain('template=10k');
    expect(component.selected()?.id).toBe('10k');
    await component.selectById('10k');
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    component.week.set(4);
    request.mockResolvedValue({ data: preview });
    await component.review();
    fixture.detectChanges(); await fixture.whenStable();
    expect(document.activeElement?.id).toBe('plan-review-heading');
    expect(fixture.nativeElement.querySelector('#plan-review-heading').parentElement.textContent).not.toContain('Rest ·');
    await router.navigateByUrl('/?template=tredict-running-base');
    expect(component.selected()?.id).toBe('tredict-running-base');
    expect(component.week()).toBe(0);
    expect(component.preview()).toBeNull();
  });
  it('disables preview for cleared or invalid dates without scheduling the previous value', async () => {
    const { component, fixture, request } = await setup();
    const date: HTMLInputElement = fixture.nativeElement.querySelector('input[matInput]');
    for (const text of ['not a date', '']) {
      date.value = text;
      date.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(component.options().date).toBe('');
      await component.review();
      expect(request).not.toHaveBeenCalled();
    }
  });
  it('keeps an uncertain confirmation retryable and requires a new preview after a definitive stale result', async () => {
    const { component, fixture, request, haptics } = await setup();
    request.mockResolvedValueOnce({ data: preview });
    await component.review();
    request.mockRejectedValueOnce(new Error('Connection interrupted.'));
    await component.confirm();
    expect(component.preview()).toBe(preview);
    request.mockRejectedValueOnce(Object.assign(new Error('Schedule changed.'), { details: { requiresNewPreview: true } }));
    await component.confirm();
    fixture.detectChanges(); await fixture.whenStable();
    expect(component.preview()).toBeNull();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('[role=alert]'));
    expect(haptics.error).toHaveBeenCalledTimes(1);
    await component.confirm();
    expect(request).toHaveBeenCalledTimes(3);
  });
  it('credits the licensed edition and offers only its fixed date spacing', async () => {
    const { component, fixture } = await setup();
    await component.selectById('tredict-running-base');
    fixture.detectChanges();
    const html = fixture.nativeElement;
    expect(html.querySelector('a[rel="license"]').href).toBe('https://creativecommons.org/licenses/by/4.0/');
    expect(html.textContent).toContain('Felix Gertz');
    expect(html.textContent).toContain('example plan');
    expect(html.textContent).toContain('Day 1');
    expect(html.textContent).toContain('68% of your maximum heart rate');
    expect(html.textContent).not.toContain('Long session');
    expect(html.textContent).toContain('Keep the first week easy as you return to running.');
    component.week.set(1); fixture.detectChanges();
    expect(html.textContent).toContain('Day 9');
    expect(html.textContent).toContain('Keep a steady running rhythm and introduce short faster efforts.');
    expect(html.textContent).not.toContain('Keep the first week easy as you return to running.');
  });
  it('labels a personal revision separately from the original work and author', async () => {
    const { component, request, fixture } = await setup();
    await component.selectById('tredict-running-base');
    const original = component.selected()!;
    const copy = { ...original, source: 'private', id: 'saved', version: 4, name: 'My spring block',
      attribution: { ...original.attribution, privateCopy: true } };
    request.mockResolvedValueOnce({ data: [{ ...copy, workoutCount: copy.sessions.length }] }).mockResolvedValueOnce({ data: copy });
    await component.openSource('private'); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('article > small').textContent).toContain('Personal template · Saved revision 4');
    expect(fixture.nativeElement.querySelector('h2').textContent).toBe('My spring block');
    const credit = fixture.nativeElement.querySelector('section[aria-label="Plan attribution"]');
    expect(credit.textContent).toContain(original.name);
    expect(credit.textContent).toContain('Felix Gertz');
  });
  it('discards private data received after an account switch', async () => {
    const { component, request, user, auth, fixture } = await setup();
    let resolve!: (v: unknown) => void;
    request.mockImplementation(() => new Promise(r => { resolve = r; }));
    const pending = component.openSource('private');
    auth.currentUser = { uid: 'second' }; user.set(auth.currentUser);
    resolve({ data: [{ id: 'private-canary' }] });
    await pending; fixture.detectChanges(); await fixture.whenStable();
    expect(component.source()).toBe('catalog');
    expect(component.items().some(i => i.id === 'private-canary')).toBe(false);
  });
});
