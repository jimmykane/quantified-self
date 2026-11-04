import { EnvironmentInjector, inject, runInInjectionContext } from '@angular/core';
import type { MaybeAsync, ResolveFn } from '@angular/router';
import { from, isObservable, Observable, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import type { RouteResolverData } from './route.resolver';

type PublicPricingJsonLd = Record<string, unknown>;

export const lazyRouteResolver: ResolveFn<RouteResolverData> = (route, state) => {
  const environmentInjector = inject(EnvironmentInjector);

  return from(import('./route.resolver')).pipe(
    switchMap(({ routeResolver }) => toObservable(
      runInInjectionContext(environmentInjector, () => routeResolver(route, state)),
    )),
  );
};

/** Loads the public pricing catalog resolver only for /pricing navigation. */
export const lazyPublicPricingJsonLdResolver: ResolveFn<PublicPricingJsonLd> = (route, state) => {
  const environmentInjector = inject(EnvironmentInjector);

  return from(import('./public-pricing-json-ld.resolver')).pipe(
    switchMap(({ publicPricingJsonLdResolver }) => toObservable(
      runInInjectionContext(environmentInjector, () => publicPricingJsonLdResolver(route, state)),
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
