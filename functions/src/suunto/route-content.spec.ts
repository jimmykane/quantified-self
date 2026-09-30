import { describe, expect, it } from 'vitest';
import { hasSameSuuntoRouteContent } from './route-content';

function createGPX(modified: string, revision = modified): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" creator="Suunto app" version="1.1">
  <metadata><name>Example route</name><extensions>
    <route xmlns="http://www.suunto.com/xmlschemas/RouteExtension/v1">
      <id>provider-route-1</id><modified>${modified}</modified><revision>${revision}</revision>
      <activityId>1</activityId><turnWaypointsEnabled>false</turnWaypointsEnabled>
    </route>
  </extensions></metadata>
  <wpt lat="0" lon="0"><name>Start</name></wpt>
  <rte><name>Example route</name><desc>Route description</desc>
    <rtept lat="0" lon="0"><ele>10</ele></rtept>
    <rtept lat="0.01" lon="0.01"><ele>20</ele></rtept>
  </rte>
</gpx>`;
}

function compare(stored: string, incoming: string): boolean {
    return hasSameSuuntoRouteContent(Buffer.from(stored), Buffer.from(incoming));
}

describe('hasSameSuuntoRouteContent', () => {
    it('preserves the exact-byte shortcut for existing originals', () => {
        expect(compare('<gpx />', '<gpx />')).toBe(true);
    });

    it.each([
        ['2000', '1000'],
        ['1000', '2000'],
        ['2000', '2000'],
        ['9007199254740993', '9007199254740995'],
    ])('ignores only Suunto modified=%s and revision=%s changes', (modified, revision) => {
        expect(compare(createGPX('1000'), createGPX(modified, revision))).toBe(true);
    });

    it('recognizes namespace prefixes at the same metadata path', () => {
        const prefixed = (content: string) => content
            .replace('<route xmlns=', '<s:route xmlns:s=')
            .replace('</route>', '</s:route>')
            .replace(/<(\/?)(id|modified|revision|activityId|turnWaypointsEnabled)>/g, '<$1s:$2>');
        expect(compare(prefixed(createGPX('1000')), prefixed(createGPX('2000')))).toBe(true);
    });

    it.each([
        ['coordinates', 'lat="0.01"', 'lat="0.02"'],
        ['elevation', '<ele>20</ele>', '<ele>25</ele>'],
        ['waypoint', '<name>Start</name>', '<name>Water</name>'],
        ['name', '<name>Example route</name>', '<name>Renamed route</name>'],
        ['description', '<desc>Route description</desc>', '<desc>New description</desc>'],
        ['sport', '<activityId>1</activityId>', '<activityId>2</activityId>'],
        ['navigation', '<turnWaypointsEnabled>false</turnWaypointsEnabled>', '<turnWaypointsEnabled>true</turnWaypointsEnabled>'],
        ['provider identity', '<id>provider-route-1</id>', '<id>provider-route-2</id>'],
        ['revision attributes', '<revision>2000</revision>', '<revision source="other">2000</revision>'],
        ['nested revision data', '<revision>2000</revision>', '<revision><value>2000</value></revision>'],
    ])('detects %s edits alongside timestamp changes', (_name, before, after) => {
        expect(compare(createGPX('1000'), createGPX('2000').replace(before, after))).toBe(false);
    });

    it('does not ignore another provider namespace with the same field names', () => {
        const otherProvider = (content: string) => content.replace(
            'http://www.suunto.com/xmlschemas/RouteExtension/v1', 'https://example.com/route',
        );
        expect(compare(otherProvider(createGPX('1000')), otherProvider(createGPX('2000')))).toBe(false);
    });

    it('does not ignore similarly named Suunto extensions outside metadata', () => {
        const outsideMetadata = (content: string) => content
            .replace('<metadata><name>Example route</name><extensions>', '<rte><extensions>')
            .replace('</extensions></metadata>', '</extensions></rte>');
        expect(compare(outsideMetadata(createGPX('1000')), outsideMetadata(createGPX('2000')))).toBe(false);
    });

    it('preserves a modified field elsewhere in the GPX', () => {
        const addField = (content: string, value: string) => content.replace(
            '<rte><name>', `<rte><extensions><modified>${value}</modified></extensions><name>`,
        );
        expect(compare(addField(createGPX('1000'), '1000'), addField(createGPX('2000'), '2000'))).toBe(false);
    });

    it.each([
        (content: string) => content.replace('</gpx>', ''),
        (content: string) => content.replace('<gpx ', '<gpx duplicate="1" duplicate="2" '),
        (content: string) => content.replace('<gpx ', '<!DOCTYPE gpx [<!ENTITY value "hidden">]><gpx '),
        (content: string) => content.replace('<modified>2000</modified>', '<modified>unknown</modified>'),
    ])('does not suppress changed malformed or unrecognized content %#', transform => {
        expect(compare(createGPX('1000'), transform(createGPX('2000')))).toBe(false);
    });

    it('does not equate invalid UTF-8 byte sequences through replacement decoding', () => {
        const stored = Buffer.concat([Buffer.from(createGPX('1000')), Buffer.from([0xff])]);
        const incoming = Buffer.concat([Buffer.from(createGPX('2000')), Buffer.from([0xfe])]);
        expect(hasSameSuuntoRouteContent(stored, incoming)).toBe(false);
    });
});
