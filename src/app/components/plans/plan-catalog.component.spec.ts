import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Auth } from 'app/firebase/auth';
import { describe, expect, it, vi } from 'vitest';
import { AppUserService } from '../../services/app.user.service';
import { AppFunctionsService } from '../../services/app.functions.service';
import { PlanCatalogComponent } from './plan-catalog.component';

describe('whole-plan library', () => {
  async function setup() {
    const owner = { uid: 'athlete' }, user = signal(owner);
    const auth = { currentUser: owner };
    const request = vi.fn();
    TestBed.configureTestingModule({ imports: [PlanCatalogComponent], providers: [
      provideRouter([]), { provide: Auth, useValue: auth }, { provide: AppUserService, useValue: { user } },
      { provide: AppFunctionsService, useValue: { call: request } },
    ] });
    const fixture = TestBed.createComponent(PlanCatalogComponent);
    fixture.detectChanges(); await fixture.whenStable();
    return { component: fixture.componentInstance, fixture, request, user, auth };
  }
  const preview = { id: 'review', name: '10K Race', start: '2026-11-30', end: '2027-02-07', dates: ['2027-02-07'], restDays: [], conflicts: [] };
  it('opens with eight free programs, reads weeks, and requires a new review when a date changes', async () => {
    const { component, fixture, request } = await setup();
    expect(component.items()).toHaveLength(8);
    await component.select(component.items().find(p => p.id === '10k')!);
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
  it('credits the licensed edition and offers only its fixed date spacing', async () => {
    const { component, fixture } = await setup();
    await component.select(component.items().find(p => p.id === 'tredict-running-base')!);
    fixture.detectChanges();
    const html = fixture.nativeElement;
    expect(html.querySelector('a[rel="license"]').href).toBe('https://creativecommons.org/licenses/by/4.0/');
    expect(html.textContent).toContain('Felix Gertz');
    expect(html.textContent).toContain('example plan');
    expect(html.textContent).toContain('Day 1');
    expect(html.textContent).toContain('68% of your maximum heart rate');
    expect(html.textContent).not.toContain('Long session');
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
