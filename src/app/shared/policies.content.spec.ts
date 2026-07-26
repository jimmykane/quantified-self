import { describe, expect, it } from 'vitest';
import {
  CONNECTED_SERVICES_POLICY_SECTION,
  POLICIES_GARMIN_DATA_FRAGMENT,
  POLICIES_MCP_CLIENTS_FRAGMENT,
  POLICIES_SUUNTO_DATA_FRAGMENT,
  POLICIES_WAHOO_DATA_FRAGMENT,
} from './policies.content';

describe('Wahoo connected-service policy', () => {
  it('documents collection, server-only credentials, disconnect retention, and explicit Wahoo delivery flows', () => {
    const topic = CONNECTED_SERVICES_POLICY_SECTION.topics.find(candidate => candidate.id === POLICIES_WAHOO_DATA_FRAGMENT);
    const content = topic?.content.join(' ') || '';

    expect(topic?.title).toBe('Wahoo Data');
    expect(content).toContain('Only workouts with an available FIT file are imported');
    expect(content).toContain('OAuth credentials are stored server-side');
    expect(content).toContain('Activities already imported into Quantified Self are retained');
    expect(content).toContain('send a selected FIT activity file or GPX/FIT course/route file directly to Wahoo');
    expect(content).toContain('converts selected GPX routes to FIT in memory');
    expect(content).toContain('automatic/backfill delivery of Suunto routes already saved in Quantified Self');
    expect(content).toContain('updated saved route updates the same Wahoo route');
    expect(content).toContain('Garmin, COROS, or Suunto activities');
    expect(content).toContain('does not create or retain a Quantified Self activity');
    expect(content).toContain('Wahoo-to-Suunto activity sync');
  });
});

describe('MCP client access policy', () => {
  it('documents scope, redaction, credential, revocation, and recipient-retention boundaries', () => {
    const topic = CONNECTED_SERVICES_POLICY_SECTION.topics
      .find(candidate => candidate.id === POLICIES_MCP_CLIENTS_FRAGMENT);
    const content = topic?.content.join(' ') || '';

    expect(topic?.title).toBe('MCP Client Access');
    expect(content).toContain('one or more requested read-only permissions');
    expect(content).toContain('excludes precise latitude/longitude metrics');
    expect(content).toContain('up to 25 explicitly selected canonical numeric Sports Lib metrics');
    expect(content).toContain('Together with Activity and Training metric access');
    expect(content).toContain('unrequested stored stats are excluded');
    expect(content).toContain('imported device/provider source keys');
    expect(content).toContain('MTB jump measurements');
    expect(content).toContain('exact start and end latitude/longitude coordinates when available');
    expect(content).toContain('start or end is near a location');
    expect(content).toContain('exact latitude and longitude');
    expect(content).toContain('home, workplace, frequent trailhead');
    expect(content).toContain('stable account/event paths');
    expect(content).toContain('stable account/route paths');
    expect(content).toContain('simplified polyline preview geometry');
    expect(content).toContain('segment start/end coordinates');
    expect(content).toContain('persisted preview passes near a location');
    expect(content).toContain('parsed waypoint coordinates');
    expect(content).toContain('only the location text to Mapbox for forward geocoding');
    expect(content).toContain('activity data, route data, account identifiers');
    expect(content).toContain('Original route files');
    expect(content).toContain('raw sleep-stage intervals');
    expect(content).toContain('stored server-side only as hashes');
    expect(content).toContain('becomes active and appears in Settings only after');
    expect(content).toContain('Abandoned pending approvals expire automatically');
    expect(content).toContain('Settings -> Account');
    expect(content).toContain('retain data it already received');
  });
});

describe('Garmin and Suunto manual route delivery policy', () => {
  it('documents selected GPX/FIT route delivery and the destination conversion behavior', () => {
    const garminContent = CONNECTED_SERVICES_POLICY_SECTION.topics
      .find(candidate => candidate.id === POLICIES_GARMIN_DATA_FRAGMENT)?.content.join(' ') || '';
    const suuntoContent = CONNECTED_SERVICES_POLICY_SECTION.topics
      .find(candidate => candidate.id === POLICIES_SUUNTO_DATA_FRAGMENT)?.content.join(' ') || '';

    expect(garminContent).toContain('explicitly select a GPX/FIT route file in Garmin Services');
    expect(garminContent).toContain('does not create or retain a Quantified Self route or Garmin delivery metadata');
    expect(suuntoContent).toContain('saved or selected GPX/FIT route to Suunto');
    expect(suuntoContent).toContain('selected FIT routes and saved routes are converted to a compatible GPX route in memory');
    expect(suuntoContent).toContain('Direct selected-file route delivery does not create or retain a Quantified Self route');
  });
});
