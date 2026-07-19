import { describe, expect, it } from 'vitest';
import { SLEEP_PROVIDERS, SLEEP_STAGES } from '../../../shared/sleep';
import {
    mapCorosDailySleep,
    mapGarminSleepSummary,
    mapSuuntoSleepSample,
} from './provider-mappers';

describe('sleep provider mappers', () => {
    it('maps Garmin sleep summaries with stages, score, and samples', () => {
        const result = mapGarminSleepSummary({
            summaryId: 'garmin-summary-1',
            calendarDate: '2026-04-28',
            startTimeInSeconds: 1777330800,
            startTimeOffsetInSeconds: 7200,
            durationInSeconds: 28800,
            deepSleepDurationInSeconds: 5400,
            lightSleepDurationInSeconds: 18000,
            remSleepInSeconds: 3600,
            awakeDurationInSeconds: 1200,
            unmeasurableSleepInSeconds: 600,
            validation: 'ENHANCED_FINAL',
            sleepLevelsMap: {
                deep: [{ startTimeInSeconds: 1777330800, endTimeInSeconds: 1777334400 }],
                rem: [{ startTimeInSeconds: 1777340000, endTimeInSeconds: 1777341800 }],
            },
            timeOffsetSleepRespiration: { '60': 14.5, '120': 15.5 },
            timeOffsetSleepSpo2: { '60': 95 },
            overallSleepScore: { value: 88, qualifierKey: 'GOOD' },
        }, 'garmin-user-1', 1000);

        expect(result?.sourceSessionKey).toBe('garmin-summary-1');
        expect(result?.session.source.provider).toBe(SLEEP_PROVIDERS.GarminAPI);
        expect(result?.session.sleepDate).toBe('2026-04-28');
        expect(result?.session.stageDurationsSeconds).toMatchObject({
            [SLEEP_STAGES.Deep]: 5400,
            [SLEEP_STAGES.Light]: 18000,
            [SLEEP_STAGES.Rem]: 3600,
            [SLEEP_STAGES.Awake]: 1200,
            [SLEEP_STAGES.Unmeasurable]: 600,
        });
        expect(result?.session.stages).toHaveLength(2);
        expect(result?.session.score?.value).toBe(88);
        expect(result?.session.vitals?.averageRespirationBrpm).toBe(15);
        expect(result?.session.vitals?.averageHeartRateBpm).toBeUndefined();
        expect(result?.session.vitals?.minimumHeartRateBpm).toBeUndefined();
        expect(result?.session.spo2Samples?.[0].value).toBe(95);
    });

    it('keeps a null Garmin timezone offset unavailable instead of treating it as UTC', () => {
        const result = mapGarminSleepSummary({
            summaryId: 'garmin-summary-without-offset',
            calendarDate: '2026-04-28',
            startTimeInSeconds: 1777330800,
            startTimeOffsetInSeconds: null,
            durationInSeconds: 28800,
        }, 'garmin-user-1', 1000);

        expect(result?.session.timezoneOffsetSeconds).toBeNull();
    });

    it('maps Suunto 247 sleep samples and treats one-based SpO2 as percent', () => {
        const result = mapSuuntoSleepSample({
            timestamp: '2026-04-27T21:30:00.000Z',
            entryData: {
                DeepSleepDuration: 4000,
                LightSleepDuration: 15000,
                REMSleepDuration: 5000,
                Duration: 28800,
                HRAvg: 52,
                HRMin: 45,
                SleepQualityScore: 81,
                SleepId: 12345,
                BedtimeStart: '2026-04-27T21:30:00.000Z',
                BedtimeEnd: '2026-04-28T05:30:00.000Z',
                MaxSpo2: 0.97,
                AvgHRV: 47,
                AvgHRVSampleCount: 107,
                IsNap: false,
                WakeAfterSleepOnsetDuration: 600,
                WakeBeforeOffBedDuration: 120,
            },
        }, 'suunto-user-1', 2000);

        expect(result?.sourceSessionKey).toBe('12345');
        expect(result?.session.source.provider).toBe(SLEEP_PROVIDERS.SuuntoApp);
        expect(result?.session.sleepDate).toBe('2026-04-28');
        expect(result?.session.timezoneOffsetSeconds).toBe(0);
        expect(result?.session.durationSeconds).toBe(24000);
        expect(result?.session.inBedDurationSeconds).toBe(28800);
        expect(result?.session.stageDurationsSeconds[SLEEP_STAGES.Awake]).toBe(720);
        expect(result?.session.vitals?.averageHeartRateBpm).toBe(52);
        expect(result?.session.vitals?.minimumHeartRateBpm).toBe(45);
        expect(result?.session.vitals?.maxSpo2Percent).toBe(97);
        expect(result?.session.score?.value).toBe(81);
    });

    it('keeps Suunto naps on the nap date and overnight sleep on the local wake date', () => {
        const overnight = mapSuuntoSleepSample({
            timestamp: '2026-05-26T21:47:00.000+03:00',
            entryData: {
                SleepId: 1779821220,
                DateTime: '2026-05-26T21:47:00.000+03:00',
                Duration: 35460,
                DeepSleepDuration: 5940,
                LightSleepDuration: 23580,
                REMSleepDuration: 3780,
                WakeAfterSleepOnsetDuration: 2160,
                AvgHRV: 32,
                IsNap: false,
            },
        }, 'suunto-user-1', 2000);
        const nap = mapSuuntoSleepSample({
            timestamp: '2026-05-26T05:00:00.000+03:00',
            entryData: {
                SleepId: 1779760800,
                DateTime: '2026-05-26T05:00:00.000+03:00',
                Duration: 10320,
                LightSleepDuration: 10320,
                AvgHRV: 45,
                IsNap: true,
            },
        }, 'suunto-user-1', 2000);

        expect(overnight?.session.startTimeMs).toBe(Date.UTC(2026, 4, 26, 18, 47));
        expect(overnight?.session.endTimeMs).toBe(Date.UTC(2026, 4, 27, 4, 38));
        expect(overnight?.session.sleepDate).toBe('2026-05-27');
        expect(overnight?.session.timezoneOffsetSeconds).toBe(3 * 60 * 60);
        expect(nap?.session.startTimeMs).toBe(Date.UTC(2026, 4, 26, 2));
        expect(nap?.session.endTimeMs).toBe(Date.UTC(2026, 4, 26, 4, 52));
        expect(nap?.session.sleepDate).toBe('2026-05-26');
        expect(nap?.session.timezoneOffsetSeconds).toBe(3 * 60 * 60);
    });

    it('maps COROS daily sleep with unknown-stage duration and daily extras', () => {
        const result = mapCorosDailySleep({
            happenDay: 20260428,
            sleepStartTime: '2026-04-27 22:15:00',
            sleepEndTime: '2026-04-28 06:45:00',
            calorie: 955,
            step: 52,
            rhr: 56,
            hrvList: [
                { hrv: 25, hr: 60, timestamp: 1777330800 },
            ],
            ppgHrv: 50,
            sleepAvgHr: 58,
        }, 'coros-open-id', 3000);

        expect(result?.session.source.provider).toBe(SLEEP_PROVIDERS.COROSAPI);
        expect(result?.sourceSessionKey).toBe('20260428:2026-04-27 22:15:00:2026-04-28 06:45:00');
        expect(result?.session.sleepDate).toBe('2026-04-28');
        expect(result?.session.durationSeconds).toBe(30600);
        expect(result?.session.stageDurationsSeconds[SLEEP_STAGES.Unknown]).toBe(30600);
        expect(result?.session.vitals?.averageHeartRateBpm).toBe(58);
        expect(result?.session.vitals?.minimumHeartRateBpm).toBeUndefined();
        expect(result?.session.vitals?.overnightHrvMs).toBe(50);
        expect(result?.session.hrvSamples?.[0].value).toBe(25);
    });

    it('applies COROS timezone offsets when local sleep timestamps include no offset', () => {
        const result = mapCorosDailySleep({
            happenDay: 20260428,
            sleepStartTime: '2026-04-27 22:15:00',
            sleepEndTime: '2026-04-28 06:45:00',
            timezoneOffsetSeconds: null,
            startTimezone: null,
            endTimezone: 12,
        }, 'coros-open-id', 3000);

        expect(result?.session.startTimeMs).toBe(Date.UTC(2026, 3, 27, 19, 15));
        expect(result?.session.endTimeMs).toBe(Date.UTC(2026, 3, 28, 3, 45));
        expect(result?.session.timezoneOffsetSeconds).toBe(3 * 60 * 60);
        expect(result?.session.sleepDate).toBe('2026-04-28');
        expect(result?.session.durationSeconds).toBe(30600);
    });
});
