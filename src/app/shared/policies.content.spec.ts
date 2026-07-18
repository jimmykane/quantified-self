import { describe, expect, it } from 'vitest';
import {
  CONNECTED_SERVICES_POLICY_SECTION,
  POLICIES_WAHOO_DATA_FRAGMENT,
} from './policies.content';

describe('Wahoo connected-service policy', () => {
  it('documents collection, server-only credentials, disconnect retention, and unsupported outbound flows', () => {
    const topic = CONNECTED_SERVICES_POLICY_SECTION.topics.find(candidate => candidate.id === POLICIES_WAHOO_DATA_FRAGMENT);
    const content = topic?.content.join(' ') || '';

    expect(topic?.title).toBe('Wahoo Data');
    expect(content).toContain('Only workouts with an available FIT file are imported');
    expect(content).toContain('OAuth credentials are stored server-side');
    expect(content).toContain('Activities already imported into Quantified Self are retained');
    expect(content).toContain('does not upload workouts to Wahoo');
  });
});
