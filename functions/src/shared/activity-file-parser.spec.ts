import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
    const fitImporter = { getFromArrayBuffer: vi.fn() };
    const gpxImporter = { getFromString: vi.fn() };
    const tcxImporter = { getFromXML: vi.fn() };
    const suuntoJSONImporter = { getFromJSONString: vi.fn() };
    const suuntoSMLImporter = { getFromXML: vi.fn(), getFromJSONString: vi.fn() };

    return {
        fitImporter,
        gpxImporter,
        tcxImporter,
        suuntoJSONImporter,
        suuntoSMLImporter,
    };
});

vi.mock('@sports-alliance/sports-lib', () => ({
    ActivityParsingOptions: class ActivityParsingOptions {
        constructor(public opts: unknown) { }
    },
    EventImporterFIT: hoisted.fitImporter,
    EventImporterGPX: hoisted.gpxImporter,
    EventImporterTCX: hoisted.tcxImporter,
    EventImporterSuuntoJSON: hoisted.suuntoJSONImporter,
    EventImporterSuuntoSML: hoisted.suuntoSMLImporter,
}));

import {
    getActivityFileBaseExtension,
    parseActivityFilePayload,
} from './activity-file-parser';

function makeEvent(id: string) {
    return { id, getActivities: vi.fn(() => []) };
}

function arrayBufferToBuffer(data: ArrayBuffer): Buffer {
    return Buffer.from(new Uint8Array(data));
}

describe('activity-file-parser', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.fitImporter.getFromArrayBuffer.mockResolvedValue(makeEvent('fit'));
        hoisted.gpxImporter.getFromString.mockResolvedValue(makeEvent('gpx'));
        hoisted.tcxImporter.getFromXML.mockResolvedValue(makeEvent('tcx'));
        hoisted.suuntoJSONImporter.getFromJSONString.mockResolvedValue(makeEvent('json'));
        hoisted.suuntoSMLImporter.getFromXML.mockResolvedValue(makeEvent('sml'));
        hoisted.suuntoSMLImporter.getFromJSONString.mockResolvedValue(makeEvent('sml-json'));
    });

    it('normalizes base extensions from extensions and storage paths', () => {
        expect(getActivityFileBaseExtension('FIT')).toBe('fit');
        expect(getActivityFileBaseExtension('run.TCX.GZ')).toBe('tcx');
        expect(getActivityFileBaseExtension('users/u1/events/e1/original.json.gz')).toBe('json');
        expect(getActivityFileBaseExtension('users/u1/events/e1/original.')).toBe('');
    });

    it('routes FIT, GPX, TCX, and SML payloads to the matching sports-lib importers', async () => {
        const fitPayload = Buffer.from([1, 2, 3]);
        await parseActivityFilePayload(fitPayload, 'fit');
        await parseActivityFilePayload(Buffer.from('<gpx/>'), 'gpx');
        await parseActivityFilePayload(Buffer.from('<TrainingCenterDatabase/>'), 'tcx');
        await parseActivityFilePayload(Buffer.from('<sml/>'), 'sml');

        expect(arrayBufferToBuffer(hoisted.fitImporter.getFromArrayBuffer.mock.calls[0][0])).toEqual(fitPayload);
        expect(hoisted.gpxImporter.getFromString).toHaveBeenCalledWith('<gpx/>', expect.any(Function), expect.anything());
        expect(hoisted.tcxImporter.getFromXML).toHaveBeenCalledWith(expect.anything(), expect.anything());
        expect(hoisted.suuntoSMLImporter.getFromXML).toHaveBeenCalledWith('<sml/>', expect.anything());
    });

    it('parses Suunto JSON without fallback when the primary parser succeeds', async () => {
        await expect(parseActivityFilePayload(Buffer.from('{"DeviceLog":{}}'), 'json')).resolves.toEqual(expect.objectContaining({ id: 'json' }));

        expect(hoisted.suuntoJSONImporter.getFromJSONString).toHaveBeenCalledTimes(1);
        expect(hoisted.suuntoSMLImporter.getFromJSONString).not.toHaveBeenCalled();
    });

    it('falls back to Suunto SML JSON when the primary Suunto JSON parser fails', async () => {
        hoisted.suuntoJSONImporter.getFromJSONString.mockRejectedValueOnce(new Error('missing DeviceLog'));

        await expect(parseActivityFilePayload(Buffer.from('{"Samples":[]}'), 'json')).resolves.toEqual(expect.objectContaining({ id: 'sml-json' }));

        expect(hoisted.suuntoJSONImporter.getFromJSONString).toHaveBeenCalledTimes(1);
        expect(hoisted.suuntoSMLImporter.getFromJSONString).toHaveBeenCalledWith('{"Samples":[]}', expect.anything());
    });

    it('rejects unsupported extensions', async () => {
        await expect(parseActivityFilePayload(Buffer.from('x'), 'txt')).rejects.toThrow('Unsupported original file extension: txt');
    });
});
