import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { APP_STORAGE } from './app.storage.token';
import { MemoryStorage } from './memory.storage';
import { AppEventSummaryTabsLocalStorageService } from './app.event-summary-tabs.local.storage.service';

describe('AppEventSummaryTabsLocalStorageService', () => {
  let service: AppEventSummaryTabsLocalStorageService;
  let storage: Storage;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AppEventSummaryTabsLocalStorageService,
        { provide: APP_STORAGE, useClass: MemoryStorage },
      ],
    });

    service = TestBed.inject(AppEventSummaryTabsLocalStorageService);
    storage = TestBed.inject(APP_STORAGE);
  });

  afterEach(() => {
    storage.clear();
  });

  it('should return empty string when no tab id is stored', () => {
    expect(service.getLastSelectedStatsTabId()).toBe('');
  });

  it('should store and read the last selected tab id', () => {
    service.setLastSelectedStatsTabId('performance');
    expect(service.getLastSelectedStatsTabId()).toBe('performance');
  });

  it('should clear the last selected tab id', () => {
    service.setLastSelectedStatsTabId('environment');
    service.clearLastSelectedStatsTabId();
    expect(service.getLastSelectedStatsTabId()).toBe('');
  });
});
