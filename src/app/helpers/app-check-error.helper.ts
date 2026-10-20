const APP_CHECK_CODES = [
  'already-initialized', 'use-before-activation', 'fetch-network-error', 'fetch-parse-error',
  'fetch-status-error', 'storage-open', 'storage-get', 'storage-set', 'recaptcha-error',
  'initial-throttle', 'throttled',
] as const;

export interface AppCheckFailureDetails {
  code: `appCheck/${typeof APP_CHECK_CODES[number] | 'unknown'}`;
  httpStatus: number | null;
  retryAfterSeconds: number | null;
  cooldown: boolean;
  retryable: boolean;
}

// Read only bounded SDK fields. Never copy a message, stack, token or arbitrary customData.
export function appCheckFailureDetails(error: unknown): AppCheckFailureDetails | null {
  const value = error && typeof error === 'object'
    ? error as { code?: unknown; customData?: { httpStatus?: unknown; time?: unknown } } : null;
  if (typeof value?.code !== 'string' || !value.code.startsWith('appCheck/')) return null;
  const knownCode = APP_CHECK_CODES.find(code => `appCheck/${code}` === value.code) ?? 'unknown';
  const status = value.customData?.httpStatus;
  const numericStatus = typeof status === 'number' ? status
    : typeof status === 'string' && /^\d{3}$/.test(status) ? Number(status) : null;
  const httpStatus = Number.isInteger(numericStatus) && numericStatus >= 400 && numericStatus <= 599
    ? numericStatus : null;
  const cooldown = knownCode === 'initial-throttle' || knownCode === 'throttled';
  const retryAfterSeconds = cooldown ? retryDurationSeconds(value.customData?.time) : null;
  const temporaryStatus = httpStatus === 408 || httpStatus === 429 || httpStatus >= 500;
  return {
    code: `appCheck/${knownCode}`,
    httpStatus,
    retryAfterSeconds,
    cooldown,
    retryable: knownCode === 'fetch-network-error'
      || (knownCode === 'fetch-status-error'
        && (httpStatus === null || temporaryStatus))
      // The SDK also wraps temporary server failures in throttle errors. Permit
      // bounded recovery only when its remaining wait is known and short.
      || (cooldown && temporaryStatus && retryAfterSeconds !== null && retryAfterSeconds <= 10),
  };
}

// Firebase's public token observer omits refresh errors while a cached token is
// still usable. Its console output still contains this SDK-defined warning.
// Parse the exact initial-throttle grammar only; never forward the log itself.
export function initialAppCheckRejectionFromLog(message: unknown): AppCheckFailureDetails | null {
  if (typeof message !== 'string') return null;
  const match = /^AppCheck: (\d{3}) error\. Attempts allowed again after ((?:\d{2}d:)?(?:\d{2}h:)?\d{2}m:\d{2}s) \(appCheck\/initial-throttle\)\.$/.exec(message);
  if (!match) return null;
  const details = appCheckFailureDetails({
    code: 'appCheck/initial-throttle', customData: { httpStatus: match[1], time: match[2] },
  });
  return details?.httpStatus !== null && details?.retryAfterSeconds !== null ? details : null;
}

function retryDurationSeconds(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(?:(\d{2})d:)?(?:(\d{2})h:)?(\d{2})m:(\d{2})s$/.exec(value);
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match.map(Number);
  if ((hours || 0) >= 24 || minutes >= 60 || seconds >= 60) return null;
  const duration = (days || 0) * 86400 + (hours || 0) * 3600 + minutes * 60 + seconds;
  return duration <= 86400 ? duration : null;
}
