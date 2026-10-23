import { ServiceNames } from '@sports-alliance/sports-lib';

const identityFields: Record<string, readonly string[]> = {
  [ServiceNames.SuuntoApp]: ['serviceUserName', 'serviceWorkoutID'],
  [ServiceNames.COROSAPI]: ['serviceOpenId', 'serviceWorkoutID'],
  [ServiceNames.GarminAPI]: ['serviceUserID', 'serviceActivityFileID', 'serviceActivityFileType'],
  [ServiceNames.WahooAPI]: ['serviceUserID', 'serviceWorkoutID'],
};
const part = (value: unknown): string | null => (typeof value === 'string' || typeof value === 'number')
  && `${value}`.trim() ? `${value}`.trim() : null;

/** Only persisted owner/account/provider identities authorize a recording revision. */
export function isSameProviderRecording(saved: Record<string, unknown> | undefined, incoming: Record<string, unknown>): boolean {
  const service = part(incoming.serviceName);
  const fields = service && Object.prototype.hasOwnProperty.call(identityFields, service) ? identityFields[service] : undefined;
  if (!saved || !fields || part(saved.serviceName) !== service) return false;
  if (!fields.every(field => part(saved[field]) !== null && part(saved[field]) === part(incoming[field]))) return false;
  if (service === ServiceNames.COROSAPI) {
    // Multipart workout exports must never borrow another component's activity IDs.
    for (const field of ['serviceWorkoutComponentKey', 'serviceWorkoutComponentIndex']) {
      if ((part(saved[field]) !== null || part(incoming[field]) !== null) && part(saved[field]) !== part(incoming[field])) return false;
    }
  }
  return true;
}

export function providerRecordingService(metadata: Record<string, unknown>): string | null {
  const service = part(metadata.serviceName);
  return service && Object.prototype.hasOwnProperty.call(identityFields, service) ? service : null;
}
