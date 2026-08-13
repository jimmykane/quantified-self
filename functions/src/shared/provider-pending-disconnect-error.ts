import { ServiceNames } from '@sports-alliance/sports-lib';
import { HttpsError } from 'firebase-functions/v2/https';

/**
 * Callable-safe disconnect error that retains the canonical lifecycle name
 * consumed by queue workers.
 */
export class ProviderPendingDisconnectError extends HttpsError {
  public override readonly name = 'TokenUseSkippedForPendingDisconnectError';

  constructor(
    public readonly userID: string,
    public readonly serviceName: ServiceNames,
    public readonly phase: string,
  ) {
    const providerName = serviceName === ServiceNames.SuuntoApp
      ? 'Suunto'
      : serviceName === ServiceNames.WahooAPI
        ? 'Wahoo'
        : serviceName === ServiceNames.COROSAPI
          ? 'COROS'
        : `${serviceName}`;
    super('failed-precondition', `${providerName} disconnect is pending.`);
  }
}
