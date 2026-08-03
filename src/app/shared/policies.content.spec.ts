import { describe, expect, it } from 'vitest';
import {
  CONNECTED_SERVICES_POLICY_SECTION,
  POLICY_CONTENT,
  POLICIES_AI_AND_PROCESSORS_FRAGMENT,
  POLICIES_GARMIN_DATA_FRAGMENT,
  POLICIES_MCP_CLIENTS_FRAGMENT,
  POLICIES_SUUNTO_DATA_FRAGMENT,
  POLICIES_WAHOO_DATA_FRAGMENT,
} from './policies.content';
import { REQUIRED_POLICY_CONSENT_FORM_CONTROL_NAMES } from './policy-consent-fields';

describe('Policy consent fields', () => {
  it('keeps the lightweight required-consent registry aligned with visible policy controls', () => {
    const requiredPolicyControls = POLICY_CONTENT
      .filter(policy => !!policy.checkboxLabel && !policy.isOptional)
      .map(policy => policy.formControlName);

    expect(requiredPolicyControls).toEqual([...REQUIRED_POLICY_CONSENT_FORM_CONTROL_NAMES]);
  });
});

describe('Built-in Assistant policy', () => {
  it('documents the bounded MCP-backed Gemini context, exclusions, and retention', () => {
    const topic = CONNECTED_SERVICES_POLICY_SECTION.topics
      .find(candidate => candidate.id === POLICIES_AI_AND_PROCESSORS_FRAGMENT);
    const content = topic?.content.join(' ') || '';

    expect(CONNECTED_SERVICES_POLICY_SECTION.summary).toContain('built-in Assistant');
    expect(content).toContain('latest six completed conversation turns');
    expect(content).toContain('bounded validated results from the non-location read-only tools');
    expect(content).toContain('exact locations');
    expect(content).toContain('server-owned active conversation becomes unavailable seven days after');
    expect(content).toContain('deleted asynchronously by Firestore TTL');
    expect(content).toContain('built-in Assistant has no location or saved-route tools');
  });
});

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
    expect(topic?.summary).toContain('body-measurement');
    expect(content).toContain('one or more requested read-only permissions');
    expect(content).toContain(
      'excludes precise latitude/longitude and first-class body-measurement metrics',
    );
    expect(content).toContain('up to 25 explicitly selected canonical numeric Sports Lib metrics');
    expect(content).toContain('Metric permission');
    expect(content).toContain('Body-measurement permission');
    expect(content).toContain('Activity locations depend on activity details');
    expect(content).toContain('bounded body-measurement history');
    expect(content).toContain('identity-free day, week, or month values');
    expect(content).toContain('range of at most 366 days');
    expect(content).toContain('exact source measurement timestamps');
    expect(content).toContain('provider/device metadata');
    expect(content).toContain('bounded chart-ready streams');
    expect(content).toContain('discover canonical Sports Lib activity types');
    expect(content).toContain('filter bounded newest-first scans');
    expect(content).toContain('explicit IANA timezone');
    expect(content).toContain('case-insensitive part of the route name');
    expect(content).toContain('does not create a reparse, backfill, cache');
    expect(content).toContain('imported device/provider source keys');
    expect(content).toContain('MTB jump measurements');
    expect(content).toContain('Activity-location permission');
    expect(content).toContain('exact activity start/end and MTB jump coordinates');
    expect(content).toContain('nearby-activity searches');
    expect(content).toContain('home, workplace, frequent trailhead');
    expect(content).toContain('Saved-route summary permission');
    expect(content).toContain('Saved-route location permission');
    expect(content).toContain('simplified polyline preview geometry');
    expect(content).toContain('segment endpoints');
    expect(content).toContain('nearby-route search');
    expect(content).toContain('waypoint coordinates');
    expect(content).toContain('Activity and saved-route location permissions are independent');
    expect(content).toContain('only the location text to Mapbox for forward geocoding');
    expect(content).toContain('activity data, route data, account identifiers');
    expect(content).toContain('Original files');
    expect(content).toContain('full-resolution recordings');
    expect(content).toContain('raw sleep-stage intervals');
    expect(content).toContain('one-call sleep trend');
    expect(content).toContain('preferred daily report');
    expect(content).toContain('latest completed non-nap sleep');
    expect(content).toContain('average/overnight HRV');
    expect(content).toContain('average/minimum sleep heart rate');
    expect(content).toContain('current-versus-usual equivalent 28-day Training totals');
    expect(content).toContain('same live UTC-day Readiness used by Dashboard Today');
    expect(content).toContain('same-provider baseline medians');
    expect(content).toContain('missing or insufficient-baseline states');
    expect(content).toContain('does not change the UTC scoring boundary');
    expect(content).toContain('workout plans, and medical advice');
    expect(content).toContain('stored server-side only as hashes');
    expect(content).toContain('becomes active and appears in Connections only after');
    expect(content).toContain('same exact verified client identity');
    expect(content).toContain('leaves its current grant usable');
    expect(content).toContain('rather than creating another logical connection');
    expect(content).toContain('Failed or abandoned reauthorization does not replace');
    expect(content).toContain('Connections -> MCP');
    expect(content).toContain('standard server-to-server token-revocation endpoint');
    expect(content).toContain('Disconnect in Connections remains the authoritative control');
    expect(content).toContain('any older duplicate records');
    expect(content).toContain('without affecting other MCP clients');
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
