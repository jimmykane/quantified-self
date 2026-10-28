import { describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import { DataLatitudeDegrees } from '@sports-alliance/sports-lib';
import { parseActivityFilePayload } from './activity-file-parser';

const timedTrack = (times: string[]) => Buffer.from(`<gpx version="1.1"
    xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>
    ${times.map((time, index) => `<trkpt lat="${1 + index * 0.001}" lon="2"><time>${time}</time></trkpt>`).join('')}
    </trkseg></trk></gpx>`);

describe('published GPX timestamp compatibility', () => {
    it('uses Unix-millisecond point times through the shared production parser', async () => {
        const start = Date.UTC(2026, 0, 1, 10, 0, 0, 250);
        const event = await parseActivityFilePayload(
            timedTrack([start, start + 3000, start + 6000].map(String)),
            'synthetic.gpx',
        );
        const activity = event.getFirstActivity();

        expect(event.getActivities()).toHaveLength(1);
        expect(activity.startDate.getTime()).toBe(start);
        expect(activity.endDate.getTime()).toBe(start + 6000);
        expect(activity.getDuration()?.getValue()).toBe(6);
        expect(activity.getStreamData(DataLatitudeDegrees.type)).toEqual([1, null, null, 1.001, null, null, 1.002]);
        expect(() => JSON.stringify(event.toJSON())).not.toThrow();
    });

    it('returns a typed error without echoing invalid point content', async () => {
        const result = parseActivityFilePayload(
            timedTrack(['2026-01-01T10:00:00Z', 'synthetic-invalid-time']),
            'synthetic.gpx',
        );

        await expect(result).rejects.toBeInstanceOf(Error);
        await expect(result).rejects.toMatchObject({
            code: 'PARSING_LIB_ERROR',
            message: 'GPX track points contain invalid timestamps',
        });
    });
});
