import { describe, expect, it } from 'vitest';
import { normalizeCOROSInt64Identifier } from './identifier';

describe('normalizeCOROSInt64Identifier', () => {
  it('accepts safe numbers and the signed 64-bit maximum as a string', () => {
    expect(normalizeCOROSInt64Identifier(42)).toBe('42');
    expect(normalizeCOROSInt64Identifier('00042')).toBe('42');
    expect(normalizeCOROSInt64Identifier('9223372036854775807')).toBe('9223372036854775807');
  });

  it('rejects precision-lost numbers and values outside the provider type', () => {
    expect(normalizeCOROSInt64Identifier(Number('9223372036854775807'))).toBeNull();
    expect(normalizeCOROSInt64Identifier('9223372036854775808')).toBeNull();
    expect(normalizeCOROSInt64Identifier('-1')).toBeNull();
    expect(normalizeCOROSInt64Identifier('not-an-id')).toBeNull();
  });
});
