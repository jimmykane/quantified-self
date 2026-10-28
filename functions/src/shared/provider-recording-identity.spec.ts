import { describe, expect, it } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { isSameProviderRecording, providerRecordingService } from './provider-recording-identity';

describe('provider recording revision authorization', () => {
  it.each(['unknown', 'constructor', 'toString', '__proto__'])('rejects unregistered service names: %s', serviceName => {
    expect(providerRecordingService({ serviceName })).toBeNull();
    expect(isSameProviderRecording({ serviceName }, { serviceName })).toBe(false);
  });
  it.each([
    { serviceName: ServiceNames.SuuntoApp, serviceUserName: 'account', serviceWorkoutID: 'workout' },
    { serviceName: ServiceNames.COROSAPI, serviceOpenId: 'account', serviceWorkoutID: 'workout' },
    { serviceName: ServiceNames.GarminAPI, serviceUserID: 'account', serviceActivityFileID: 123, serviceActivityFileType: 'FIT' },
    { serviceName: ServiceNames.WahooAPI, serviceUserID: 'account', serviceWorkoutID: 123 },
  ])('requires exact persisted account and workout identifiers for $serviceName', metadata => {
    expect(isSameProviderRecording(metadata, { ...metadata, date: 999, serviceWorkoutSummaryID: 'new-summary' })).toBe(true);
    expect(isSameProviderRecording(undefined, metadata)).toBe(false);
    for (const field of Object.keys(metadata)) {
      expect(isSameProviderRecording(metadata, { ...metadata, [field]: 'another' })).toBe(false);
      expect(isSameProviderRecording(metadata, { ...metadata, [field]: '' })).toBe(false);
    }
  });
  it('never treats different COROS multipart components as the same recording', () => {
    const first = { serviceName: ServiceNames.COROSAPI, serviceOpenId: 'account', serviceWorkoutID: 'workout',
      serviceWorkoutComponentKey: 'part-1', serviceWorkoutComponentIndex: 0 };
    expect(isSameProviderRecording(first, first)).toBe(true);
    expect(isSameProviderRecording(first, { ...first, serviceWorkoutComponentKey: 'part-2' })).toBe(false);
    expect(isSameProviderRecording(first, { ...first, serviceWorkoutComponentIndex: 1 })).toBe(false);
  });
});
