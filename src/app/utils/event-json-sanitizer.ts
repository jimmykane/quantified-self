import { DynamicDataLoader } from '@sports-alliance/sports-lib';

export type EventJSONSanitizerIssueKind = 'unknown_data_type' | 'invalid_event_shape' | 'malformed_event_payload';

export interface EventJSONSanitizerIssue {
    kind: EventJSONSanitizerIssueKind;
    location: 'stats' | 'streams' | 'events';
    path: string;
    type?: string;
    reason: string;
}

export class EventJSONSanitizer {
    private static readonly EVENT_METADATA_KEYS = new Set(['timestamp', 'time', 'date', 'startDate', 'endDate', 'index', 'offset']);

    /**
     * Sanitizes the Event JSON by removing any data types that are not registered in the DynamicDataLoader.
     * Returns the sanitized JSON and a list of unknown types that were removed.
     */
    static sanitize(json: any): { sanitizedJson: any, unknownTypes: string[], issues: EventJSONSanitizerIssue[] } {
        const unknownTypes: Set<string> = new Set();
        const issues: EventJSONSanitizerIssue[] = [];

        if (!json) {
            return { sanitizedJson: json, unknownTypes: [], issues: [] };
        }

        const sanitizedJson = { ...json }; // Shallow copy to start

        // 1. Sanitize Event Stats
        if (sanitizedJson.stats) {
            sanitizedJson.stats = EventJSONSanitizer.sanitizeStats(sanitizedJson.stats, unknownTypes, issues, 'stats');
        }

        // 1b. Support activity-level payloads (getActivities passes a single Activity JSON object)
        if (sanitizedJson.streams) {
            sanitizedJson.streams = EventJSONSanitizer.sanitizeStreams(sanitizedJson.streams, unknownTypes, issues, 'streams');
        }
        if (sanitizedJson.events) {
            sanitizedJson.events = EventJSONSanitizer.sanitizeEvents(sanitizedJson.events, unknownTypes, issues, 'events');
        }

        // 2. Sanitize Activities
        if (sanitizedJson.activities && Array.isArray(sanitizedJson.activities)) {
            sanitizedJson.activities = sanitizedJson.activities.map((activity, activityIndex) => {
                const sanitizedActivity = { ...activity };

                // Sanitize Activity Stats
                if (sanitizedActivity.stats) {
                    sanitizedActivity.stats = EventJSONSanitizer.sanitizeStats(
                        sanitizedActivity.stats,
                        unknownTypes,
                        issues,
                        `activities[${activityIndex}].stats`
                    );
                }

                // Sanitize Activity Streams
                if (sanitizedActivity.streams) {
                    sanitizedActivity.streams = EventJSONSanitizer.sanitizeStreams(
                        sanitizedActivity.streams,
                        unknownTypes,
                        issues,
                        `activities[${activityIndex}].streams`
                    );
                }

                // Sanitize Activity Events
                if (sanitizedActivity.events) {
                    sanitizedActivity.events = EventJSONSanitizer.sanitizeEvents(
                        sanitizedActivity.events,
                        unknownTypes,
                        issues,
                        `activities[${activityIndex}].events`
                    );
                }

                return sanitizedActivity;
            });
        }

        return { sanitizedJson, unknownTypes: Array.from(unknownTypes), issues };
    }

    private static sanitizeStats(stats: any, unknownTypes: Set<string>, issues: EventJSONSanitizerIssue[], pathPrefix: string): any {
        const sanitizedStats = { ...stats };
        Object.keys(sanitizedStats).forEach(type => {
            // DynamicDataLoader.getDataClassFromDataType returns the class constructor if found, or undefined/null if not.
            // Depending on library version it might throw or return null. 
            // Based on previous error "Class type ... is not in the store", it likely throws or returns undefined. 
            // We will safeguard this check.
            let dataClass;
            try {
                dataClass = DynamicDataLoader.getDataClassFromDataType(type);
            } catch {
                dataClass = null;
            }

            if (!dataClass) {
                unknownTypes.add(type);
                issues.push({
                    kind: 'unknown_data_type',
                    location: 'stats',
                    path: `${pathPrefix}.${type}`,
                    type,
                    reason: 'Removed unknown stat data type'
                });
                delete sanitizedStats[type];
            }
        });
        return sanitizedStats;
    }

    private static sanitizeStreams(streams: any, unknownTypes: Set<string>, issues: EventJSONSanitizerIssue[], pathPrefix: string): any {
        // Streams can be an array of objects (StreamJSONInterface[]) or an object map { [type]: values }

        if (Array.isArray(streams)) {
            // It's an array of StreamJSONInterface
            return streams.filter((stream, streamIndex) => {
                const type = stream.type;
                let dataClass;
                try {
                    dataClass = DynamicDataLoader.getDataClassFromDataType(type);
                } catch {
                    dataClass = null;
                }

                if (!dataClass) {
                    unknownTypes.add(type);
                    issues.push({
                        kind: 'unknown_data_type',
                        location: 'streams',
                        path: `${pathPrefix}[${streamIndex}]`,
                        type,
                        reason: 'Removed unknown stream data type from array payload'
                    });
                    return false; // Remove this stream
                }
                return true;
            });
        } else if (typeof streams === 'object' && streams !== null) {
            // It's a dictionary of streams
            const sanitizedStreams = { ...streams };
            Object.keys(sanitizedStreams).forEach(type => {
                let dataClass;
                try {
                    dataClass = DynamicDataLoader.getDataClassFromDataType(type);
                } catch {
                    dataClass = null;
                }

                if (!dataClass) {
                    unknownTypes.add(type);
                    issues.push({
                        kind: 'unknown_data_type',
                        location: 'streams',
                        path: `${pathPrefix}.${type}`,
                        type,
                        reason: 'Removed unknown stream data type from map payload'
                    });
                    delete sanitizedStreams[type];
                }
            });
            return sanitizedStreams;
        }

        return streams;
    }

    private static sanitizeEvents(events: any, unknownTypes: Set<string>, issues: EventJSONSanitizerIssue[], pathPrefix: string): any[] {
        if (!Array.isArray(events)) {
            issues.push({
                kind: 'invalid_event_shape',
                location: 'events',
                path: pathPrefix,
                reason: 'Expected events to be an array'
            });
            return [];
        }

        return events.reduce((sanitizedEvents: any[], rawEvent: any, eventIndex: number) => {
            const eventPath = `${pathPrefix}[${eventIndex}]`;
            const normalizedEvent = EventJSONSanitizer.normalizeActivityEvent(rawEvent);
            if (!normalizedEvent) {
                const unknownType = EventJSONSanitizer.getUnknownEventType(rawEvent);
                if (unknownType) {
                    unknownTypes.add(unknownType);
                }
                issues.push({
                    kind: 'invalid_event_shape',
                    location: 'events',
                    path: eventPath,
                    type: unknownType || undefined,
                    reason: 'Removed event with unsupported shape'
                });
                return sanitizedEvents;
            }

            const eventType = Object.keys(normalizedEvent)[0];
            const eventPayload = normalizedEvent[eventType];
            let dataClass;
            try {
                dataClass = DynamicDataLoader.getDataClassFromDataType(eventType);
            } catch {
                dataClass = null;
            }

            if (!dataClass) {
                unknownTypes.add(eventType);
                issues.push({
                    kind: 'unknown_data_type',
                    location: 'events',
                    path: `${eventPath}.${eventType}`,
                    type: eventType,
                    reason: 'Removed event with unknown data type'
                });
                return sanitizedEvents;
            }

            try {
                // Validate using the same call path as the JSON importer.
                // This drops malformed payloads for otherwise-known event types.
                DynamicDataLoader.getDataInstanceFromDataType(eventType, eventPayload);
            } catch {
                issues.push({
                    kind: 'malformed_event_payload',
                    location: 'events',
                    path: `${eventPath}.${eventType}`,
                    type: eventType,
                    reason: 'Removed event with malformed payload'
                });
                return sanitizedEvents;
            }

            sanitizedEvents.push(normalizedEvent);
            return sanitizedEvents;
        }, []);
    }

    private static normalizeActivityEvent(rawEvent: any): any | null {
        if (!rawEvent || typeof rawEvent !== 'object' || Array.isArray(rawEvent)) {
            return null;
        }

        // Generic legacy shape:
        // { type: "KnownType", data: { ... } } -> { "KnownType": { ... } }
        if (typeof rawEvent.type === 'string' && rawEvent.data !== undefined) {
            return { [rawEvent.type]: rawEvent.data };
        }

        // Alternate generic shape:
        // { dataType: "KnownType", payload: { ... } } -> { "KnownType": { ... } }
        if (typeof rawEvent.dataType === 'string' && rawEvent.payload !== undefined) {
            return { [rawEvent.dataType]: rawEvent.payload };
        }

        const keys = Object.keys(rawEvent);
        if (!keys.length) {
            return null;
        }

        if (keys.length === 1) {
            return rawEvent;
        }

        // Defensive normalization: keep only the first recognized data type key.
        const validTypeKey = keys.find(type => {
            try {
                return !!DynamicDataLoader.getDataClassFromDataType(type);
            } catch {
                return false;
            }
        });

        if (!validTypeKey) {
            return null;
        }

        return { [validTypeKey]: rawEvent[validTypeKey] };
    }

    private static getUnknownEventType(rawEvent: any): string | null {
        if (!rawEvent || typeof rawEvent !== 'object' || Array.isArray(rawEvent)) {
            return null;
        }
        const keys = Object.keys(rawEvent);
        if (!keys.length) {
            return null;
        }
        const nonMetadataKey = keys.find(key => !EventJSONSanitizer.EVENT_METADATA_KEYS.has(key));
        return nonMetadataKey ?? keys[0];
    }
}
