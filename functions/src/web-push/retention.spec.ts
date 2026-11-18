import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { notificationExpiry, trainingIssueExpiry, trainingResultExpiry } from './retention';

describe('notification retention policy', () => {
  it('configures real TTL on both parent state and issue descendants', () => {
    const config = JSON.parse(readFileSync(resolve(__dirname, '../../../firestore.indexes.json'), 'utf8'));
    for (const group of ['pushState', 'issues']) expect(config.fieldOverrides).toContainEqual({ collectionGroup: group, fieldPath: 'expireAt', ttl: true, indexes: [] });
  });
  it('retains suppression beyond the manual 30-day replay window, while Training tracking expires in two days', () => {
    const now = Date.UTC(2026, 10, 18);
    expect(notificationExpiry(now).getTime()).toBeGreaterThan(now + 30 * 86400000);
    expect(trainingResultExpiry(now).getTime()).toBe(now + 2 * 86400000);
  });
  it('keeps an upcoming workout receipt through its scheduled date', () => {
    const now = Date.UTC(2026, 10, 18), future = trainingIssueExpiry(now, '2027-11-18');
    expect(future.getTime()).toBeGreaterThan(Date.UTC(2027, 10, 19));
    expect(trainingIssueExpiry(now, 'invalid').getTime()).toBeGreaterThan(now);
  });
});
