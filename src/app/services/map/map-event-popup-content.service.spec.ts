import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { ActivityTypes, DataDistance, DataDuration, DataPaceAvg, DataSpeedAvg, EventInterface } from '@sports-alliance/sports-lib';
import { AppUserSettingsQueryService } from '../app.user-settings-query.service';
import { MapEventPopupContentService } from './map-event-popup-content.service';

describe('MapEventPopupContentService', () => {
  let service: MapEventPopupContentService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        MapEventPopupContentService,
        {
          provide: AppUserSettingsQueryService,
          useValue: {
            unitSettings: vi.fn().mockReturnValue(undefined),
          },
        },
      ],
    });

    service = TestBed.inject(MapEventPopupContentService);
  });

  it('builds duration/distance/effort from event stats when activities are empty', () => {
    const durationStat = { getType: () => DataDuration.type, getDisplayValue: () => '00:45:00', getDisplayUnit: () => '' };
    const distanceStat = { getType: () => DataDistance.type, getDisplayValue: () => '8.5', getDisplayUnit: () => 'km' };
    const paceStat = { getType: () => DataPaceAvg.type, getDisplayValue: () => '5:20', getDisplayUnit: () => 'min/km' };

    const event = {
      startDate: new Date('2025-01-01T10:00:00Z'),
      getActivityTypesAsArray: () => [ActivityTypes.Running],
      getActivityTypesAsString: () => 'Running',
      getActivities: () => [],
      getDuration: () => durationStat,
      getDistance: () => distanceStat,
      getStat: (type: string) => {
        if (type === DataDuration.type) return durationStat;
        if (type === DataDistance.type) return distanceStat;
        if (type === DataPaceAvg.type) return paceStat;
        return null;
      },
    } as unknown as EventInterface;

    const content = service.buildFromEvent(event);

    expect(content.eventType).toBe('Running');
    expect(content.iconEventType).toBe('Running');
    expect(content.metrics).toEqual([
      { value: '00:45:00', label: '' },
      { value: '8.5', label: 'km' },
      { value: '5:20', label: 'min/km' },
    ]);
    expect(content.metrics.some((metric) => metric.label === 'activity' || metric.label === 'activities')).toBe(false);
  });

  it('uses event-summary effort priority (pace before speed for running)', () => {
    const paceStat = { getType: () => DataPaceAvg.type, getDisplayValue: () => '4:30', getDisplayUnit: () => 'min/km' };
    const speedStat = { getType: () => DataSpeedAvg.type, getDisplayValue: () => '13.3', getDisplayUnit: () => 'km/h' };

    const event = {
      startDate: new Date('2025-01-01T10:00:00Z'),
      getActivityTypesAsArray: () => [ActivityTypes.Running],
      getActivityTypesAsString: () => 'Running',
      getDuration: () => ({ getType: () => DataDuration.type, getDisplayValue: () => '00:30:00', getDisplayUnit: () => '' }),
      getDistance: () => ({ getType: () => DataDistance.type, getDisplayValue: () => '6.0', getDisplayUnit: () => 'km' }),
      getStat: (type: string) => {
        if (type === DataPaceAvg.type) return paceStat;
        if (type === DataSpeedAvg.type) return speedStat;
        return null;
      },
    } as unknown as EventInterface;

    const content = service.buildFromEvent(event);
    expect(content.metrics[2]).toEqual({ value: '4:30', label: 'min/km' });
  });

  it('returns placeholder effort when event effort stats are missing', () => {
    const event = {
      startDate: new Date('2025-01-01T10:00:00Z'),
      getActivityTypesAsArray: () => [ActivityTypes.Cycling],
      getActivityTypesAsString: () => 'Cycling',
      getDuration: () => ({ getType: () => DataDuration.type, getDisplayValue: () => '01:00:00', getDisplayUnit: () => '' }),
      getDistance: () => ({ getType: () => DataDistance.type, getDisplayValue: () => '30.0', getDisplayUnit: () => 'km' }),
      getStat: () => null,
    } as unknown as EventInterface;

    const content = service.buildFromEvent(event);
    expect(content.metrics[2]).toEqual({ value: '--', label: '' });
  });

  it('returns default placeholder content when event is missing', () => {
    const content = service.buildFromEvent(null);

    expect(content.eventType).toBe('Activity');
    expect(content.iconEventType).toBe('Other');
    expect(content.metrics).toEqual([
      { value: '--', label: '' },
      { value: '--', label: '' },
      { value: '--', label: '' },
    ]);
  });
});
