import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransferState } from '@angular/core';
import { SERVER_APP_PROVIDERS } from './app.server.providers';
import { AppAnalyticsService } from './services/app.analytics.service';
import { AppUserService } from './services/app.user.service';
import { AppWhatsNewService } from './services/app.whats-new.service';
import { PUBLIC_RELEASES_TRANSFER_STATE_KEY } from './services/public-releases-snapshot';
import { PublicPricingCatalogService } from './services/public-pricing-catalog.service';

const { readSnapshot } = vi.hoisted(() => ({ readSnapshot: vi.fn() }));
vi.mock('node:fs', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs')>();
  return { ...original, default: { ...original, readFileSync: readSnapshot }, readFileSync: readSnapshot };
});

describe('SERVER_APP_PROVIDERS', () => {
  beforeEach(() => {
    readSnapshot.mockReset();
    TestBed.configureTestingModule({
      providers: SERVER_APP_PROVIDERS,
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllEnvs();
  });

  it('provides an SSR-safe profile read state contract', async () => {
    const userService = TestBed.inject(AppUserService);

    expect(userService.profileReadState()).toEqual({ status: 'signed-out' });
    await expect(firstValueFrom(userService.profileReadState$)).resolves.toEqual({ status: 'signed-out' });
    expect(userService.isProfileReadBlocking()).toBe(false);
    expect(userService.hasActionableProfileReadFailure()).toBe(false);
  });

  it('provides the analytics method used while prerendering the comparison tool', () => {
    const analyticsService = TestBed.inject(AppAnalyticsService);

    expect(() => analyticsService.logToolCompareView('new', false)).not.toThrow();
  });

  it('loads and transfers release notes only when their route requests them', async () => {
    const posts = [{ id: 'release', title: 'Release', description: 'Published changes', date: '2026-11-04T00:00:00Z', published: true, type: 'minor' }];
    readSnapshot.mockReturnValue(JSON.stringify({ version: 1, generatedAt: '2026-11-04T12:00:00Z', posts }));
    const service = TestBed.inject(AppWhatsNewService);
    const state = TestBed.inject(TransferState);
    expect(service.changelogs()).toEqual([]);
    expect(readSnapshot).not.toHaveBeenCalled();
    expect(state.hasKey(PUBLIC_RELEASES_TRANSFER_STATE_KEY)).toBe(false);

    await expect(firstValueFrom(service.getChangelogsOnceLoaded())).resolves.toEqual(posts);
    expect(service.changelogs()).toEqual(posts);
    expect(state.get(PUBLIC_RELEASES_TRANSFER_STATE_KEY, [])).toEqual(posts);
    await firstValueFrom(service.getChangelogsOnceLoaded());
    expect(readSnapshot).toHaveBeenCalledOnce();
  });

  it('fails release builds for missing, malformed or unpublished snapshots', () => {
    vi.stubEnv('QS_REQUIRE_PUBLIC_RELEASES_SNAPSHOT', 'true');
    const service = TestBed.inject(AppWhatsNewService);
    for (const content of [undefined, 'invalid JSON', JSON.stringify({ version: 1, generatedAt: '2026-11-04', posts: [{ published: false }] })]) {
      readSnapshot.mockReturnValue(content);
      expect(() => service.getChangelogsOnceLoaded()).toThrow(/required public release notes snapshot/);
      expect(TestBed.inject(TransferState).hasKey(PUBLIC_RELEASES_TRANSFER_STATE_KEY)).toBe(false);
    }
  });

  it('keeps the pricing build fail-closed when its required catalog is missing', () => {
    vi.stubEnv('QS_REQUIRE_PUBLIC_PRICING_SNAPSHOT', 'true');
    readSnapshot.mockImplementation(() => { throw new Error('Missing file'); });
    expect(() => TestBed.inject(PublicPricingCatalogService)).toThrow(/required public pricing snapshot/);
  });
});
