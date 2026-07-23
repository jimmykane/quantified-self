export class WahooRequestTimeoutError extends Error {
  constructor() {
    super('Wahoo request timed out.');
    this.name = 'WahooRequestTimeoutError';
  }
}

export async function withWahooRequestTimeout<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) throw new WahooRequestTimeoutError();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
