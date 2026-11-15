import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PreferencesSetupService } from './preferences-setup.service';
import { AppUserService } from './app.user.service';
import { AppHapticsService } from './app.haptics.service';
import { LoggerService } from './logger.service';
import type { AppUserInterface } from '../models/app-user.interface';
const account = (uid = 'owner') => ({ uid, onboardingCompleted: true, acceptedTos: true, acceptedDataPolicy: true,
  acceptedPrivacyPolicy: true, settings: { appSettings: { unitSetupCompleted: false } } } as AppUserInterface);
describe('PreferencesSetupService', () => {
  let owners: BehaviorSubject<AppUserInterface | null>;
  let write: ReturnType<typeof vi.fn>;
  let haptics: { selection: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    owners = new BehaviorSubject(account()); write = vi.fn().mockResolvedValue(undefined);
    haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
    TestBed.configureTestingModule({ providers: [
      { provide: AppUserService, useValue: { user$: owners, updateUserProperties: write } },
      { provide: AppHapticsService, useValue: haptics }, { provide: LoggerService, useValue: { error: vi.fn() } },
    ] });
  });
  it('keeps defaults with only a completion patch and shares dismissal across component lifetimes', async () => {
    const state = TestBed.inject(PreferencesSetupService);
    expect(state.due()).toBe(true); expect(haptics.selection).not.toHaveBeenCalled();
    expect(await state.complete('owner')).toBe(true);
    expect(write).toHaveBeenCalledWith(owners.value, { settings: { appSettings: { unitSetupCompleted: true } } });
    owners.next(account()); // A late snapshot must not reopen it.
    expect(state.due()).toBe(false);
    expect(TestBed.inject(PreferencesSetupService)).toBe(state);
    expect(haptics.success).toHaveBeenCalledOnce();
  });
  it('locks concurrent actions, preserves eligibility on failure and allows retry', async () => {
    const state = TestBed.inject(PreferencesSetupService);
    let reject!: (reason: Error) => void;
    write.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
    const pending = state.complete('owner');
    expect(state.busy()).toBe(true); expect(await state.complete('owner')).toBe(false);
    reject(new Error('offline')); await pending;
    expect(state.busy()).toBe(false); expect(state.due()).toBe(true); expect(state.error()).toContain('try again');
    expect(haptics.error).toHaveBeenCalledOnce(); expect(await state.complete('owner')).toBe(true);
  });
  it('rejects stale owners and ignores a pending save after account changes, even back to the original uid', async () => {
    const state = TestBed.inject(PreferencesSetupService);
    let resolve!: () => void; write.mockReturnValueOnce(new Promise<void>(done => { resolve = done; }));
    const pending = state.complete('owner');
    owners.next(account('next')); expect(await state.complete('owner')).toBe(false);
    owners.next(null); owners.next(account()); resolve();
    expect(await pending).toBe(false); expect(state.due()).toBe(true); expect(haptics.success).not.toHaveBeenCalled();
  });
  it('does not save for legacy or incomplete accounts and reacts to completion elsewhere', async () => {
    const state = TestBed.inject(PreferencesSetupService);
    const owner = account(); delete owner.settings.appSettings.unitSetupCompleted; owners.next(owner);
    expect(await state.complete('owner')).toBe(false);
    owners.next({ ...account(), onboardingCompleted: false }); expect(state.due()).toBe(false);
    owners.next(account()); expect(state.due()).toBe(true);
    owners.next({ ...account(), settings: { ...account().settings, appSettings: {unitSetupCompleted: true} } });
    expect(state.due()).toBe(false); expect(write).not.toHaveBeenCalled();
  });
});
