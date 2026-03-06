import { TestBed } from '@angular/core/testing';
import { EventInterface } from '@sports-alliance/sports-lib';
import { afterEach, describe, expect, it } from 'vitest';
import { APP_STORAGE } from './app.storage.token';
import { MemoryStorage } from './memory.storage';
import { AppChartSettingsLocalStorageService } from './app.chart.settings.local.storage.service';

describe('AppChartSettingsLocalStorageService', () => {
  let service: AppChartSettingsLocalStorageService;
  let storage: Storage;

  const mockEvent = (id: string): EventInterface => ({
    getID: () => id,
  } as any);

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AppChartSettingsLocalStorageService,
        { provide: APP_STORAGE, useClass: MemoryStorage },
      ],
    });

    service = TestBed.inject(AppChartSettingsLocalStorageService);
    storage = TestBed.inject(APP_STORAGE);
  });

  afterEach(() => {
    storage.clear();
  });

  it('should persist and restore fully qualified series ids without normalization', () => {
    const event = mockEvent('event-1');
    const fullIds = [
      'Average speed in kilometers per hour',
      'Average speed in miles per hour',
      'Average Power',
    ];

    service.setSeriesIDsToShow(event, fullIds);
    expect(service.getSeriesIDsToShow(event)).toEqual(fullIds);
  });

  it('should add and remove exact series ids (no label transformation)', () => {
    const event = mockEvent('event-2');
    const fullId = 'Average speed in kilometers per hour';

    service.showSeriesID(event, fullId);
    expect(service.getSeriesIDsToShow(event)).toEqual([fullId]);

    service.hideSeriesID(event, fullId);
    expect(service.getSeriesIDsToShow(event)).toEqual([]);
  });

  it('should expose datatype id helpers over the same storage namespace', () => {
    const event = mockEvent('event-3');
    const ids = ['Power', 'Speed'];

    service.setDataTypeIDsToShow(event, ids);
    expect(service.getDataTypeIDsToShow(event)).toEqual(ids);

    service.hideDataTypeID(event, 'Power');
    expect(service.getDataTypeIDsToShow(event)).toEqual(['Speed']);

    service.showDataTypeID(event, 'Power');
    expect(service.getDataTypeIDsToShow(event)).toEqual(['Speed', 'Power']);
  });
});
