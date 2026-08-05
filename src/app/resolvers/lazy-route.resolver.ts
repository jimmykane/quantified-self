import { EnvironmentInjector, inject, runInInjectionContext } from '@angular/core';
import type { MaybeAsync, ResolveFn } from '@angular/router';
import { from, isObservable, Observable, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import type { RouteResolverData } from './route.resolver';

export const lazyRouteResolver: ResolveFn<RouteResolverData> = (route, state) => {
  const environmentInjector = inject(EnvironmentInjector);

  return from(import('./route.resolver')).pipe(
    switchMap(({ routeResolver }) => toObservable(
      runInInjectionContext(environmentInjector, () => routeResolver(route, state)),
    )),
  );
};

function toObservable<T>(value: MaybeAsync<T>): Observable<T> {
  if (isObservable(value)) {
    return value;
  }
  if (isPromiseLike(value)) {
    return from(value);
  }
  return of(value);
}

function isPromiseLike<T>(value: MaybeAsync<T>): value is Promise<T> {
  return !!value && typeof (value as Promise<T>).then === 'function';
}
