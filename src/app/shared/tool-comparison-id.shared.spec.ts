import { describe, expect, it } from 'vitest';

import {
  buildToolComparisonContentHashParts,
  buildToolComparisonEventIDHashParts,
  getToolComparisonBaseExtension,
  normalizeToolComparisonEventIDHint,
} from '@shared/tool-comparison-id';

describe('tool comparison id shared helpers', () => {
  it('normalizes supported base extensions and gzip suffixes', () => {
    expect(getToolComparisonBaseExtension('FIT')).toBe('fit');
    expect(getToolComparisonBaseExtension(' gpx.gz ')).toBe('gpx');
  });

  it('accepts only canonical 64-character hex event id hints', () => {
    const eventID = 'A'.repeat(64);

    expect(normalizeToolComparisonEventIDHint(` ${eventID} `)).toBe(eventID.toLowerCase());
    expect(normalizeToolComparisonEventIDHint('a'.repeat(63))).toBeNull();
    expect(normalizeToolComparisonEventIDHint('g'.repeat(64))).toBeNull();
    expect(normalizeToolComparisonEventIDHint()).toBeNull();
  });

  it('builds stable content and event hash parts', () => {
    expect(buildToolComparisonContentHashParts('TCX.GZ', 'payload')).toEqual(['tcx', ':', 'payload']);
    expect(buildToolComparisonEventIDHashParts('user-1', ['hash-b', 'hash-a'])).toEqual([
      'benchmark-comparison',
      ':',
      'user-1',
      ':',
      'hash-a',
      ':',
      'hash-b',
    ]);
  });
});
