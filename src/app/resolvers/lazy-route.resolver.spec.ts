import { TestBed } from '@angular/core/testing';
import { convertToParamMap } from '@angular/router';
import type { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { lazyRouteResolver } from './lazy-route.resolver';

const { routeResolverMock } = vi.hoisted(() => ({
  routeResolverMock: vi.fn(),
}));

vi.mock('./route.resolver', () => ({
  routeResolver: routeResolverMock,
}));

describe('lazyRouteResolver', () => {
  it('loads and runs the route-detail resolver only when navigation resolves it', async () => {
    const resolvedRoute = { routeDocument: { id: 'route-1' } };
    routeResolverMock.mockReturnValue(of(resolvedRoute));
    const route = {
      paramMap: convertToParamMap({ userID: 'user-1', routeID: 'route-1' }),
    } as ActivatedRouteSnapshot;
    const state = { url: '/user/user-1/route/route-1' } as RouterStateSnapshot;

    expect(routeResolverMock).not.toHaveBeenCalled();

    const result = TestBed.runInInjectionContext(() => lazyRouteResolver(route, state));
    await expect(firstValueFrom(result as ReturnType<typeof of>)).resolves.toBe(resolvedRoute);
    expect(routeResolverMock).toHaveBeenCalledWith(route, state);
  });
});
