const COROS_SIGNED_INT64_PATTERN = /^\d{1,19}$/;
const COROS_SIGNED_INT64_MAX = 9_223_372_036_854_775_807n;

/** Normalizes a non-negative COROS signed-64-bit identifier without precision loss. */
export function normalizeCOROSInt64Identifier(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
    return null;
  }
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) {
    return null;
  }
  const normalized = `${value}`.trim();
  if (!COROS_SIGNED_INT64_PATTERN.test(normalized)) return null;
  try {
    const identifier = BigInt(normalized);
    return identifier <= COROS_SIGNED_INT64_MAX ? identifier.toString() : null;
  } catch {
    return null;
  }
}
