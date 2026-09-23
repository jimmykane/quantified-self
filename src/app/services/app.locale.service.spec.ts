import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppUserInterface } from '../models/app-user.interface';
import { APP_FORMAT_LOCALE_STORAGE_KEY } from '../shared/adapters/app-locale';
import { AppLocaleService } from './app.locale.service';
import { AppWindowService } from './app.window.service';
import { LoggerService } from './logger.service';
import { APP_STORAGE } from './storage/app.storage.token';
import { MemoryStorage } from './storage/memory.storage';

describe('AppLocaleService', () => {
  let service: AppLocaleService;
  let storage: MemoryStorage;
  let sessionStorage: MemoryStorage;
  let reload: ReturnType<typeof vi.fn>;
  let logger: { warn: ReturnType<typeof vi.fn> };

  function user(formatLocale?: unknown): AppUserInterface {
    return {
      uid: 'user-1',
      settings: { appSettings: { formatLocale } },
    } as AppUserInterface;
  }

  beforeEach(() => {
    storage = new MemoryStorage();
    sessionStorage = new MemoryStorage();
    reload = vi.fn();
    logger = { warn: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        AppLocaleService,
        { provide: APP_STORAGE, useValue: storage },
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: AppWindowService, useValue: { windowRef: { location: { reload }, sessionStorage } } },
        { provide: LoggerService, useValue: logger },
      ],
    });
    service = TestBed.inject(AppLocaleService);
  });

  it('caches and verifies a changed preference without reloading directly', () => {
    expect(service.cachePreference('fr-FR')).toBe('updated');
    expect(storage.getItem(APP_FORMAT_LOCALE_STORAGE_KEY)).toBe('fr-FR');
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not rewrite an unchanged preference', () => {
    storage.setItem(APP_FORMAT_LOCALE_STORAGE_KEY, 'de-DE');
    const setItem = vi.spyOn(storage, 'setItem');

    expect(service.cachePreference('de-DE')).toBe('unchanged');
    expect(setItem).not.toHaveBeenCalled();
  });

  it('reloads once when a hydrated account differs from the bootstrap cache', () => {
    storage.setItem(APP_FORMAT_LOCALE_STORAGE_KEY, 'en-GB');

    expect(service.reconcileAccountPreference(user('el-GR'))).toBe('updated');
    expect(storage.getItem(APP_FORMAT_LOCALE_STORAGE_KEY)).toBe('el-GR');
    expect(reload).toHaveBeenCalledOnce();

    expect(service.reconcileAccountPreference(user('el-GR'))).toBe('unchanged');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('prevents a reload loop if one account alternates between stale preferences', () => {
    storage.setItem(APP_FORMAT_LOCALE_STORAGE_KEY, 'en-GB');

    expect(service.reconcileAccountPreference(user('el-GR'))).toBe('updated');
    expect(service.reconcileAccountPreference(user('fr-FR'))).toBe('updated');

    expect(reload).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith('[AppLocaleService] Prevented a repeated regional format reload.');
  });

  it('allows a later account update after matching hydration clears the reload guard', () => {
    storage.setItem(APP_FORMAT_LOCALE_STORAGE_KEY, 'en-GB');

    expect(service.reconcileAccountPreference(user('el-GR'))).toBe('updated');
    expect(service.reconcileAccountPreference(user('el-GR'))).toBe('unchanged');
    expect(service.reconcileAccountPreference(user('fr-FR'))).toBe('updated');

    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('reconciles a different account preference independently', () => {
    expect(service.reconcileAccountPreference(user('en-US'))).toBe('updated');
    expect(service.reconcileAccountPreference({
      ...user('fr-FR'),
      uid: 'user-2',
    })).toBe('updated');

    expect(storage.getItem(APP_FORMAT_LOCALE_STORAGE_KEY)).toBe('fr-FR');
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('treats a missing or invalid account value as Automatic', () => {
    storage.setItem(APP_FORMAT_LOCALE_STORAGE_KEY, 'en-US');

    expect(service.reconcileAccountPreference(user('invalid'))).toBe('updated');
    expect(storage.getItem(APP_FORMAT_LOCALE_STORAGE_KEY)).toBe('auto');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('repairs an invalid cache to Automatic without an unnecessary reload', () => {
    storage.setItem(APP_FORMAT_LOCALE_STORAGE_KEY, 'unsupported');

    expect(service.reconcileAccountPreference(user())).toBe('unchanged');
    expect(storage.getItem(APP_FORMAT_LOCALE_STORAGE_KEY)).toBe('auto');
    expect(reload).not.toHaveBeenCalled();
  });

  it('ignores signed-out emissions', () => {
    storage.setItem(APP_FORMAT_LOCALE_STORAGE_KEY, 'en-US');

    expect(service.reconcileAccountPreference(null)).toBe('unchanged');
    expect(storage.getItem(APP_FORMAT_LOCALE_STORAGE_KEY)).toBe('en-US');
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload when browser storage rejects the update', () => {
    const blockedStorage = {
      getItem: vi.fn(() => 'en-GB'),
      setItem: vi.fn(() => { throw new Error('blocked'); }),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(),
      length: 0,
    } as Storage;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        AppLocaleService,
        { provide: APP_STORAGE, useValue: blockedStorage },
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: AppWindowService, useValue: { windowRef: { location: { reload }, sessionStorage } } },
        { provide: LoggerService, useValue: logger },
      ],
    });
    service = TestBed.inject(AppLocaleService);

    expect(service.reconcileAccountPreference(user('pl-PL'))).toBe('storage-unavailable');
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not risk an unguarded reload when session storage is blocked', () => {
    const blockedSessionStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => { throw new Error('blocked'); }),
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        AppLocaleService,
        { provide: APP_STORAGE, useValue: storage },
        { provide: PLATFORM_ID, useValue: 'browser' },
        {
          provide: AppWindowService,
          useValue: { windowRef: { location: { reload }, sessionStorage: blockedSessionStorage } },
        },
        { provide: LoggerService, useValue: logger },
      ],
    });
    service = TestBed.inject(AppLocaleService);

    expect(service.reconcileAccountPreference(user('pl-PL'))).toBe('updated');
    expect(storage.getItem(APP_FORMAT_LOCALE_STORAGE_KEY)).toBe('pl-PL');
    expect(reload).not.toHaveBeenCalled();
  });
});
