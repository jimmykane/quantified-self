'use strict';

import { HttpsError } from 'firebase-functions/v2/https';
import { RouteExporterGPX, RouteFileInterface } from '@sports-alliance/sports-lib';

import {
  getRouteParsingFailureMessage,
  parseRoutePayload,
  RouteProcessingHttpStatusError,
} from './route-processing';
import { MAX_ROUTE_UPLOAD_BYTES } from '../shared/route-processing-config';

const MAX_BASE64_ROUTE_UPLOAD_LENGTH = Math.ceil(MAX_ROUTE_UPLOAD_BYTES / 3) * 4 + 4;

export type ManualRouteInputFormat = 'fit' | 'gpx';

export interface ManualRouteUploadRequest {
  file?: unknown;
  filename?: unknown;
}

export function getManualRouteInputFormat(
  filename: unknown,
  destinationLabel: string,
  formatDescription = 'GPX or FIT',
): ManualRouteInputFormat {
  const normalizedFilename = `${filename || ''}`.trim().toLowerCase();
  if (normalizedFilename.endsWith('.fit')) {
    return 'fit';
  }
  if (normalizedFilename.endsWith('.gpx')) {
    return 'gpx';
  }

  throw new HttpsError('invalid-argument', `${destinationLabel} routes must be ${formatDescription} files.`);
}

export function decodeManualRouteUpload(value: unknown): Buffer {
  if (typeof value !== 'string' || value.length === 0) {
    throw new HttpsError('invalid-argument', 'File content missing.');
  }
  if (value.length > MAX_BASE64_ROUTE_UPLOAD_LENGTH
    || value.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new HttpsError('invalid-argument', 'File content is not valid base64.');
  }

  const payload = Buffer.from(value, 'base64');
  if (payload.length === 0) {
    throw new HttpsError('invalid-argument', 'File content is empty.');
  }
  if (payload.length > MAX_ROUTE_UPLOAD_BYTES) {
    throw new HttpsError('invalid-argument', 'Cannot upload route because the size is greater than 20MB.');
  }
  return payload;
}

export async function parseManualRouteUpload(
  payload: Buffer,
  inputFormat: ManualRouteInputFormat,
): Promise<RouteFileInterface> {
  try {
    const routeFile = await parseRoutePayload(payload, inputFormat);
    if (!routeFile.hasRoutes()) {
      throw new RouteProcessingHttpStatusError(400, `No routes found in ${inputFormat.toUpperCase()} file.`);
    }
    return routeFile as RouteFileInterface;
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('invalid-argument', getRouteParsingFailureMessage(error, inputFormat));
  }
}

export async function exportManualRouteAsGPX(routeFile: RouteFileInterface): Promise<string> {
  try {
    const gpxContent = await new RouteExporterGPX().getAsString(routeFile);
    if (!gpxContent.trim()) {
      throw new Error('Generated GPX route is empty.');
    }
    if (Buffer.byteLength(gpxContent, 'utf8') > MAX_ROUTE_UPLOAD_BYTES) {
      throw new HttpsError('invalid-argument', 'Cannot upload route because the converted GPX file is greater than 20MB.');
    }
    return gpxContent;
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError(
      'invalid-argument',
      'This route could not be converted to a GPX route. It must contain valid route coordinates.',
    );
  }
}
