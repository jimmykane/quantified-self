import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { catchError, map, of, take } from 'rxjs';

import { AppAuthService } from '../authentication/app.auth.service';

export interface ToolsCompareAuthResolverData {
  authResolved: true;
  signedIn: boolean;
}

export const toolsCompareAuthResolver: ResolveFn<ToolsCompareAuthResolverData> = () => {
  const authService = inject(AppAuthService);

  return authService.authState$.pipe(
    take(1),
    map(firebaseUser => ({
      authResolved: true as const,
      signedIn: !!firebaseUser,
    })),
    catchError(() => of({
      authResolved: true as const,
      signedIn: false,
    })),
  );
};
