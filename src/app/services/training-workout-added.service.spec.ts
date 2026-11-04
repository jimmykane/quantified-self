import { EnvironmentInjector, createEnvironmentInjector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BehaviorSubject, Subject } from 'rxjs';
import { TrainingWorkoutAddedService } from './training-workout-added.service';
import { AppUserService } from './app.user.service';
import { AppHapticsService } from './app.haptics.service';
import { TrainingDeliveryDialogComponent } from '../components/plans/training-delivery-dialog.component';

function setup() {
  const user = signal<{ uid: string } | null>({ uid: 'owner' });
  const user$ = new BehaviorSubject(user());
  const action = new Subject<void>(), open = vi.fn(), dismiss = vi.fn(), selection = vi.fn();
  const snackbar = vi.fn(() => ({ onAction: () => action, dismiss }));
  TestBed.configureTestingModule({ providers: [
    { provide: AppUserService, useValue: { user, user$ } },
    { provide: MatDialog, useValue: { open } }, { provide: MatSnackBar, useValue: { open: snackbar } },
    { provide: AppHapticsService, useValue: { selection } },
  ] });
  return { service: TestBed.inject(TrainingWorkoutAddedService), user, user$, action, open, snackbar, dismiss, selection };
}

describe('saved-workout delivery shortcut', () => {
  it('survives destruction of the source view injector and only opens the existing review once', () => {
    const { service, action, open, selection } = setup();
    const view = createEnvironmentInjector([], TestBed.inject(EnvironmentInjector));
    expect(view.get(TrainingWorkoutAddedService)).toBe(service);
    service.show('Workout added.', { id: 'saved', title: 'Easy ride' });
    expect(open).not.toHaveBeenCalled(); view.destroy(); action.next(); action.next();
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith(TrainingDeliveryDialogComponent, expect.objectContaining({
      data: { scope: 'workout', id: 'saved', title: 'Easy ride' },
    }));
    expect(selection).toHaveBeenCalledOnce();
  });
  it('cancels the action on an account change, including a later switch back', () => {
    const { service, user, user$, action, open, dismiss } = setup();
    service.show('Workout added.', { id: 'saved', title: 'Easy ride' });
    user.set({ uid: 'other' }); user$.next(user()); user.set({ uid: 'owner' }); user$.next(user());
    action.next(); expect(open).not.toHaveBeenCalled(); expect(dismiss).toHaveBeenCalledOnce();
    expect(action.observed).toBe(false);
  });
  it('does not imply that a batch can be sent as one workout', () => {
    const { service, snackbar, action, open } = setup();
    service.show('3 workouts added.', null); action.next();
    expect(snackbar).toHaveBeenCalledWith('3 workouts added.', 'Dismiss', { duration: 8000 });
    expect(open).not.toHaveBeenCalled(); expect(action.observed).toBe(false);
  });
  it('releases the action when the notification ends', () => {
    const { service, action, open } = setup();
    service.show('Workout added.', { id: 'saved', title: 'Easy ride' });
    action.complete(); expect(action.observed).toBe(false); expect(open).not.toHaveBeenCalled();
  });
});
