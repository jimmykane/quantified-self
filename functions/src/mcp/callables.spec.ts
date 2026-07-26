import { describe, expect, it } from 'vitest';
import { parseMcpAuthorizationDecision } from './callables';

describe('MCP callable input validation', () => {
  it('preserves a valid authorization decision', () => {
    expect(parseMcpAuthorizationDecision({
      approved: true,
      grantedScopes: ['metrics:read', 'sleep:read'],
    })).toEqual({
      approved: true,
      grantedScopes: ['metrics:read', 'sleep:read'],
    });
  });

  it.each([
    {},
    { approved: 'true' },
    { approved: 1 },
  ])('rejects an ambiguous approval value', (input) => {
    expect(() => parseMcpAuthorizationDecision(input)).toThrowError(
      expect.objectContaining({ code: 'invalid-argument' }),
    );
  });

  it.each([
    { approved: true, grantedScopes: 'metrics:read' },
    { approved: true, grantedScopes: ['metrics:read', 1] },
  ])('rejects malformed granted scopes', (input) => {
    expect(() => parseMcpAuthorizationDecision(input)).toThrowError(
      expect.objectContaining({ code: 'invalid-argument' }),
    );
  });
});
