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
        expect(result?.session.spo2Samples?.[0].value).toBe(95);
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
        expect(result?.session.durationSeconds).toBe(28800);
        expect(result?.session.stageDurationsSeconds[SLEEP_STAGES.Awake]).toBe(720);
        expect(result?.session.vitals?.averageHeartRateBpm).toBe(52);
        expect(result?.session.vitals?.maxSpo2Percent).toBe(97);
        expect(result?.session.score?.value).toBe(81);
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
        expect(result?.session.sleepDate).toBe('2026-04-28');
        expect(result?.session.durationSeconds).toBe(30600);
        expect(result?.session.stageDurationsSeconds[SLEEP_STAGES.Unknown]).toBe(30600);
        expect(result?.session.vitals?.averageHeartRateBpm).toBe(58);
        expect(result?.session.vitals?.overnightHrvMs).toBe(50);
        expect(result?.session.hrvSamples?.[0].value).toBe(25);
    });
});
