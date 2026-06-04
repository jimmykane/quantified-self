import { TestBed } from '@angular/core/testing';
import { ResolveFn } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, expect, it, beforeEach } from 'vitest';

import { AppAuthService } from '../authentication/app.auth.service';
import { toolsCompareAuthResolver, ToolsCompareAuthResolverData } from './tools-compare-auth.resolver';

describe('toolsCompareAuthResolver', () => {
  const executeResolver: ResolveFn<ToolsCompareAuthResolverData> = (...resolverParameters) =>
    TestBed.runInInjectionContext(() => toolsCompareAuthResolver(...resolverParameters));

  let authServiceMock: {
    authState$: unknown;
  };

  beforeEach(() => {
    authServiceMock = {
      authState$: of(null),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: AppAuthService, useValue: authServiceMock },
      ],
    });
  });

  it('resolves signed out after the first auth state tick', () => new Promise<void>(done => {
    (executeResolver({} as any, {} as any) as any).subscribe((result: ToolsCompareAuthResolverData) => {
      expect(result).toEqual({
        authResolved: true,
        signedIn: false,
      });
      done();
    });
  }));

  it('resolves signed in without loading the app user profile', () => new Promise<void>(done => {
    authServiceMock.authState$ = of({ uid: 'user-1' });

    (executeResolver({} as any, {} as any) as any).subscribe((result: ToolsCompareAuthResolverData) => {
      expect(result).toEqual({
        authResolved: true,
        signedIn: true,
      });
      done();
    });
  }));

  it('falls back to signed out when auth state errors', () => new Promise<void>(done => {
    authServiceMock.authState$ = throwError(() => new Error('auth failed'));

    (executeResolver({} as any, {} as any) as any).subscribe((result: ToolsCompareAuthResolverData) => {
      expect(result).toEqual({
        authResolved: true,
        signedIn: false,
      });
      done();
    });
  }));
});
