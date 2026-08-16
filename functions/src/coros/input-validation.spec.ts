import { describe, expect, it } from 'vitest';
import { containsASCIIControlCharacter } from './input-validation';

describe('containsASCIIControlCharacter', () => {
  it('detects ASCII controls without rejecting normal Unicode text', () => {
    expect(containsASCIIControlCharacter('COROS PACE 3')).toBe(false);
    expect(containsASCIIControlCharacter('Ρολόι COROS')).toBe(false);
    expect(containsASCIIControlCharacter('line\nbreak')).toBe(true);
    expect(containsASCIIControlCharacter(`delete${String.fromCodePoint(0x7f)}`)).toBe(true);
  });
});
