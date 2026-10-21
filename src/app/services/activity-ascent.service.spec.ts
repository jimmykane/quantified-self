import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Auth } from '../firebase/auth';
import { Firestore } from '../firebase/firestore';
import { AppFunctionsService } from './app.functions.service';
import { ActivityAscentService, type ActivityAscentRow } from './activity-ascent.service';

describe('ActivityAscentService', () => {
  const call = vi.fn();
  const auth = { currentUser: { uid: 'owner' } as { uid: string } | null };
  const row: ActivityAscentRow = { id: 'leg', label: 'Hike', value: 100, fingerprint: 'a'.repeat(64), correction: null };
  const saved = { activityId: 'leg', metric: 'ascent', value: 75, eventValue: 275, correction: { value: 75, sourceValue: 100 } };
  beforeEach(() => {
    vi.clearAllMocks(); auth.currentUser = { uid: 'owner' }; call.mockResolvedValue({ data: { elevation: saved } });
    TestBed.configureTestingModule({ providers: [
      ActivityAscentService, { provide: Auth, useValue: auth }, { provide: Firestore, useValue: {} },
      { provide: AppFunctionsService, useValue: { call } },
    ] });
  });
  it.each([0, 75, null])('sends only the owner-bound current-state correction contract for %s', async ascent => {
    expect(await TestBed.inject(ActivityAscentService).save('owner', 'event', row, ascent)).toEqual(saved);
    expect(call).toHaveBeenCalledWith('reprocessEvent', { eventId: 'event', mode: 'correct_elevation', expectedOwner: 'owner',
      edit: { activityId: 'leg', metric: 'ascent', value: ascent, expectedSourceFingerprint: row.fingerprint, expectedCorrection: null } });
  });
  it('sends descent and its independent current correction without widening the write', async () => {
    const descent = { ...saved, metric: 'descent', value: 0 };
    call.mockResolvedValueOnce({ data: { elevation: descent } });
    expect(await TestBed.inject(ActivityAscentService).save('owner', 'event', row, 0, 'descent')).toEqual(descent);
    expect(call).toHaveBeenCalledWith('reprocessEvent', { eventId: 'event', mode: 'correct_elevation', expectedOwner: 'owner',
      edit: { activityId: 'leg', metric: 'descent', value: 0, expectedSourceFingerprint: row.fingerprint, expectedCorrection: null } });
  });
  it('rejects a changed owner before calling the backend', async () => {
    auth.currentUser = { uid: 'other' };
    await expect(TestBed.inject(ActivityAscentService).save('owner', 'event', row, 75)).rejects.toThrow('owner');
    expect(call).not.toHaveBeenCalled();
  });
});
