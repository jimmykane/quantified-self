import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { firstValueFrom, Observable, Subject } from 'rxjs';
import { TRAINING_PLANNING_UI_ALLOWED_UIDS, isTrainingPlanningUIAllowed } from '@shared/training-planning-rollout';
import { AppAuthService } from './app.auth.service';
import { trainingPlanningGuard } from './training-planning.guard';

describe('Training Planning UI rollout', () => {
  it.each([undefined, null, '', 'another-user', 'xcsAolLDDTWTgtRN9eYF3lW2YKL2-other'])('does not allow UID %s', uid => {
    expect(isTrainingPlanningUIAllowed(uid)).toBe(false);
  });

  it('keeps the rollout limited to the configured account', () => {
    expect(TRAINING_PLANNING_UI_ALLOWED_UIDS).toEqual(['xcsAolLDDTWTgtRN9eYF3lW2YKL2']);
    expect(isTrainingPlanningUIAllowed(TRAINING_PLANNING_UI_ALLOWED_UIDS[0])).toBe(true);
  });

  it.each([TRAINING_PLANNING_UI_ALLOWED_UIDS[0], 'another-user', null])('waits for auth and handles direct URLs for %s', async uid => {
    const authState$ = new Subject<{ uid: string } | null>();
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: AppAuthService, useValue: { authState$ } }] });
    const router = TestBed.inject(Router);
    const result = TestBed.runInInjectionContext(() => trainingPlanningGuard({}, []));
    let settled = false;
    const pending = firstValueFrom(result as Observable<boolean | import('@angular/router').UrlTree>).then(value => {
      settled = true;
      return value;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    authState$.next(uid ? { uid } : null);
    const value = await pending;
    if (uid === 'another-user') expect(router.serializeUrl(value as import('@angular/router').UrlTree)).toBe('/training');
    else expect(value).toBe(true);
  });
});
