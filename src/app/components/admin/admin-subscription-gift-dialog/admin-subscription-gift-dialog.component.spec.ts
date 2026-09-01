import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreviewAdminSubscriptionGiftResponse } from '../../../../../shared/admin-subscription-gifts';
import { AdminService, AdminUser } from '../../../services/admin.service';
import { BrowserCompatibilityService } from '../../../services/browser.compatibility.service';
import { AdminSubscriptionGiftDialogComponent } from './admin-subscription-gift-dialog.component';

const user: AdminUser = {
    uid: 'user-1',
    email: 'runner@example.com',
    displayName: 'Runner One',
    customClaims: { stripeRole: 'pro' },
    metadata: { creationTime: '2025-01-01', lastSignInTime: '2026-08-01' },
    disabled: false,
    providerIds: ['password'],
    subscription: { status: 'active', cancel_at_period_end: true },
};

const preview: PreviewAdminSubscriptionGiftResponse = {
    uid: user.uid,
    subscriptionId: 'sub_123',
    role: 'pro',
    cadence: 'yearly',
    status: 'active',
    currentAccessEnd: '2026-09-30T00:00:00.000Z',
    proposedGiftedEnd: '2026-10-31T00:00:00.000Z',
    cancelAtPeriodEnd: true,
    previewVersion: 'pv1_abcdefghijklmnopqrstuvwxyz',
    recentHistory: [{
        operationId: 'history-1',
        months: 2,
        reason: 'Early supporter thank-you',
        actorUid: 'admin-1',
        status: 'succeeded',
        previousAccessEnd: '2026-07-31T00:00:00.000Z',
        newAccessEnd: '2026-09-30T00:00:00.000Z',
        notificationStatus: 'queued',
        createdAt: '2026-07-01T12:00:00.000Z',
    }],
};

describe('AdminSubscriptionGiftDialogComponent', () => {
    let fixture: ComponentFixture<AdminSubscriptionGiftDialogComponent>;
    let component: AdminSubscriptionGiftDialogComponent;
    let adminService: {
        previewSubscriptionGift: ReturnType<typeof vi.fn>;
        grantSubscriptionGift: ReturnType<typeof vi.fn>;
    };
    let dialogRef: { close: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        adminService = {
            previewSubscriptionGift: vi.fn(() => of(preview)),
            grantSubscriptionGift: vi.fn((request: { notifyUser: boolean }) => of({
                operationId: '123e4567-e89b-42d3-a456-426614174000',
                status: 'succeeded',
                previousAccessEnd: preview.currentAccessEnd,
                newAccessEnd: preview.proposedGiftedEnd,
                cancelAtPeriodEnd: true,
                notificationStatus: request.notifyUser ? 'queued' : 'not_requested',
            })),
        };
        dialogRef = { close: vi.fn() };

        await TestBed.configureTestingModule({
            imports: [AdminSubscriptionGiftDialogComponent, NoopAnimationsModule],
            providers: [
                { provide: AdminService, useValue: adminService },
                { provide: BrowserCompatibilityService, useValue: {
                    createRandomUUID: () => '123e4567-e89b-42d3-a456-426614174000',
                } },
                { provide: MAT_DIALOG_DATA, useValue: { user } },
                { provide: MatDialogRef, useValue: dialogRef },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(AdminSubscriptionGiftDialogComponent);
        component = fixture.componentInstance;
    });

    it('loads and renders an exact preview with recent audit history', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const text = (fixture.nativeElement as HTMLElement).textContent || '';
        expect(adminService.previewSubscriptionGift).toHaveBeenCalledWith({ uid: user.uid, months: 1 });
        expect(text).toContain('Runner One');
        expect(text).toContain('Will remain canceled');
        expect(text).toContain('Early supporter thank-you');
        expect(text).toContain('No charge or proration is created');
        expect(component.hasFreshPreview()).toBe(true);
    });

    it('keeps the preview stale and the grant action disabled while a new month preview loads', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        const pendingPreview = new Subject<PreviewAdminSubscriptionGiftResponse>();
        adminService.previewSubscriptionGift.mockReturnValueOnce(pendingPreview);

        component.onMonthsChange(3);

        expect(component.previewLoading()).toBe(true);
        expect(component.hasFreshPreview()).toBe(false);
        expect(component.canGrant()).toBe(false);
        expect(adminService.previewSubscriptionGift).toHaveBeenLastCalledWith({ uid: user.uid, months: 3 });
    });

    it('grants only with the current preview, required reason, and notification choice', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        component.reason.set('Community thank-you');
        component.notifyUser.set(false);

        await component.grant();

        expect(adminService.grantSubscriptionGift).toHaveBeenCalledWith({
            uid: user.uid,
            months: 1,
            reason: 'Community thank-you',
            notifyUser: false,
            operationId: '123e4567-e89b-42d3-a456-426614174000',
            previewVersion: preview.previewVersion,
        });
        expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({
            uid: user.uid,
            response: expect.objectContaining({ status: 'succeeded' }),
        }));
    });

    it('surfaces needs-review outcomes and allows only the same operation to reconcile', async () => {
        adminService.grantSubscriptionGift
            .mockReturnValueOnce(of({
                operationId: '123e4567-e89b-42d3-a456-426614174000',
                status: 'needs_review',
                previousAccessEnd: preview.currentAccessEnd,
                newAccessEnd: preview.proposedGiftedEnd,
                cancelAtPeriodEnd: true,
                notificationStatus: 'not_requested',
                message: 'Stripe outcome needs review.',
            }))
            .mockReturnValueOnce(of({
                operationId: '123e4567-e89b-42d3-a456-426614174000',
                status: 'succeeded',
                previousAccessEnd: preview.currentAccessEnd,
                newAccessEnd: preview.proposedGiftedEnd,
                cancelAtPeriodEnd: true,
                notificationStatus: 'delivered',
            }));
        fixture.detectChanges();
        await fixture.whenStable();
        component.reason.set('Community thank-you');

        await component.grant();
        const originalRequest = adminService.grantSubscriptionGift.mock.calls[0][0];

        expect(component.requiresReview()).toBe(true);
        expect(component.error()).toBe('Stripe outcome needs review.');
        expect(component.requestLockedForRetry()).toBe(true);
        expect(component.canGrant()).toBe(true);
        expect(dialogRef.close).not.toHaveBeenCalled();

        await component.grant();

        expect(adminService.grantSubscriptionGift.mock.calls[1][0]).toEqual(originalRequest);
        expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({
            response: expect.objectContaining({ status: 'succeeded' }),
        }));
    });

    it('restores a server-stored needs-review operation after the dialog is reopened', async () => {
        adminService.previewSubscriptionGift.mockReturnValueOnce(of({
            ...preview,
            resumableOperation: {
                operationId: '123e4567-e89b-42d3-a456-426614174099',
                months: 4,
                reason: 'Recovered service credit',
                notifyUser: false,
                previewVersion: 'pv1_recoveredabcdefghijklmnopqrst',
                role: 'pro',
                cadence: 'yearly',
                status: 'needs_review',
                previousAccessEnd: '2026-09-30T00:00:00.000Z',
                newAccessEnd: '2027-01-31T00:00:00.000Z',
                cancelAtPeriodEnd: true,
                notificationStatus: 'not_requested',
            },
        }));
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(component.months()).toBe(4);
        expect(component.reason()).toBe('Recovered service credit');
        expect(component.notifyUser()).toBe(false);
        expect(component.requiresReview()).toBe(true);
        expect(component.requestLockedForRetry()).toBe(true);
        expect(component.canGrant()).toBe(true);
        expect((fixture.nativeElement as HTMLElement).textContent).toContain('Operation to reconcile');
        expect((fixture.nativeElement as HTMLElement).textContent).toContain('Stored target end');

        await component.grant();

        expect(adminService.grantSubscriptionGift).toHaveBeenCalledWith({
            uid: user.uid,
            months: 4,
            reason: 'Recovered service credit',
            notifyUser: false,
            operationId: '123e4567-e89b-42d3-a456-426614174099',
            previewVersion: 'pv1_recoveredabcdefghijklmnopqrst',
        });
    });

    it('restores a successful gift with a queued notification after the dialog is reopened', async () => {
        adminService.previewSubscriptionGift.mockReturnValueOnce(of({
            ...preview,
            resumableOperation: {
                operationId: '123e4567-e89b-42d3-a456-426614174098',
                months: 2,
                reason: 'Thank-you for the detailed feedback',
                notifyUser: true,
                previewVersion: 'pv1_notificationabcdefghijklmnop',
                role: 'pro',
                cadence: 'yearly',
                status: 'succeeded',
                previousAccessEnd: '2026-09-30T00:00:00.000Z',
                newAccessEnd: '2026-11-30T00:00:00.000Z',
                cancelAtPeriodEnd: true,
                notificationStatus: 'queued',
            },
        }));
        adminService.grantSubscriptionGift.mockReturnValueOnce(of({
            operationId: '123e4567-e89b-42d3-a456-426614174098',
            status: 'succeeded',
            previousAccessEnd: '2026-09-30T00:00:00.000Z',
            newAccessEnd: '2026-11-30T00:00:00.000Z',
            cancelAtPeriodEnd: true,
            notificationStatus: 'delivered',
        }));
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(component.retryingNotification()).toBe(true);
        expect(component.primaryActionLabel()).toBe('Check email delivery');
        expect((fixture.nativeElement as HTMLElement).textContent).toContain('Notification to reconcile');
        expect((fixture.nativeElement as HTMLElement).textContent).toContain('Subscription time was already granted');

        await component.grant();

        expect(adminService.grantSubscriptionGift).toHaveBeenCalledWith({
            uid: user.uid,
            months: 2,
            reason: 'Thank-you for the detailed feedback',
            notifyUser: true,
            operationId: '123e4567-e89b-42d3-a456-426614174098',
            previewVersion: 'pv1_notificationabcdefghijklmnop',
        });
        expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({
            response: expect.objectContaining({ notificationStatus: 'delivered' }),
        }));
    });

    it('reuses the same operation after an uncertain callable response', async () => {
        adminService.grantSubscriptionGift
            .mockReturnValueOnce(throwError(() => ({ code: 'functions/unavailable' })))
            .mockReturnValueOnce(of({
                operationId: '123e4567-e89b-42d3-a456-426614174000',
                status: 'succeeded',
                previousAccessEnd: preview.currentAccessEnd,
                newAccessEnd: preview.proposedGiftedEnd,
                cancelAtPeriodEnd: true,
                notificationStatus: 'delivered',
            }));
        fixture.detectChanges();
        await fixture.whenStable();
        component.reason.set('Community thank-you');

        await component.grant();
        const firstRequest = adminService.grantSubscriptionGift.mock.calls[0][0];
        expect(component.requestLockedForRetry()).toBe(true);
        expect(component.error()).toContain('Retry this same operation');

        await component.grant();
        expect(adminService.grantSubscriptionGift.mock.calls[1][0]).toEqual(firstRequest);
        expect(dialogRef.close).toHaveBeenCalled();
    });

    it('keeps a successful gift open so a failed notification can retry through the same operation', async () => {
        adminService.grantSubscriptionGift
            .mockReturnValueOnce(of({
                operationId: '123e4567-e89b-42d3-a456-426614174000',
                status: 'succeeded',
                previousAccessEnd: preview.currentAccessEnd,
                newAccessEnd: preview.proposedGiftedEnd,
                cancelAtPeriodEnd: true,
                notificationStatus: 'failed',
            }))
            .mockReturnValueOnce(of({
                operationId: '123e4567-e89b-42d3-a456-426614174000',
                status: 'succeeded',
                previousAccessEnd: preview.currentAccessEnd,
                newAccessEnd: preview.proposedGiftedEnd,
                cancelAtPeriodEnd: true,
                notificationStatus: 'queued',
            }))
            .mockReturnValueOnce(of({
                operationId: '123e4567-e89b-42d3-a456-426614174000',
                status: 'succeeded',
                previousAccessEnd: preview.currentAccessEnd,
                newAccessEnd: preview.proposedGiftedEnd,
                cancelAtPeriodEnd: true,
                notificationStatus: 'delivered',
            }));
        fixture.detectChanges();
        await fixture.whenStable();
        component.reason.set('Community thank-you');

        await component.grant();
        const originalRequest = adminService.grantSubscriptionGift.mock.calls[0][0];

        expect(dialogRef.close).not.toHaveBeenCalled();
        expect(component.closeResult()).toEqual(expect.objectContaining({
            response: expect.objectContaining({ notificationStatus: 'failed' }),
        }));
        expect(component.error()).toContain('optional email could not be queued');

        await component.grant();

        expect(adminService.grantSubscriptionGift.mock.calls[1][0]).toEqual(originalRequest);
        expect(dialogRef.close).not.toHaveBeenCalled();
        expect(component.primaryActionLabel()).toBe('Check email delivery');

        await component.grant();

        expect(adminService.grantSubscriptionGift.mock.calls[2][0]).toEqual(originalRequest);
        expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({
            response: expect.objectContaining({ notificationStatus: 'delivered' }),
        }));
    });

    it('keeps a newly queued notification recoverable instead of closing the dialog', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        component.reason.set('Community thank-you');

        await component.grant();
        fixture.detectChanges();

        expect(dialogRef.close).not.toHaveBeenCalled();
        expect(component.closeResult()).toEqual(expect.objectContaining({
            response: expect.objectContaining({ notificationStatus: 'queued' }),
        }));
        expect(component.requestLockedForRetry()).toBe(true);
        expect(component.retryingNotification()).toBe(true);
        expect(component.canGrant()).toBe(true);
        expect(component.primaryActionLabel()).toBe('Check email delivery');
        expect((fixture.nativeElement as HTMLElement).textContent).toContain('Email delivery is pending');
    });
});
