import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { Auth } from 'app/firebase/auth';
import { AppUserService } from './app.user.service';
import { PlanGenerationService } from './plan-generation.service';
const sdk = vi.hoisted(() => ({ authState: vi.fn() }));
vi.mock('app/firebase/auth', async original => ({ ...await original<typeof import('app/firebase/auth')>(), authState: sdk.authState }));
function setup() {
  const auth = { currentUser: { uid: 'owner' } }, user = signal({ uid: 'owner' });
  const changes = new BehaviorSubject(auth.currentUser); sdk.authState.mockReturnValue(changes);
  const request = { prompt: 'Create a new training plan', timelineNotesEnabled: true };
  const open = vi.fn().mockReturnValue({ afterClosed: () => of(request) });
  const navigate = vi.fn().mockResolvedValue(true);
  TestBed.configureTestingModule({ providers: [PlanGenerationService, { provide: Auth, useValue: auth },
    { provide: AppUserService, useValue: { user } }, { provide: MatDialog, useValue: { open } }, { provide: Router, useValue: { navigate } }] });
  return { service: TestBed.inject(PlanGenerationService), auth, user, changes, request, open, navigate };
}
describe('Plan generation handoff', () => {
  it('hands off once without exposing the prompt in navigation', async () => {
    const { service, navigate, request } = setup();
    await service.open('owner', () => true);
    expect(navigate).toHaveBeenCalledWith(['/ai-insights']);
    expect(service.take('owner')).toEqual(request);
    expect(service.take('owner')).toBeNull();
  });
  it.each(['owner', 'session', 'view'])('drops stale %s results after lazy loading', async change => {
    const { service, auth, user, open, navigate } = setup(); let current = true;
    const pending = service.open('owner', () => current);
    if (change === 'owner') { auth.currentUser = { uid: 'other' }; user.set({ uid: 'other' }); }
    if (change === 'session') auth.currentUser = { uid: 'owner' };
    if (change === 'view') current = false;
    await pending;
    expect(open).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled(); expect(service.take('owner')).toBeNull();
  });
  it('drops cancelled, expired and failed navigation handoffs', async () => {
    const { service, open, navigate } = setup();
    open.mockReturnValueOnce({ afterClosed: () => of(undefined) });
    await service.open('owner', () => true); expect(navigate).not.toHaveBeenCalled();
    await service.open('owner', () => true);
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60_000);
    expect(service.take('owner')).toBeNull(); now.mockRestore();
    navigate.mockResolvedValueOnce(false);
    await expect(service.open('owner', () => true)).rejects.toThrow('Could not open Assistant');
    expect(service.take('owner')).toBeNull();
  });
  it('clears staged private text when the auth session changes', async () => {
    const { service, auth, changes } = setup();
    await service.open('owner', () => true);
    changes.next({ uid: 'other' }); changes.next(auth.currentUser);
    expect(service.take('owner')).toBeNull();
  });
});
