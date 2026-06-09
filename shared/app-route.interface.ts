import { OriginalFileMetaData } from './app-event.interface';

export interface OriginalRouteFileMetaData extends OriginalFileMetaData {
    extension?: string;
}

export interface RouteLinkJSONInterface {
    href: string;
    text?: string | null;
    type?: string | null;
}

export interface RoutePointJSONInterface {
    latitudeDegrees: number;
    longitudeDegrees: number;
    altitude?: number | null;
    name?: string | null;
    comment?: string | null;
    description?: string | null;
    symbol?: string | null;
    type?: string | null;
    links?: RouteLinkJSONInterface[];
    extensions?: unknown;
}

export interface RouteWaypointJSONInterface extends RoutePointJSONInterface {
    distance?: number | null;
    routeIndex?: number | null;
    routePointIndex?: number | null;
}

export interface RouteJSONInterface {
    id?: string;
    name: string | null;
    activityType: string | null;
    comment?: string | null;
    description?: string | null;
    number?: number | null;
    links?: RouteLinkJSONInterface[];
    extensions?: unknown;
    creator?: unknown;
    stats?: Record<string, unknown>;
    streams?: RouteStreamsJSON;
    points?: RoutePointJSONInterface[];
}

export interface RouteFileJSONInterface {
    id?: string;
    name: string;
    srcFileType: string;
    createdAt: number | Date | null;
    creator?: unknown;
    stats?: Record<string, unknown>;
    routes: RouteJSONInterface[];
    waypoints: RouteWaypointJSONInterface[];
}

export interface AppRouteSegmentInterface {
    name?: string | null;
    activityType?: string | null;
    getID?(): string | null | undefined;
    setID?(id: string): unknown;
    toJSON?(): RouteJSONInterface;
}

/**
 * Extended route file interface that includes original file metadata.
 *
 * This mirrors AppEventInterface's source-file strategy while keeping route
 * uploads first class under users/{uid}/routes/{routeId}.
 */
export interface AppRouteInterface {
    name: string;
    srcFileType: string;
    createdAt: Date | null;
    creator?: unknown;

    getID(): string | null | undefined;
    setID(id: string): unknown;
    getRoutes(): AppRouteSegmentInterface[];
    hasRoutes(): boolean;
    getWaypoints(): RouteWaypointJSONInterface[];
    toJSON(): RouteFileJSONInterface;

    /** @deprecated Use originalFiles[0] instead. Kept for event parity. */
    originalFile?: OriginalRouteFileMetaData;
    /** Canonical source for original route file metadata. Always an array. */
    originalFiles?: OriginalRouteFileMetaData[];
}

export type RouteStreamsJSON = { type?: string; data?: unknown }[] | { [streamType: string]: unknown[] };

export interface RouteBounds {
    minLatitudeDegrees: number;
    maxLatitudeDegrees: number;
    minLongitudeDegrees: number;
    maxLongitudeDegrees: number;
}

export interface RoutePointSummary {
    latitudeDegrees: number;
    longitudeDegrees: number;
    altitude?: number | null;
    name?: string | null;
}

export interface FirestoreRouteSegmentJSON {
    id?: string;
    name: string | null;
    activityType: string | null;
    comment?: string | null;
    description?: string | null;
    number?: number | null;
    links?: RouteLinkJSONInterface[];
    stats?: Record<string, unknown>;
    pointCount: number;
    streamTypes: string[];
    bounds?: RouteBounds;
    startPoint?: RoutePointSummary;
    endPoint?: RoutePointSummary;
}

/**
 * Route JSON structure as stored in Firestore.
 *
 * The document intentionally excludes full route `points`, `streams`, and
 * waypoints. Those live in the original uploaded file in Storage.
 */
export interface FirestoreRouteJSON {
    [key: string]: unknown;
    id?: string;
    userID: string;
    name: string;
    srcFileType: string;
    createdAt: Date | number | null;
    creator?: unknown;
    stats?: Record<string, unknown>;
    routes: FirestoreRouteSegmentJSON[];
    routeCount: number;
    waypointCount: number;
    pointCount: number;
    activityTypes: string[];
    streamTypes: string[];
    bounds?: RouteBounds;
    importedAt?: Date;
    updatedAt?: Date;
    /** @deprecated Use originalFiles[0] instead. Kept for event parity. */
    originalFile?: OriginalRouteFileMetaData;
    /** Canonical source for original route file metadata. */
    originalFiles?: OriginalRouteFileMetaData[];
}
