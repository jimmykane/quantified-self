import {
    AppRouteInterface,
    FirestoreRouteJSON,
    FirestoreRouteSegmentJSON,
    OriginalRouteFileMetaData,
    RouteBounds,
    RouteFileJSONInterface,
    RouteJSONInterface,
    RoutePointJSONInterface,
    RoutePointSummary,
    RouteStreamsJSON,
} from '../../../shared/app-route.interface';
import { FirestoreAdapter, LogAdapter, StorageAdapter } from './event-writer';

export interface OriginalRouteFile {
    data: unknown;
    extension: string;
    startDate: Date;
    originalFilename?: string;
}

type JsonObject = Record<string, unknown>;

const consoleRouteLogAdapter: LogAdapter = {
    info: (message: string, ...args: unknown[]) => console.log('[RouteWriter]', message, ...args),
    warn: (message: string, ...args: unknown[]) => console.warn('[RouteWriter]', message, ...args),
    error: (message: string | Error, ...args: unknown[]) => console.error('[RouteWriter]', message, ...args),
};

function collectUndefinedPaths(
    value: unknown,
    maxPaths: number = 20,
): string[] {
    const paths: string[] = [];
    const visited = new WeakSet<object>();

    const walk = (node: unknown, currentPath: string): void => {
        if (paths.length >= maxPaths) {
            return;
        }

        if (node === undefined) {
            paths.push(currentPath || '<root>');
            return;
        }

        if (node === null || typeof node !== 'object') {
            return;
        }

        const nodeObject = node as object;
        if (visited.has(nodeObject)) {
            return;
        }
        visited.add(nodeObject);

        if (Array.isArray(node)) {
            node.forEach((item, index) => {
                const nextPath = currentPath ? `${currentPath}[${index}]` : `[${index}]`;
                walk(item, nextPath);
            });
            return;
        }

        Object.entries(node as Record<string, unknown>).forEach(([key, child]) => {
            const nextPath = currentPath ? `${currentPath}.${key}` : key;
            walk(child, nextPath);
        });
    };

    walk(value, '');
    return paths;
}

function isFirestoreUndefinedValueError(error: Error): boolean {
    const message = (error.message || '').toLowerCase();
    const hasCannotUseUndefined = /cannot use ['"]?undefined['"]? as a firestore value/.test(message);
    const hasInvalidDocumentUndefinedPattern = message.includes('not a valid firestore document')
        && (message.includes('found in field') || message.includes('ignoreundefinedproperties'));

    return hasCannotUseUndefined || hasInvalidDocumentUndefinedPattern;
}

function removeUndefinedAndInvalidNumbers<T>(value: T, visited = new WeakMap<object, unknown>()): T {
    if (value === undefined) {
        return undefined as T;
    }

    if (typeof value === 'number') {
        return (Number.isFinite(value) ? value : null) as T;
    }

    if (value === null || typeof value !== 'object') {
        return value;
    }

    if (value instanceof Date) {
        return new Date(value.getTime()) as T;
    }

    const cached = visited.get(value as object);
    if (cached) {
        return cached as T;
    }

    if (Array.isArray(value)) {
        const sanitizedArray: unknown[] = [];
        visited.set(value, sanitizedArray);
        for (const item of value) {
            const sanitized = removeUndefinedAndInvalidNumbers(item, visited);
            if (sanitized !== undefined) {
                sanitizedArray.push(sanitized);
            }
        }
        return sanitizedArray as T;
    }

    const sanitizedObject: JsonObject = {};
    visited.set(value as object, sanitizedObject);
    Object.entries(value as JsonObject).forEach(([key, child]) => {
        const sanitizedChild = removeUndefinedAndInvalidNumbers(child, visited);
        if (sanitizedChild !== undefined) {
            sanitizedObject[key] = sanitizedChild;
        }
    });
    return sanitizedObject as T;
}

function toDateOrNull(value: unknown): Date | null {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    if (typeof value === 'string' && value.trim()) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    return null;
}

function toFiniteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getRouteStreamTypes(streams: RouteStreamsJSON | undefined): string[] {
    if (!streams) {
        return [];
    }

    if (Array.isArray(streams)) {
        return Array.from(new Set(
            streams
                .map(stream => typeof stream?.type === 'string' ? stream.type : null)
                .filter((streamType): streamType is string => !!streamType)
        )).sort();
    }

    return Object.keys(streams).sort();
}

function getRoutePointSummary(point: RoutePointJSONInterface | undefined): RoutePointSummary | undefined {
    const latitude = toFiniteNumber(point?.latitudeDegrees);
    const longitude = toFiniteNumber(point?.longitudeDegrees);
    if (latitude === null || longitude === null) {
        return undefined;
    }

    return removeUndefinedAndInvalidNumbers({
        latitudeDegrees: latitude,
        longitudeDegrees: longitude,
        altitude: point?.altitude ?? null,
        name: point?.name ?? null,
    });
}

function getRouteBounds(points: RoutePointJSONInterface[]): RouteBounds | undefined {
    let minLatitudeDegrees = Number.POSITIVE_INFINITY;
    let maxLatitudeDegrees = Number.NEGATIVE_INFINITY;
    let minLongitudeDegrees = Number.POSITIVE_INFINITY;
    let maxLongitudeDegrees = Number.NEGATIVE_INFINITY;
    let hasPosition = false;

    for (const point of points) {
        const latitude = toFiniteNumber(point.latitudeDegrees);
        const longitude = toFiniteNumber(point.longitudeDegrees);
        if (latitude === null || longitude === null) {
            continue;
        }

        minLatitudeDegrees = Math.min(minLatitudeDegrees, latitude);
        maxLatitudeDegrees = Math.max(maxLatitudeDegrees, latitude);
        minLongitudeDegrees = Math.min(minLongitudeDegrees, longitude);
        maxLongitudeDegrees = Math.max(maxLongitudeDegrees, longitude);
        hasPosition = true;
    }

    if (!hasPosition) {
        return undefined;
    }

    return {
        minLatitudeDegrees,
        maxLatitudeDegrees,
        minLongitudeDegrees,
        maxLongitudeDegrees,
    };
}

function mergeBounds(boundsList: (RouteBounds | undefined)[]): RouteBounds | undefined {
    const validBounds = boundsList.filter((bounds): bounds is RouteBounds => !!bounds);
    if (validBounds.length === 0) {
        return undefined;
    }

    return validBounds.reduce<RouteBounds>((merged, bounds) => ({
        minLatitudeDegrees: Math.min(merged.minLatitudeDegrees, bounds.minLatitudeDegrees),
        maxLatitudeDegrees: Math.max(merged.maxLatitudeDegrees, bounds.maxLatitudeDegrees),
        minLongitudeDegrees: Math.min(merged.minLongitudeDegrees, bounds.minLongitudeDegrees),
        maxLongitudeDegrees: Math.max(merged.maxLongitudeDegrees, bounds.maxLongitudeDegrees),
    }), validBounds[0]);
}

function summarizeRoute(routeJSON: RouteJSONInterface): FirestoreRouteSegmentJSON {
    const points = Array.isArray(routeJSON.points) ? routeJSON.points : [];
    const bounds = getRouteBounds(points);
    const streamTypes = getRouteStreamTypes(routeJSON.streams);

    return removeUndefinedAndInvalidNumbers({
        id: routeJSON.id,
        name: routeJSON.name ?? null,
        activityType: routeJSON.activityType ?? null,
        comment: routeJSON.comment ?? null,
        description: routeJSON.description ?? null,
        number: routeJSON.number ?? null,
        links: routeJSON.links,
        stats: routeJSON.stats || {},
        pointCount: points.length,
        streamTypes,
        bounds,
        startPoint: getRoutePointSummary(points[0]),
        endPoint: getRoutePointSummary(points[points.length - 1]),
    });
}

export function buildFirestoreRoutePayload(userID: string, routeFile: AppRouteInterface): FirestoreRouteJSON {
    const routeFileJSON: RouteFileJSONInterface = routeFile.toJSON();
    const routeSummaries = (Array.isArray(routeFileJSON.routes) ? routeFileJSON.routes : []).map(summarizeRoute);
    const streamTypes = Array.from(new Set(routeSummaries.flatMap(route => route.streamTypes))).sort();
    const activityTypes = Array.from(new Set(
        routeSummaries
            .map(route => route.activityType)
            .filter((activityType): activityType is string => typeof activityType === 'string' && activityType.trim().length > 0)
    )).sort();
    const createdAt = routeFile.createdAt || toDateOrNull(routeFileJSON.createdAt);

    return removeUndefinedAndInvalidNumbers({
        id: routeFile.getID() || routeFileJSON.id,
        userID,
        name: routeFileJSON.name || routeFile.name || 'Untitled route',
        srcFileType: routeFileJSON.srcFileType || routeFile.srcFileType || 'unknown',
        createdAt,
        creator: routeFileJSON.creator || routeFile.creator,
        routes: routeSummaries,
        routeCount: routeSummaries.length,
        waypointCount: Array.isArray(routeFileJSON.waypoints) ? routeFileJSON.waypoints.length : 0,
        pointCount: routeSummaries.reduce((sum, route) => sum + route.pointCount, 0),
        activityTypes,
        streamTypes,
        bounds: mergeBounds(routeSummaries.map(route => route.bounds)),
        importedAt: new Date(),
        updatedAt: new Date(),
    });
}

export class RouteWriter {
    private logger: LogAdapter;

    constructor(
        private adapter: FirestoreAdapter,
        private storageAdapter?: StorageAdapter,
        private bucketName?: string,
        logger?: LogAdapter,
    ) {
        this.logger = logger || consoleRouteLogAdapter;
    }

    /**
     * Writes a first-class route document and its original route file(s).
     *
     * Firestore stores only sanitized route summaries. Original FIT/GPX bytes are
     * the canonical source for full route geometry and streams.
     */
    public async writeAllRouteData(
        userID: string,
        routeFile: AppRouteInterface,
        originalFiles?: OriginalRouteFile[] | OriginalRouteFile,
    ): Promise<OriginalRouteFileMetaData[]> {
        const routeID = routeFile.getID();
        if (!routeID) {
            routeFile.setID(this.adapter.generateID());
        }

        const resolvedRouteID = routeFile.getID();
        if (!resolvedRouteID) {
            throw new Error('Route ID is required before writing route data.');
        }

        this.logger.info('writeAllRouteData called', { userID, routeID: resolvedRouteID, adapterPresent: !!this.storageAdapter });
        const routeJSON = buildFirestoreRoutePayload(userID, routeFile);
        let persistedOriginalFiles: OriginalRouteFileMetaData[] = [];

        const filesToUpload = originalFiles
            ? (Array.isArray(originalFiles) ? originalFiles : [originalFiles])
            : [];

        if (filesToUpload.length > 0 && this.storageAdapter) {
            const uploadedFilesMetadata: OriginalRouteFileMetaData[] = [];
            const uploadAttemptID = this.adapter.generateID();

            for (let i = 0; i < filesToUpload.length; i++) {
                const file = filesToUpload[i];
                const filename = filesToUpload.length === 1
                    ? `original.${file.extension}`
                    : `original_${i}.${file.extension}`;
                const filePath = `users/${userID}/routes/${resolvedRouteID}/uploads/${uploadAttemptID}/${filename}`;

                this.logger.info(`Uploading route file ${i + 1}/${filesToUpload.length} to`, filePath);
                await this.storageAdapter.uploadFile(filePath, file.data);

                uploadedFilesMetadata.push(removeUndefinedAndInvalidNumbers({
                    path: filePath,
                    bucket: this.storageAdapter.getBucketName?.() || this.bucketName,
                    startDate: file.startDate,
                    originalFilename: file.originalFilename,
                    extension: file.extension,
                }));
            }

            if (uploadedFilesMetadata.length > 0) {
                routeJSON.originalFiles = uploadedFilesMetadata;
                routeJSON.originalFile = uploadedFilesMetadata[0];
                persistedOriginalFiles = [...uploadedFilesMetadata];
            }
        } else {
            this.logger.warn('Skipping route file upload.', 'storageAdapter:', !!this.storageAdapter);
            if (routeFile.originalFiles) {
                routeJSON.originalFiles = routeFile.originalFiles;
                persistedOriginalFiles = [...routeFile.originalFiles];
            }
            if (routeFile.originalFile) {
                routeJSON.originalFile = routeFile.originalFile;
                if (!persistedOriginalFiles.length) {
                    persistedOriginalFiles = [routeFile.originalFile];
                }
            }
        }

        await this.writeDocWithContext(['users', userID, 'routes', resolvedRouteID], routeJSON);
        return persistedOriginalFiles;
    }

    private async writeDocWithContext(path: string[], data: unknown): Promise<void> {
        try {
            await this.adapter.setDoc(path, data);
        } catch (e) {
            const error = e as Error;
            const documentPath = path.join('/');
            const undefinedPaths = collectUndefinedPaths(data);
            const hasUndefinedValueWriteError = undefinedPaths.length > 0 && isFirestoreUndefinedValueError(error);

            if (undefinedPaths.length > 0) {
                this.logger.warn('Firestore route write payload contains undefined values', {
                    documentPath,
                    undefinedFieldPaths: undefinedPaths,
                });
            }
            this.logger.error('Firestore route write failed for document', {
                documentPath,
                errorMessage: error?.message || `${error}`,
            });

            const undefinedSuffix = hasUndefinedValueWriteError
                ? ` Undefined field paths: ${undefinedPaths.join(', ')}.`
                : '';
            throw new Error(`Firestore route write failed for ${documentPath}: ${error.message}.${undefinedSuffix}`);
        }
    }
}
