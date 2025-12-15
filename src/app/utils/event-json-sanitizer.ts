
import { DynamicDataLoader } from '@sports-alliance/sports-lib';

export class EventJSONSanitizer {

    /**
     * Sanitizes the Event JSON by removing any data types that are not registered in the DynamicDataLoader.
     * Returns the sanitized JSON and a list of unknown types that were removed.
     */
    static sanitize(json: any): { sanitizedJson: any, unknownTypes: string[] } {
        const unknownTypes: Set<string> = new Set();

        if (!json) {
            return { sanitizedJson: json, unknownTypes: [] };
        }

        const sanitizedJson = { ...json }; // Shallow copy to start

        // 1. Sanitize Event Stats
        if (sanitizedJson.stats) {
            sanitizedJson.stats = EventJSONSanitizer.sanitizeStats(sanitizedJson.stats, unknownTypes);
        }

        // 2. Sanitize Activities
        if (sanitizedJson.activities && Array.isArray(sanitizedJson.activities)) {
            sanitizedJson.activities = sanitizedJson.activities.map(activity => {
                const sanitizedActivity = { ...activity };

                // Sanitize Activity Stats
                if (sanitizedActivity.stats) {
                    sanitizedActivity.stats = EventJSONSanitizer.sanitizeStats(sanitizedActivity.stats, unknownTypes);
                }

                // Sanitize Activity Streams
                if (sanitizedActivity.streams) {
                    sanitizedActivity.streams = EventJSONSanitizer.sanitizeStreams(sanitizedActivity.streams, unknownTypes);
                }

                return sanitizedActivity;
            });
        }

        return { sanitizedJson, unknownTypes: Array.from(unknownTypes) };
    }

    private static sanitizeStats(stats: any, unknownTypes: Set<string>): any {
        const sanitizedStats = { ...stats };
        Object.keys(sanitizedStats).forEach(type => {
            // DynamicDataLoader.getDataClassFromDataType returns the class constructor if found, or undefined/null if not.
            // Depending on library version it might throw or return null. 
            // Based on previous error "Class type ... is not in the store", it likely throws or returns undefined. 
            // We will safeguard this check.
            let dataClass;
            try {
                dataClass = DynamicDataLoader.getDataClassFromDataType(type);
            } catch (e) {
                dataClass = null;
            }

            if (!dataClass) {
                unknownTypes.add(type);
                delete sanitizedStats[type];
            }
        });
        return sanitizedStats;
    }

    private static sanitizeStreams(streams: any, unknownTypes: Set<string>): any {
        // Streams can be an array of objects (StreamJSONInterface[]) or an object map { [type]: values }

        if (Array.isArray(streams)) {
            // It's an array of StreamJSONInterface
            return streams.filter(stream => {
                const type = stream.type;
                let dataClass;
                try {
                    dataClass = DynamicDataLoader.getDataClassFromDataType(type);
                } catch (e) {
                    dataClass = null;
                }

                if (!dataClass) {
                    unknownTypes.add(type);
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
                } catch (e) {
                    dataClass = null;
                }

                if (!dataClass) {
                    unknownTypes.add(type);
                    delete sanitizedStreams[type];
                }
            });
            return sanitizedStreams;
        }

        return streams;
    }
}
