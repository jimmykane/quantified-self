import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SERVER_APP_PROVIDERS } from './app.server.providers';
import { AppUserService } from './services/app.user.service';

describe('SERVER_APP_PROVIDERS', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: SERVER_APP_PROVIDERS,
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('provides an SSR-safe profile read state contract', async () => {
    const userService = TestBed.inject(AppUserService);

    expect(userService.profileReadState()).toEqual({ status: 'signed-out' });
    await expect(firstValueFrom(userService.profileReadState$)).resolves.toEqual({ status: 'signed-out' });
    expect(userService.isProfileReadBlocking()).toBe(false);
    expect(userService.hasActionableProfileReadFailure()).toBe(false);
  });
});
