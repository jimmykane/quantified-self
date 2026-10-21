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
  beforeEach(() => {
    vi.clearAllMocks(); auth.currentUser = { uid: 'owner' }; call.mockResolvedValue({ data: {} });
    TestBed.configureTestingModule({ providers: [
      ActivityAscentService, { provide: Auth, useValue: auth }, { provide: Firestore, useValue: {} },
      { provide: AppFunctionsService, useValue: { call } },
    ] });
  });
  it.each([0, 75, null])('sends only the owner-bound current-state correction contract for %s', async ascent => {
    await TestBed.inject(ActivityAscentService).save('owner', 'event', row, ascent);
    expect(call).toHaveBeenCalledWith('reprocessEvent', { eventId: 'event', mode: 'correct_ascent', expectedOwner: 'owner',
      edit: { activityId: 'leg', ascent, expectedSourceFingerprint: row.fingerprint, expectedCorrection: null } });
  });
  it('rejects a changed owner before calling the backend', async () => {
    auth.currentUser = { uid: 'other' };
    await expect(TestBed.inject(ActivityAscentService).save('owner', 'event', row, 75)).rejects.toThrow('owner');
    expect(call).not.toHaveBeenCalled();
  });
});
