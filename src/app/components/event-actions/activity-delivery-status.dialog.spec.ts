import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { AppHapticsService } from '../../services/app.haptics.service';
import { Auth, user } from 'app/firebase/auth';
import { Firestore, collection, getDocsFromServer, where } from 'app/firebase/firestore';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ActivityDeliveryStatusDialog } from './activity-delivery-status.dialog';

vi.mock('app/firebase/auth', () => ({ Auth: class {}, user: vi.fn() }));
vi.mock('app/firebase/firestore', () => ({
  Firestore: class {}, collection: vi.fn(), documentId: () => 'documentId', query: vi.fn(), where: vi.fn(), getDocsFromServer: vi.fn(),
}));

describe('ActivityDeliveryStatusDialog', () => {
  it('shows confirmed and empty server results, supports refresh and hides results after an account change', async () => {
    const account = new BehaviorSubject({ uid: 'owner' });
    vi.mocked(user).mockReturnValue(account.asObservable() as ReturnType<typeof user>);
    const routeId = 'activitySync_GarminAPI_to_SuuntoApp';
    type Snapshot = Awaited<ReturnType<typeof getDocsFromServer>>;
    vi.mocked(getDocsFromServer)
      .mockResolvedValueOnce({ docs: [{ id: routeId, data: () => ({ status: 'success' }) }] } as unknown as Snapshot)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ docs: [] } as unknown as Snapshot)
      .mockResolvedValueOnce({ docs: [{
        id: 'activitySync_GarminAPI_to_WahooAPI',
        data: () => ({ status: 'skipped', skippedReason: 'destination_write_scope_missing' }),
      }] } as unknown as Snapshot);
    const haptics = { selection: vi.fn() };
    TestBed.configureTestingModule({
      imports: [ActivityDeliveryStatusDialog],
      providers: [provideRouter([]), { provide: AppHapticsService, useValue: haptics },
        { provide: Auth, useValue: {} }, { provide: Firestore, useValue: {} },
        { provide: MAT_DIALOG_DATA, useValue: { owner: 'owner', id: 'recording' } },
      ],
    });
    const fixture = TestBed.createComponent(ActivityDeliveryStatusDialog);
    const content = () => fixture.nativeElement.textContent;
    fixture.detectChanges();
    expect(content()).toContain('Checking delivery');
    expect(haptics.selection).not.toHaveBeenCalled();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(content()).toContain('Garmin → Suunto');
    expect(content()).toContain('Delivered');
    expect(collection).toHaveBeenCalledWith(expect.anything(), 'users', 'owner', 'events', 'recording', 'metaData');
    expect(where).toHaveBeenCalledWith('documentId', 'in', expect.arrayContaining([routeId]));
    const refresh = fixture.nativeElement.querySelector('button');
    refresh.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(content()).toContain('Delivery status is unavailable');
    refresh.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(content()).toContain('No activity delivery has been recorded');
    refresh.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(content()).toContain('Check destination connection');
    expect(fixture.nativeElement.querySelector('a').getAttribute('href')).toBe('/services?setup=sync');
    account.next({ uid: 'different-owner' });
    fixture.detectChanges();
    expect(content()).toContain('Sign in as the workout owner');
    expect(refresh.disabled).toBe(true);
    refresh.click();
    expect(haptics.selection).toHaveBeenCalledTimes(3);
    expect(getDocsFromServer).toHaveBeenCalledTimes(4);
  });
});
