import { describe, expect, it } from 'vitest';
import { parseServiceOAuthRootAuditOptions } from './audit-service-oauth-roots';

describe('audit-service-oauth-roots options', () => {
  it('defaults to a bounded read-only audit', () => {
    expect(parseServiceOAuthRootAuditOptions([])).toEqual({
      pageSize: 100,
      maxRootsPerService: 2_000,
    });
  });

  it('accepts bounded page and scan limits', () => {
    expect(parseServiceOAuthRootAuditOptions([
      '--page-size=250',
      '--max-roots-per-service',
      '5000',
    ])).toEqual({
      pageSize: 250,
      maxRootsPerService: 5_000,
    });
  });

  it('rejects write flags and unbounded values', () => {
    expect(() => parseServiceOAuthRootAuditOptions(['--execute']))
      .toThrow('read-only');
    expect(() => parseServiceOAuthRootAuditOptions(['--page-size=501']))
      .toThrow('--page-size must be between 1 and 500.');
    expect(() => parseServiceOAuthRootAuditOptions(['--max-roots-per-service=20001']))
      .toThrow('--max-roots-per-service must be between 1 and 20000.');
  });
});
