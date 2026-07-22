import { describe, expect, it } from 'vitest';
import {
  CONNECTED_SERVICES_POLICY_SECTION,
  POLICIES_GARMIN_DATA_FRAGMENT,
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
