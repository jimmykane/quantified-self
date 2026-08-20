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

  it('persists custom visibility independently for each activity-type signature', () => {
    const event = mockEvent('event-v2-custom');

    service.setEventChartCustomVisibilityPreference(event, 'types-v1:Running', [DataPaceMinutesPerMile.type]);
    service.setEventChartCustomVisibilityPreference(event, 'types-v1:Cycling', [DataPower.type]);

    expect(service.getEventChartVisibilityPreference(event, 'types-v1:Running')).toEqual({
      mode: 'custom',
      selectionKeys: [DataPace.type],
      source: 'signature',
    });
    expect(service.getEventChartVisibilityPreference(event, 'types-v1:Cycling')).toEqual({
      mode: 'custom',
      selectionKeys: [DataPower.type],
      source: 'signature',
    });
  });

  it('preserves an intentionally empty custom selection', () => {
    const event = mockEvent('event-v2-empty');

    service.setEventChartCustomVisibilityPreference(event, 'types-v1:Running', []);

    expect(service.getEventChartVisibilityPreference(event, 'types-v1:Running')).toEqual({
      mode: 'custom',
      selectionKeys: [],
      source: 'signature',
    });
  });

  it('migrates non-empty legacy selections without removing the legacy value', () => {
    const event = mockEvent('event-legacy');
    service.setDataTypeIDsToShow(event, [DataPaceMinutesPerMile.type, DataSpeed.type]);

    expect(service.getEventChartVisibilityPreference(event, 'types-v1:Running')).toEqual({
      mode: 'custom',
      selectionKeys: [DataPace.type, DataSpeed.type],
      source: 'legacy',
    });
    expect(service.getDataTypeIDsToShow(event)).toEqual([DataPaceMinutesPerMile.type, DataSpeed.type]);
    expect(storage.getItem('chart.settings.service.selectedDataTypesV2event-legacy')).toContain('legacySelectionKeys');
  });

  it('lets a signature-specific selection override a migrated legacy selection', () => {
    const event = mockEvent('event-legacy-override');
    service.setDataTypeIDsToShow(event, [DataSpeed.type]);
    service.setEventChartCustomVisibilityPreference(event, 'types-v1:Running', [DataPace.type]);

    expect(service.getEventChartVisibilityPreference(event, 'types-v1:Running')).toEqual({
      mode: 'custom',
      selectionKeys: [DataPace.type],
      source: 'signature',
    });
  });

  it('records an automatic reset when a legacy selection still exists', () => {
    const event = mockEvent('event-reset-legacy');
    service.setDataTypeIDsToShow(event, [DataSpeed.type]);
    service.setEventChartCustomVisibilityPreference(event, 'types-v1:Running', [DataPace.type]);

    service.resetEventChartVisibilityPreference(event, 'types-v1:Running');

    expect(service.getEventChartVisibilityPreference(event, 'types-v1:Running')).toEqual({
      mode: 'automatic',
      selectionKeys: [],
      source: 'signature',
    });
    expect(service.getEventChartVisibilityPreference(event, 'types-v1:Cycling').source).toBe('legacy');
  });

  it('falls back safely from malformed v2 state to a valid legacy selection', () => {
    const event = mockEvent('event-malformed');
    service.setDataTypeIDsToShow(event, [DataSpeed.type]);
    storage.setItem('chart.settings.service.selectedDataTypesV2event-malformed', '{not-json');

    expect(service.getEventChartVisibilityPreference(event, 'types-v1:Running')).toEqual({
      mode: 'custom',
      selectionKeys: [DataSpeed.type],
      source: 'legacy',
    });
  });
});
