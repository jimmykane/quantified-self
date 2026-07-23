'use strict';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeProcessingMocks = {
  parseRoutePayload: vi.fn(),
  getRouteParsingFailureMessage: vi.fn(() => 'Route parsing failed.'),
};
const routeExportMocks = {
  getAsString: vi.fn(),
};

vi.mock('./route-processing', () => ({
  parseRoutePayload: (...args: unknown[]) => routeProcessingMocks.parseRoutePayload(...args),
  getRouteParsingFailureMessage: (...args: unknown[]) => routeProcessingMocks.getRouteParsingFailureMessage(...args),
  RouteProcessingHttpStatusError: class RouteProcessingHttpStatusError extends Error {
    constructor(public readonly status: number, message: string) {
      super(message);
    }
  },
}));

vi.mock('@sports-alliance/sports-lib', () => ({
  RouteExporterGPX: class RouteExporterGPX {
    getAsString(...args: unknown[]) {
      return routeExportMocks.getAsString(...args);
    }
  },
}));

import {
  decodeManualRouteUpload,
  exportManualRouteAsGPX,
  getManualRouteInputFormat,
  parseManualRouteUpload,
} from './manual-route-upload';

describe('manual route upload helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('recognizes only FIT and GPX filenames', () => {
    expect(getManualRouteInputFormat('Morning.FIT', 'Suunto')).toBe('fit');
    expect(getManualRouteInputFormat('Morning.gpx', 'Garmin')).toBe('gpx');
    expect(() => getManualRouteInputFormat('Morning.tcx', 'Wahoo')).toThrow('Wahoo routes must be GPX or FIT files.');
  });

  it('decodes a bounded base64 source payload', () => {
    expect(decodeManualRouteUpload('AQID')).toEqual(Buffer.from([1, 2, 3]));
    expect(() => decodeManualRouteUpload('not base64!')).toThrow('File content is not valid base64.');
    expect(() => decodeManualRouteUpload('')).toThrow('File content missing.');
  });

  it('parses a source route and rejects a parsed file without routes', async () => {
    const routeFile = { hasRoutes: () => true };
    routeProcessingMocks.parseRoutePayload.mockResolvedValueOnce(routeFile);

    await expect(parseManualRouteUpload(Buffer.from('FIT'), 'fit')).resolves.toBe(routeFile);
    expect(routeProcessingMocks.parseRoutePayload).toHaveBeenCalledWith(Buffer.from('FIT'), 'fit');

    routeProcessingMocks.parseRoutePayload.mockResolvedValueOnce({ hasRoutes: () => false });
    await expect(parseManualRouteUpload(Buffer.from('<gpx/>'), 'gpx')).rejects.toMatchObject({
      code: 'invalid-argument',
      message: 'Route parsing failed.',
    });
  });

  it('exports a parsed route as bounded GPX', async () => {
    routeExportMocks.getAsString.mockResolvedValueOnce('<gpx><rte/></gpx>');
    await expect(exportManualRouteAsGPX({} as never)).resolves.toBe('<gpx><rte/></gpx>');

    routeExportMocks.getAsString.mockResolvedValueOnce('');
    await expect(exportManualRouteAsGPX({} as never)).rejects.toMatchObject({
      code: 'invalid-argument',
      message: 'This route could not be converted to a GPX route. It must contain valid route coordinates.',
    });
  });
});
