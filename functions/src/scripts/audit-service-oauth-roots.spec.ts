import { describe, expect, it } from 'vitest';
import { parseServiceOAuthRootAuditOptions } from './audit-service-oauth-roots';

describe('audit-service-oauth-roots options', () => {
  it('defaults to a bounded read-only audit for an explicit project', () => {
    expect(parseServiceOAuthRootAuditOptions(['--project=quantified-self-io'])).toEqual({
      projectId: 'quantified-self-io',
      pageSize: 100,
      maxRootsPerService: 2_000,
    });
  });

  it('accepts bounded page and scan limits', () => {
    expect(parseServiceOAuthRootAuditOptions([
      '--page-size=250',
      '--max-roots-per-service',
      '5000',
      '--project',
      'quantified-self-io',
    ])).toEqual({
      projectId: 'quantified-self-io',
      pageSize: 250,
      maxRootsPerService: 5_000,
    });
  });

  it('rejects write flags and unbounded values', () => {
    expect(() => parseServiceOAuthRootAuditOptions(['--execute']))
      .toThrow('read-only');
    expect(() => parseServiceOAuthRootAuditOptions(['--project=quantified-self-io', '--page-size=501']))
      .toThrow('--page-size must be between 1 and 500.');
    expect(() => parseServiceOAuthRootAuditOptions(['--project=quantified-self-io', '--max-roots-per-service=20001']))
      .toThrow('--max-roots-per-service must be between 1 and 20000.');
  });

  it('requires an explicit project and rejects unsupported arguments', () => {
    expect(() => parseServiceOAuthRootAuditOptions([])).toThrow('--project');
    expect(() => parseServiceOAuthRootAuditOptions([
      '--project=quantified-self-io',
      '--unknown=value',
    ])).toThrow('Unsupported argument');
  });

  it('rejects duplicate options and malformed numeric values', () => {
    expect(() => parseServiceOAuthRootAuditOptions([
      '--project=quantified-self-io',
      '--project',
      'different-project',
    ])).toThrow('Duplicate argument: --project');
    expect(() => parseServiceOAuthRootAuditOptions([
      '--project=quantified-self-io',
      '--page-size=',
    ])).toThrow('--page-size must be between 1 and 500.');
    expect(() => parseServiceOAuthRootAuditOptions([
      '--project=quantified-self-io',
      '--max-roots-per-service=100oops',
    ])).toThrow('--max-roots-per-service must be between 1 and 20000.');
  });
});
