import * as xmldom from 'xmldom';
import {
    EventImporterFIT,
    EventImporterGPX,
    EventImporterSuuntoJSON,
    EventImporterSuuntoSML,
    EventImporterTCX,
    EventInterface,
    ActivityParsingOptions,
} from '@sports-alliance/sports-lib';

import { createParsingOptions } from '../../../shared/parsing-options';

export interface JsonParserFailures {
    primary: unknown;
    fallback: unknown;
}

function toArrayBuffer(data: Buffer): ArrayBuffer {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

function decodeText(data: Buffer): string {
    return new TextDecoder().decode(toArrayBuffer(data));
}

export function getActivityFileBaseExtension(extensionOrPath: string): string {
    const lower = extensionOrPath.toLowerCase();
    const withoutGz = lower.endsWith('.gz') ? lower.slice(0, -3) : lower;
    const parts = withoutGz.split('.');
    return parts.pop() || '';
}

export async function parseActivityFilePayload(
    payload: Buffer,
    extensionOrPath: string,
    options: ActivityParsingOptions = createParsingOptions(),
    onJsonParsersFailed?: (failures: JsonParserFailures) => void,
): Promise<EventInterface> {
    const baseExtension = getActivityFileBaseExtension(extensionOrPath);

    if (baseExtension === 'fit') {
        return EventImporterFIT.getFromArrayBuffer(toArrayBuffer(payload), options);
    }

    const text = decodeText(payload);
    if (baseExtension === 'gpx') {
        return EventImporterGPX.getFromString(text, xmldom.DOMParser, options);
    }
    if (baseExtension === 'tcx') {
        const xml = new xmldom.DOMParser().parseFromString(text, 'application/xml');
        return EventImporterTCX.getFromXML(xml, options);
    }
    if (baseExtension === 'json') {
        try {
            return await EventImporterSuuntoJSON.getFromJSONString(text, options);
        } catch (primaryError) {
            try {
                return await EventImporterSuuntoSML.getFromJSONString(text, options);
            } catch (fallbackError) {
                // Capture both attempts only on final failure; preserve the thrown error.
                onJsonParsersFailed?.({ primary: primaryError, fallback: fallbackError });
                throw fallbackError;
            }
        }
    }
    if (baseExtension === 'sml') {
        return EventImporterSuuntoSML.getFromXML(text, options);
    }

    throw new Error(`Unsupported original file extension: ${baseExtension}`);
}
