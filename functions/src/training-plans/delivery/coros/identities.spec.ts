import { describe, expect, it } from 'vitest';
import { corosIntegerCandidate } from './identities';

describe('COROS Training integer identities', () => {
  const digest = 'a'.repeat(64);

  it('is stable, positive, signed-32-bit and probe-sensitive', () => {
    const first = corosIntegerCandidate('workout', digest, 0);
    expect(first).toBe(corosIntegerCandidate('workout', digest, 0));
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(2_147_483_647);
    expect(corosIntegerCandidate('workout', digest, 1)).not.toBe(first);
    expect(corosIntegerCandidate('athlete', digest, 0)).not.toBe(first);
  });

  it.each([-1, 32, 1.5])('rejects invalid probe %s', probe => {
    expect(() => corosIntegerCandidate('workout', digest, probe)).toThrow();
  });
});
