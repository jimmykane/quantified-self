import { TestBed } from '@angular/core/testing';
import {
  DataPace,
  DataPaceMinutesPerMile,
  DataPower,
  DataSpeed,
  EventInterface,
} from '@sports-alliance/sports-lib';
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

  it('persists custom visibility independently for each activity-type signature', () => {
    const event = mockEvent('event-v2-custom');

    service.setEventChartCustomVisibilityPreference(event, 'types-v1:Running', [DataPaceMinutesPerMile.type]);
    service.setEventChartCustomVisibilityPreference(event, 'types-v1:Cycling', [DataPower.type]);

    expect(service.getEventChartVisibilityPreference(event, 'types-v1:Running')).toEqual({
      mode: 'custom',
      selectionKeys: [DataPace.type],
    });
    expect(service.getEventChartVisibilityPreference(event, 'types-v1:Cycling')).toEqual({
      mode: 'custom',
      selectionKeys: [DataPower.type],
    });
  });

  it('preserves an intentionally empty custom selection', () => {
    const event = mockEvent('event-v2-empty');

    service.setEventChartCustomVisibilityPreference(event, 'types-v1:Running', []);

    expect(service.getEventChartVisibilityPreference(event, 'types-v1:Running')).toEqual({
      mode: 'custom',
      selectionKeys: [],
    });
  });

  it('ignores selections from the unversioned visibility store', () => {
    const event = mockEvent('event-unversioned');
    const unversionedKey = 'chart.settings.service.selectedDataTypesevent-unversioned';
    const unversionedValue = [DataPaceMinutesPerMile.type, DataSpeed.type].join(',');
    storage.setItem(unversionedKey, unversionedValue);

    expect(service.getEventChartVisibilityPreference(event, 'types-v1:Running')).toEqual({
      mode: 'automatic',
      selectionKeys: [],
    });
    expect(storage.getItem(unversionedKey)).toBe(unversionedValue);
    expect(storage.getItem('chart.settings.service.selectedDataTypesV2event-unversioned')).toBeNull();
  });

  it('resets only the current signature and removes empty versioned state', () => {
    const event = mockEvent('event-v2-reset');
    service.setEventChartCustomVisibilityPreference(event, 'types-v1:Running', [DataPace.type]);
    service.setEventChartCustomVisibilityPreference(event, 'types-v1:Cycling', [DataPower.type]);

    service.resetEventChartVisibilityPreference(event, 'types-v1:Running');

    expect(service.getEventChartVisibilityPreference(event, 'types-v1:Running')).toEqual({
      mode: 'automatic',
      selectionKeys: [],
    });
    expect(service.getEventChartVisibilityPreference(event, 'types-v1:Cycling')).toEqual({
      mode: 'custom',
      selectionKeys: [DataPower.type],
    });

    service.resetEventChartVisibilityPreference(event, 'types-v1:Cycling');

    expect(storage.getItem('chart.settings.service.selectedDataTypesV2event-v2-reset')).toBeNull();
  });

  it('falls back safely from malformed v2 state to automatic visibility', () => {
    const event = mockEvent('event-malformed');
    storage.setItem('chart.settings.service.selectedDataTypesevent-malformed', DataSpeed.type);
    storage.setItem('chart.settings.service.selectedDataTypesV2event-malformed', '{not-json');

    expect(service.getEventChartVisibilityPreference(event, 'types-v1:Running')).toEqual({
      mode: 'automatic',
      selectionKeys: [],
    });
  });
});
