import { SportsLib } from '@sports-alliance/sports-lib';
import * as logger from 'firebase-functions/logger';
import { FieldValue } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { gunzipSync } from 'node:zlib';
import * as xmldom from 'xmldom';

import {
  AppRouteInterface,
  AppRouteSegmentInterface,
  OriginalRouteFileMetaData,
} from '../../../shared/app-route.interface';
import { createRouteParsingOptions, RouteParsingOptionsLike } from '../../../shared/parsing-options';
import { ProcessingMetaData, ROUTE_PROCESSING_ENTITY } from '../shared/processing-metadata.interface';
import {
  MAX_ROUTE_DECOMPRESSED_BYTES,
  MAX_ROUTE_DECOMPRESSED_BYTES_LABEL,
} from '../shared/route-processing-config';
import { SPORTS_LIB_VERSION } from '../shared/sports-lib-version.node';
import { sportsLibVersionToCode } from '../reparse/sports-lib-reparse.service';

const SUPPORTED_BASE_EXTENSIONS = new Set(['fit', 'gpx']);
const MAX_ROUTE_GZIP_DECOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_ROUTE_GZIP_DECOMPRESSED_BYTES_LABEL = '64MB';

type SportsLibRouteImporter = typeof SportsLib & {
  importRoutesFromGPX(gpxString: string, domParser?: unknown, options?: RouteParsingOptionsLike): Promise<AppRouteInterface>;
  importRoutesFromFit(arrayBuffer: ArrayBuffer, options?: RouteParsingOptionsLike): Promise<AppRouteInterface>;
};

export class RouteProcessingHttpStatusError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'RouteProcessingHttpStatusError';
  }
}

function toArrayBuffer(data: Buffer): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

function decodeText(data: Buffer): string {
  return new TextDecoder().decode(toArrayBuffer(data));
}

function hasGzipMagic(data: Buffer): boolean {
  return data.length > 2 && data[0] === 0x1f && data[1] === 0x8b;
}

export function shouldDecompressPayloadForParsing(payload: Buffer, resolvedExtension: string): boolean {
  return resolvedExtension.endsWith('.gz') || hasGzipMagic(payload);
}

function normalizeExtension(extension: string): string {
  const normalized = extension.trim().toLowerCase();
  return normalized.startsWith('.') ? normalized.slice(1) : normalized;
}

export function getBaseExtension(extension: string): string {
  return extension.endsWith('.gz') ? extension.slice(0, -3) : extension;
}

function resolveExtensionFromFilename(filename?: string): string | null {
  if (!filename) {
    return null;
  }

  const name = basename(filename).toLowerCase().trim();
  if (!name.includes('.')) {
    return null;
  }

  const parts = name.split('.').filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  const ext = parts[parts.length - 1];
  if (ext === 'gz' && parts.length >= 3) {
    return `${parts[parts.length - 2]}.gz`;
  }
  return ext;
}

function resolveSupportedExtension(extension: string): string | null {
  const normalizedExtension = normalizeExtension(extension);
  const baseExtension = getBaseExtension(normalizedExtension);
  if (!SUPPORTED_BASE_EXTENSIONS.has(baseExtension)) {
    return null;
  }
  return normalizedExtension.endsWith('.gz') ? `${baseExtension}.gz` : baseExtension;
}

export function resolveUploadExtension(
  extensionHeader?: string,
  originalFilenameHeader?: string,
): string {
  const fromHeader = extensionHeader ? normalizeExtension(extensionHeader) : '';
  const fromFilename = resolveExtensionFromFilename(originalFilenameHeader);
  const resolved = fromHeader || (fromFilename ? normalizeExtension(fromFilename) : '');

  if (!resolved) {
    throw new RouteProcessingHttpStatusError(400, 'File extension is required.');
  }

  const supportedExtension = resolveSupportedExtension(resolved);
  if (!supportedExtension) {
    throw new RouteProcessingHttpStatusError(400, `Unsupported route file extension: ${getBaseExtension(resolved)}. Supported: fit, gpx.`);
  }

  return supportedExtension;
}

export function resolveRouteSourceExtension(
  sourceFile: OriginalRouteFileMetaData,
  fallbackExtension?: string,
): string {
  const candidates = [
    sourceFile.extension,
    resolveExtensionFromFilename(sourceFile.path),
    resolveExtensionFromFilename(sourceFile.originalFilename),
    fallbackExtension,
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const supportedExtension = resolveSupportedExtension(candidate);
    if (supportedExtension) {
      return supportedExtension;
    }
  }

  throw new RouteProcessingHttpStatusError(400, 'Saved route source file has no supported extension.');
}

export function resolveStoredExtension(resolvedExtension: string, payload: Buffer): string {
  const baseExtension = getBaseExtension(resolvedExtension);
  if (resolvedExtension.endsWith('.gz')) {
    return `${baseExtension}.gz`;
  }

  if (hasGzipMagic(payload)) {
    return `${baseExtension}.gz`;
  }
  return baseExtension;
}

function resolveMaxRouteDecompressedBytes(): number {
  return Math.min(
    MAX_ROUTE_DECOMPRESSED_BYTES,
    MAX_ROUTE_GZIP_DECOMPRESSED_BYTES,
  );
}

function resolveRouteDecompressedBytesLabel(maxOutputLength: number): string {
  if (maxOutputLength === MAX_ROUTE_DECOMPRESSED_BYTES) {
    return MAX_ROUTE_DECOMPRESSED_BYTES_LABEL;
  }
  if (maxOutputLength === MAX_ROUTE_GZIP_DECOMPRESSED_BYTES) {
    return MAX_ROUTE_GZIP_DECOMPRESSED_BYTES_LABEL;
  }
  return `${Math.floor(maxOutputLength / 1024)}KB`;
}

export function maybeDecompressPayloadForParsing(payload: Buffer, resolvedExtension: string): Buffer {
  if (!shouldDecompressPayloadForParsing(payload, resolvedExtension)) {
    return payload;
  }

  const maxOutputLength = resolveMaxRouteDecompressedBytes();
  try {
    return gunzipSync(payload, { maxOutputLength });
  } catch (error) {
    logger.warn('[routeProcessing] Gzip decompression failed', {
      error,
      compressedBytes: payload.length,
      maxDecompressedBytes: maxOutputLength,
      maxConfiguredDecompressedBytes: MAX_ROUTE_DECOMPRESSED_BYTES,
      maxGzipDecompressedBytes: MAX_ROUTE_GZIP_DECOMPRESSED_BYTES,
      resolvedExtension,
    });
    if ((error as { code?: unknown } | undefined)?.code === 'ERR_BUFFER_TOO_LARGE') {
      throw new RouteProcessingHttpStatusError(
        400,
        `Route file is too large after decompression. Maximum decompressed size is ${resolveRouteDecompressedBytesLabel(maxOutputLength)}.`,
      );
    }
    throw new RouteProcessingHttpStatusError(400, 'Could not decompress uploaded route payload.');
  }
}

function getRouteImporter(): SportsLibRouteImporter {
  const routeImporter = SportsLib as SportsLibRouteImporter;
  if (typeof routeImporter.importRoutesFromFit !== 'function' || typeof routeImporter.importRoutesFromGPX !== 'function') {
    throw new RouteProcessingHttpStatusError(500, 'Route parsing is not available in the installed sports-lib version.');
  }
  return routeImporter;
}

export async function parseRoutePayload(payload: Buffer, resolvedExtension: string): Promise<AppRouteInterface> {
  const parsingOptions = createRouteParsingOptions();
  const baseExtension = getBaseExtension(resolvedExtension);
  const routeImporter = getRouteImporter();

  if (baseExtension === 'fit') {
    return routeImporter.importRoutesFromFit(toArrayBuffer(payload), parsingOptions);
  }

  if (baseExtension === 'gpx') {
    return routeImporter.importRoutesFromGPX(decodeText(payload), xmldom.DOMParser, parsingOptions);
  }

  throw new RouteProcessingHttpStatusError(400, `Unsupported route file extension: ${baseExtension}.`);
}

export function getRouteParsingFailureMessage(error: unknown, resolvedExtension: string): string {
  const message = error instanceof Error ? error.message : `${error || ''}`;
  const normalizedMessage = message.toLowerCase();
  const baseExtension = getBaseExtension(resolvedExtension);

  if (normalizedMessage.includes('no routes found')) {
    return 'No route data was found in this file. Upload a FIT course/route or a GPX file that contains route or track points.';
  }

  if (normalizedMessage.includes('not a route') || normalizedMessage.includes('not a route/course')) {
    return 'This FIT file looks like an activity, not a route/course. Use activity upload for workouts, or export a course/route file.';
  }

  if (normalizedMessage.includes('unable to parse fit')) {
    return 'Could not read this FIT route file. Export it again as a FIT course/route or GPX route and try again.';
  }

  if (baseExtension === 'gpx') {
    return 'Could not read this GPX route file. Upload a GPX file with route or track points and try again.';
  }

  if (baseExtension === 'fit') {
    return 'Could not read this FIT route file. Upload a FIT course/route file and try again.';
  }

  return 'Could not read this route file. Upload a FIT course/route or GPX route file and try again.';
}

export function generateUploadRouteID(userID: string, payload: Buffer, resolvedExtension: string): string {
  const baseExtension = getBaseExtension(resolvedExtension);

  return createHash('sha256')
    .update(baseExtension)
    .update(':')
    .update(userID)
    .update(':')
    .update(payload)
    .digest('hex');
}

export function generateRouteSegmentID(routeID: string, routeIndex: number): string {
  return createHash('sha256')
    .update(routeID)
    .update(':route:')
    .update(`${routeIndex}`)
    .digest('hex');
}

export function assignRouteSegmentIDs(
  routeFile: AppRouteInterface,
  routeID: string,
  existingSegmentIDs: Array<string | null | undefined> = [],
): void {
  const routes = routeFile.getRoutes();
  for (let i = 0; i < routes.length; i++) {
    const route = routes[i] as AppRouteSegmentInterface;
    const existingSegmentID = existingSegmentIDs[i];
    if (existingSegmentID && typeof route.setID === 'function') {
      route.setID(existingSegmentID);
      continue;
    }
    if (!route.getID?.() && typeof route.setID === 'function') {
      route.setID(generateRouteSegmentID(routeID, i));
    }
  }
}

export function createRouteProcessingMetadataPayload(): ProcessingMetaData {
  return {
    processingEntity: ROUTE_PROCESSING_ENTITY,
    sportsLibVersion: SPORTS_LIB_VERSION,
    sportsLibVersionCode: sportsLibVersionToCode(SPORTS_LIB_VERSION),
    processedAt: FieldValue.serverTimestamp(),
  };
}
