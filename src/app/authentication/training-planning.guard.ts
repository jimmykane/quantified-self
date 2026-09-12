import { inject } from '@angular/core';
import { Router, type CanMatchFn } from '@angular/router';
import { map, take } from 'rxjs';
import { isTrainingPlanningUIAllowed } from '@shared/training-planning-rollout';
import { AppAuthService } from './app.auth.service';

/** UI rollout only. Auth/onboarding and owner-scoped backend permissions remain independent. */
export const trainingPlanningGuard: CanMatchFn = () => {
  const router = inject(Router);
  return inject(AppAuthService).authState$.pipe(
    take(1),
    // Let the normal auth guard retain its login/return-URL behavior for signed-out users.
    map(user => !user || isTrainingPlanningUIAllowed(user.uid) ? true : router.createUrlTree(['/training'])),
  );
};
