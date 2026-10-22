import { describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import { DataRRIntervalCount, DataRRMeanInterval, DataRRRMSSD, EventImporterJSON } from '@sports-alliance/sports-lib';
import { parseActivityFilePayload } from './activity-file-parser';
import { sanitizeActivityFirestoreWritePayload, sanitizeEventFirestoreWritePayload } from '../../../shared/firestore-write-sanitizer';
import { resolveAvailableSportsLibMetrics } from '../mcp/metric-catalog';

// A local-time header deliberately disagrees with the authoritative UTC sample clock.
const sml = `<sml><DeviceLog><Device><Name>Synthetic</Name><Info><HW>1</HW><SW>1</SW></Info></Device>
<Header><DateTime>2026-01-01T12:00:00</DateTime><Duration>10</Duration><ActivityType>3</ActivityType></Header>
<Samples><Sample><UTC>2026-01-01T10:00:00Z</UTC><Time>0</Time></Sample>
<Sample><UTC>2026-01-01T10:00:10Z</UTC><Time>10</Time></Sample></Samples>
<R-R><Data>1000 1000 1000 1000 1000 1000 1000 1000 1000 1000</Data></R-R></DeviceLog></sml>`;

describe('Sports Lib R-R adoption at QS source/persistence boundaries', () => {
    it('parses SML beat statistics on the UTC clock and saves summaries without raw intervals', async () => {
        const event = await parseActivityFilePayload(Buffer.from(sml), 'synthetic.sml');
        const activity = event.getFirstActivity();
        expect(activity.startDate.toISOString()).toBe('2026-01-01T10:00:00.000Z');
        expect(activity.getStream('IBI').toJSON()).toMatchObject({
            data: Array<number>(10).fill(1000), sampleTimes: Array.from({ length: 10 }, (_, i) => (i + 1) * 1000),
        });
        expect(activity.getStat(DataRRIntervalCount.type)?.getValue()).toBe(10);
        expect(activity.getStat(DataRRMeanInterval.type)?.getValue()).toBe(1000);
        expect(activity.getStat(DataRRRMSSD.type)?.getValue()).toBe(0);
        const sourceBefore = JSON.stringify(event.toJSON());
        const activityWrite = sanitizeActivityFirestoreWritePayload(activity.toJSON());
        const eventWrite = sanitizeEventFirestoreWritePayload(event.toJSON());
        expect(activityWrite).not.toHaveProperty('streams');
        expect(eventWrite).not.toHaveProperty('activities');
        expect(JSON.stringify(activityWrite)).not.toContain('sampleTimes');
        const restored = EventImporterJSON.getActivityFromJSON(JSON.parse(JSON.stringify(activityWrite)));
        expect(restored.getAllStreams()).toHaveLength(0);
        expect(restored.getStat(DataRRRMSSD.type)?.getValue()).toBe(0);
        expect(eventWrite.stats[DataRRRMSSD.type]).toBe(0);
        expect(resolveAvailableSportsLibMetrics([eventWrite.stats]).map(metric => metric.type)).toContain(DataRRRMSSD.type);
        expect(JSON.stringify(event.toJSON())).toBe(sourceBefore);
    });
});
