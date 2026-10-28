import { describe, expect, it, vi } from 'vitest';
import { FitBaseType, FitEncoder } from 'fit-file-parser/encoder';
vi.unmock('@sports-alliance/sports-lib');
import {
    ActivityUtilities, DataPower, DataPowerAvg, DataPowerCurve, DataPowerWork,
    DataTrainingStressScore, EventImporterJSON, EventUtilities,
} from '@sports-alliance/sports-lib';
import { parseActivityFilePayload } from './activity-file-parser';
import { sanitizeActivityFirestoreWritePayload, sanitizeEventFirestoreWritePayload } from '../../../shared/firestore-write-sanitizer';
import { defaultAppliedTrainingLoadPolicy, resolveEffectiveTrainingLoad, type TrainingLoadLeg, type TrainingLoadMetadata } from '../../../shared/training-load-policy';
import { reconcileTrainingLoadLegs } from '../training-load/training-load-metadata';
import { summarizeTrainingLoad } from '../training-load/training-load-cache';
import { hasDerivedMetricSourceChange } from '../derived-metrics/derived-metrics-source-change';
import { buildPowerCurveMetricPayload, type DerivedTrainingActivitySource } from '../derived-metrics/derived-metrics.service';
import { getActivityChartDataFromSources } from '../mcp/activity-chart.service';
import { buildActivitySampleDataset } from '../mcp/activity-samples.service';
import { projectSportsLibNumericMetricValue, resolveAvailableSportsLibMetrics } from '../mcp/metric-catalog';

const start = Date.UTC(2026, 0, 1, 10);
// Synthetic source only. Calibration is encoded in the file, never passed as athlete settings.
function source(watts: (number | null)[], importedTss?: number, startOffsetSeconds = 0): Buffer {
    const encoder = new FitEncoder();
    const fitStart = FitEncoder.toFitTimestamp(new Date(start)) + startOffsetSeconds;
    const duration = watts.length - 1;
    const field = (number: number, value: number, baseType = FitBaseType.Uint8) => ({ number, value, baseType,
        size: baseType === FitBaseType.Uint32 ? 4 : baseType === FitBaseType.Uint16 ? 2 : 1 });
    encoder.writeMessage(0, [field(0, 4, FitBaseType.Enum), field(1, 1, FitBaseType.Uint16), field(4, fitStart, FitBaseType.Uint32)]);
    watts.forEach((power, second) => encoder.writeMessage(20, [field(253, fitStart + second, FitBaseType.Uint32),
        field(3, 165), ...(power === null ? [] : [field(7, power, FitBaseType.Uint16)])], 1));
    encoder.writeMessage(18, [field(254, 0, FitBaseType.Uint16), field(253, fitStart + duration, FitBaseType.Uint32),
        field(2, fitStart, FitBaseType.Uint32), field(5, 2, FitBaseType.Enum), field(7, duration * 1000, FitBaseType.Uint32),
        field(8, duration * 1000, FitBaseType.Uint32), field(45, 250, FitBaseType.Uint16),
        ...(importedTss === undefined ? [] : [field(35, importedTss * 10, FitBaseType.Uint16)])], 2);
    encoder.writeMessage(216, [field(0, 18, FitBaseType.Uint16), field(1, 0, FitBaseType.Uint16),
        field(11, 190), field(12, 55), field(13, 165)], 3);
    return Buffer.from(encoder.close());
}
const partial = () => [...Array<number>(48).fill(250), ...Array<null>(12).fill(null), 250];
const parse = (watts: (number | null)[], tss?: number, startOffsetSeconds = 0) =>
    parseActivityFilePayload(source(watts, tss, startOffsetSeconds), 'synthetic.fit');

describe('Sports Lib power adoption at QS boundaries', () => {
    it('keeps measured zero separate from absent watts in source parsing, sanitized writes and JSON reads', async () => {
        const watts = partial(); watts[0] = 0;
        const event = await parse(watts);
        const activity = event.getFirstActivity();
        expect(activity.getStreamData(DataPower.type)).toEqual(watts);
        expect(activity.getStat(DataPowerAvg.type)?.getValue()).toBeCloseTo(250 * 47 / 48);
        expect(activity.getStat(DataPowerWork.type)).toBeUndefined();
        const activityPayload = sanitizeActivityFirestoreWritePayload(activity.toJSON());
        const eventPayload = sanitizeEventFirestoreWritePayload(event.toJSON());
        expect(activityPayload).not.toHaveProperty('streams');
        expect(eventPayload).not.toHaveProperty('activities');
        expect(activityPayload).not.toHaveProperty('powerCoverage');
        const restored = EventImporterJSON.getActivityFromJSON(JSON.parse(JSON.stringify(activityPayload)));
        expect(restored.getStat(DataPowerAvg.type)?.getValue()).toBeCloseTo(250 * 47 / 48);
        expect(restored.getStat(DataPowerWork.type)).toBeUndefined();
        expect(activity.getStreamData(DataPower.type)).toEqual(watts);
        expect(projectSportsLibNumericMetricValue(DataPowerAvg.type, 0)).toBe(0);
        expect(resolveAvailableSportsLibMetrics([activityPayload.stats]).some(metric => metric.type === DataPowerWork.type)).toBe(false);
    });

    it('keeps genuine coasting in work and load and marks incomplete calculated power load as estimated', async () => {
        const incomplete = (await parse(partial())).getFirstActivity();
        const coasting = (await parse(partial().map(value => value ?? 0))).getFirstActivity();
        expect(ActivityUtilities.getTrainingStressScoreEvaluations(incomplete).automatic)
            .toMatchObject({ method: 'POWER', estimated: true });
        expect(ActivityUtilities.getTrainingStressScoreEvaluations(coasting).automatic)
            .toMatchObject({ method: 'POWER', estimated: false });
        expect(coasting.getStat(DataPowerWork.type)?.getValue()).toBe(12);
        expect(coasting.getStat(DataPowerAvg.type)?.getValue()).toBe(200);
        expect(incomplete.getStat(DataPowerWork.type)).toBeUndefined();
    });

    it.each([undefined, 0, 42])('preserves imported TSS %s or falls back when power coverage is insufficient', async imported => {
        const activity = (await parse([...Array<number>(30).fill(250), ...Array<null>(31).fill(null)], imported)).getFirstActivity();
        const result = ActivityUtilities.getTrainingStressScoreEvaluations(activity).automatic;
        expect(result).toMatchObject(imported === undefined ? { method: 'HR', score: 1.7 } : { provenance: 'imported', score: imported });
        expect(activity.getStat(DataTrainingStressScore.type)?.getValue()).toBe(result.score);
    });

    it('carries dated policies and zero overrides across new parsed IDs and accepts estimated candidates', async () => {
        const event = await parse(partial());
        const activity = event.getFirstActivity();
        const leg: TrainingLoadLeg = { activityId: 'old-leg', identity: { startMs: start, endMs: start + 60_000,
            type: activity.type, duration: 60, distance: null }, recordedTss: 90,
            evaluations: ActivityUtilities.getTrainingStressScoreEvaluations(activity),
            policy: { ...defaultAppliedTrainingLoadPolicy(activity.type), revision: 7, effectiveAtMs: start - 1 } };
        const saved: TrainingLoadMetadata = { version: 1, revision: 3, excluded: false,
            controls: { stable: { override: 0 } }, legs: { stable: leg } };
        const candidate = { ...leg, activityId: 'new-leg', recordedTss: 1.7, policy: defaultAppliedTrainingLoadPolicy(activity.type) };
        const reconciled = reconcileTrainingLoadLegs(saved, [candidate]);
        expect(reconciled.legs?.stable.policy).toEqual(leg.policy);
        expect(reconciled.controls).toEqual(saved.controls);
        const metadata = JSON.parse(JSON.stringify({ ...saved, ...reconciled })) as TrainingLoadMetadata;
        for (const [current, expected] of [
            [metadata, { status: 'available', score: 0, method: 'OVERRIDE', estimated: false }],
            [{ ...metadata, controls: {} }, { status: 'available', method: 'POWER', estimated: true }],
            [{ ...metadata, excluded: true }, { status: 'excluded', score: 0, estimated: false }],
        ] as const) {
            const resolved = resolveEffectiveTrainingLoad({}, current);
            expect(resolved).toMatchObject(expected);
            const summary = summarizeTrainingLoad('event', {}, current)!;
            const stored = JSON.parse(JSON.stringify(summary));
            expect(stored.load).toEqual(resolved);
            expect(stored.legs['new-leg'].load).toEqual(resolved);
            expect(stored).not.toHaveProperty('controls');
            expect(stored.legs['new-leg']).not.toHaveProperty('policy');
            expect(stored.legs['new-leg']).not.toHaveProperty('evaluations');
        }
    });

    it('invalidates changed or removed saved power evidence and rebuilds curves only from the replacement', async () => {
        const previous = await parse(Array<number>(61).fill(250));
        const next = await parse(partial());
        const before = sanitizeActivityFirestoreWritePayload(previous.getFirstActivity().toJSON());
        const after = sanitizeActivityFirestoreWritePayload(next.getFirstActivity().toJSON());
        expect(hasDerivedMetricSourceChange('activity', before, after)).toBe(true);
        expect(hasDerivedMetricSourceChange('event', sanitizeEventFirestoreWritePayload(previous.toJSON()),
            sanitizeEventFirestoreWritePayload(next.toJSON()))).toBe(true);
        expect(hasDerivedMetricSourceChange('activity', after, structuredClone(after))).toBe(false);
        const curve = after.stats[DataPowerCurve.type] as { duration: number; power: number }[];
        expect(curve.length).toBeGreaterThan(0);
        expect(curve.every(point => point.duration <= 48)).toBe(true);
        const input: DerivedTrainingActivitySource = { activityId: 'leg', eventId: 'event', discipline: 'cycling',
            activityData: after, eventData: sanitizeEventFirestoreWritePayload(next.toJSON()),
            startMs: start, startDayMs: start, eventStartMs: start, eventStartDayMs: start };
        const rebuilt = buildPowerCurveMetricPayload([input], start + 86_400_000);
        const range = rebuilt.payload.scopes.cycling.ranges.all;
        expect(range.matchedEventCount).toBe(1);
        expect(range.bestPoints.length).toBeGreaterThan(0);
        expect(range.bestPoints.filter((_, index) => index % 3 === 0).every(duration => duration <= 48)).toBe(true);
        expect(range.bestPoints.filter((_, index) => index % 3 === 1).every(power => power === 250)).toBe(true);
        // Remove only the curve: unrelated stats must not make this invalidation check pass.
        const noCurve = structuredClone(after);
        delete noCurve.stats[DataPowerCurve.type];
        expect(noCurve.stats[DataPowerAvg.type]).toBe(250);
        expect(hasDerivedMetricSourceChange('activity', after, noCurve)).toBe(true);
        expect(buildPowerCurveMetricPayload([{ ...input, activityData: noCurve }], start + 86_400_000)
            .payload.scopes.cycling.ranges.all).toMatchObject({ matchedEventCount: 0, bestPoints: [], latestActivity: null });
        const noWork = structuredClone(before);
        expect(noWork.stats[DataPowerWork.type]).toBe(15);
        delete noWork.stats[DataPowerWork.type];
        expect(hasDerivedMetricSourceChange('activity', before, noWork)).toBe(true);
        // Reopening sanitized JSON does not recreate the original readings or absent work.
        const restored = EventImporterJSON.getActivityFromJSON(JSON.parse(JSON.stringify(after)));
        expect(restored.getAllStreams()).toHaveLength(0);
        expect(restored.getStat(DataPowerWork.type)).toBeUndefined();
    });

    it('weights multisport parent power by leg duration, preserving zero and leg order independence', async () => {
        const event = await parse(Array<number>(61).fill(100));
        const second = (await parse(Array<number>(121).fill(200), undefined, 60)).getFirstActivity();
        const third = (await parse(Array<number>(31).fill(0), undefined, 180)).getFirstActivity();
        event.addActivities([second, third]);
        event.endDate = third.endDate;
        for (const legs of [event.getActivities().slice(), event.getActivities().slice().reverse()]) {
            const json = { ...event.toJSON(), activities: legs.map(leg => sanitizeActivityFirestoreWritePayload(leg.toJSON())) };
            const restored = EventImporterJSON.getEventFromJSON(JSON.parse(JSON.stringify(json)));
            EventUtilities.reGenerateStatsForEvent(restored);
            expect(restored.getStat(DataPowerAvg.type)?.getValue()).toBeCloseTo((100 * 60 + 200 * 120) / 210);
            // JSON hydration sorts legs chronologically; compare each leg by its start, not input position.
            expect(Object.fromEntries(restored.getActivities().map(leg => [+leg.startDate, leg.getStat(DataPowerAvg.type)?.getValue()])))
                .toEqual(Object.fromEntries(legs.map(leg => [+leg.startDate, leg.getStat(DataPowerAvg.type)?.getValue()])));
        }
    });

    it('reads sparse MCP charts and aligned samples through the real selective parser without fabricating zeros', async () => {
        const watts = partial(); watts[0] = 0;
        const payload = source(watts);
        const original = Buffer.from(payload);
        const activity = (await parseActivityFilePayload(payload, 'synthetic.fit')).getFirstActivity();
        const context = { sourceFiles: [{ path: 'private-source.fit' }], existingActivities: [activity], targetExistingIndex: 0 };
        const dependencies = { loadSource: async () => payload };
        const result = await getActivityChartDataFromSources(context,
            { metrics: ['power'], xAxis: 'elapsed_time', maxPoints: 100 }, dependencies);
        expect(result.series[0]).toMatchObject({ metric: 'power', missingSampleCount: 12, sourceSampleCount: 61,
            xValues: [...Array.from({ length: 48 }, (_, i) => i), 60], values: [0, ...Array<number>(48).fill(250)] });
        expect(JSON.stringify(result)).not.toContain('private-source');
        const samples = await buildActivitySampleDataset(context, ['power'], dependencies);
        expect(samples.series).toEqual([{ metric: 'power', canonicalUnit: 'watts', values: watts }]);
        expect(samples.length).toBe(61);
        expect(JSON.stringify(samples)).not.toContain('private-source');
        expect(payload).toEqual(original);
    });
});
