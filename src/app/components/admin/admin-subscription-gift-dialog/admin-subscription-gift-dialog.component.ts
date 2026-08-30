import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxChange, MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';
import type {
    GrantAdminSubscriptionGiftRequest,
    GrantAdminSubscriptionGiftResponse,
    PreviewAdminSubscriptionGiftResponse,
} from '../../../../../shared/admin-subscription-gifts';
import { AdminService, AdminUser } from '../../../services/admin.service';
import { BrowserCompatibilityService } from '../../../services/browser.compatibility.service';

export interface AdminSubscriptionGiftDialogData {
    user: AdminUser;
}

export interface AdminSubscriptionGiftDialogResult {
    uid: string;
    response: GrantAdminSubscriptionGiftResponse;
}

const DEFINITIVE_CALLABLE_ERROR_CODES = new Set([
    'already-exists',
    'failed-precondition',
    'invalid-argument',
    'not-found',
    'permission-denied',
    'unauthenticated',
]);

@Component({
    selector: 'app-admin-subscription-gift-dialog',
    standalone: true,
    imports: [
        CommonModule,
        MatButtonModule,
        MatCheckboxModule,
        MatChipsModule,
        MatDialogModule,
        MatFormFieldModule,
        MatIconModule,
        MatInputModule,
        MatProgressSpinnerModule,
        MatSelectModule,
    ],
    templateUrl: './admin-subscription-gift-dialog.component.html',
    styleUrls: ['./admin-subscription-gift-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminSubscriptionGiftDialogComponent implements OnInit, OnDestroy {
    private readonly adminService = inject(AdminService);
    private readonly browserCompatibility = inject(BrowserCompatibilityService);
    private readonly dialogRef = inject<MatDialogRef<AdminSubscriptionGiftDialogComponent, AdminSubscriptionGiftDialogResult | null>>(MatDialogRef);
    readonly data = inject<AdminSubscriptionGiftDialogData>(MAT_DIALOG_DATA);

    private previewRequestSequence = 0;
    private destroyed = false;

    readonly monthsOptions = Array.from({ length: 12 }, (_value, index) => index + 1);
    readonly months = signal(1);
    readonly reason = signal('');
    readonly notifyUser = signal(true);
    readonly preview = signal<PreviewAdminSubscriptionGiftResponse | null>(null);
    readonly previewedMonths = signal<number | null>(null);
    readonly previewLoading = signal(false);
    readonly submitting = signal(false);
    readonly error = signal<string | null>(null);
    readonly outcome = signal<GrantAdminSubscriptionGiftResponse | null>(null);
    readonly retryRequest = signal<GrantAdminSubscriptionGiftRequest | null>(null);

    readonly identityLabel = computed(() => this.data.user.displayName?.trim() || this.data.user.email);
    readonly reasonLength = computed(() => this.reason().trim().length);
    readonly reasonValid = computed(() => this.reasonLength() >= 3 && this.reasonLength() <= 500);
    readonly requiresReview = computed(() => this.outcome()?.status === 'needs_review');
    readonly closeResult = computed<AdminSubscriptionGiftDialogResult | null>(() => {
        const outcome = this.outcome();
        return outcome?.status === 'succeeded'
            ? { uid: this.data.user.uid, response: outcome }
            : null;
    });
    readonly requestLockedForRetry = computed(() => this.retryRequest() !== null);
    readonly controlsDisabled = computed(() => (
        this.previewLoading() || this.submitting() || this.requestLockedForRetry() || this.requiresReview()
    ));
    readonly hasFreshPreview = computed(() => (
        !!this.preview() && this.previewedMonths() === this.months()
    ));
    readonly canGrant = computed(() => (
        this.hasFreshPreview()
        && this.reasonValid()
        && !this.previewLoading()
        && !this.submitting()
        && !this.requiresReview()
    ));

    ngOnInit(): void {
        void this.refreshPreview();
    }

    ngOnDestroy(): void {
        this.destroyed = true;
        this.previewRequestSequence++;
    }

    onMonthsChange(value: unknown): void {
        if (this.controlsDisabled() || typeof value !== 'number' || !Number.isSafeInteger(value)) {
            return;
        }
        if (value < 1 || value > 12 || value === this.months()) {
            return;
        }
        this.months.set(value);
        this.invalidateGrantState();
        void this.refreshPreview();
    }

    onReasonInput(event: Event): void {
        if (this.controlsDisabled()) {
            return;
        }
        const target = event.target;
        if (target instanceof HTMLTextAreaElement) {
            this.reason.set(target.value);
        }
    }

    onNotifyUserChange(event: MatCheckboxChange): void {
        if (!this.controlsDisabled()) {
            this.notifyUser.set(event.checked);
        }
    }

    async refreshPreview(): Promise<void> {
        if (this.submitting() || this.requestLockedForRetry() || this.requiresReview()) {
            return;
        }
        const requestSequence = ++this.previewRequestSequence;
        const requestedMonths = this.months();
        this.previewLoading.set(true);
        this.preview.set(null);
        this.previewedMonths.set(null);
        this.outcome.set(null);
        this.error.set(null);

        try {
            const preview = await firstValueFrom(this.adminService.previewSubscriptionGift({
                uid: this.data.user.uid,
                months: requestedMonths,
            }));
            if (this.destroyed || requestSequence !== this.previewRequestSequence || requestedMonths !== this.months()) {
                return;
            }
            this.preview.set(preview);
            this.previewedMonths.set(requestedMonths);
        } catch (error) {
            if (!this.destroyed && requestSequence === this.previewRequestSequence) {
                this.error.set(this.errorMessage(error, 'Could not preview this subscription gift.'));
            }
        } finally {
            if (!this.destroyed && requestSequence === this.previewRequestSequence) {
                this.previewLoading.set(false);
            }
        }
    }

    async grant(): Promise<void> {
        if (!this.canGrant()) {
            return;
        }
        const preview = this.preview();
        if (!preview) {
            return;
        }

        let request = this.retryRequest();
        if (!request) {
            const operationId = this.browserCompatibility.createRandomUUID();
            if (!operationId) {
                this.error.set('This browser cannot create a secure operation ID. Update the browser and try again.');
                return;
            }
            request = {
                uid: this.data.user.uid,
                months: this.months(),
                reason: this.reason().trim(),
                notifyUser: this.notifyUser(),
                operationId,
                previewVersion: preview.previewVersion,
            };
            this.retryRequest.set(request);
        }

        this.submitting.set(true);
        this.error.set(null);
        this.outcome.set(null);
        try {
            const response = await firstValueFrom(this.adminService.grantSubscriptionGift(request));
            if (this.destroyed) {
                return;
            }
            if (response.status === 'succeeded') {
                if (response.notificationStatus === 'failed') {
                    this.outcome.set(response);
                    this.error.set('Subscription time was granted, but the optional email could not be queued. Retry this same operation or close the dialog.');
                    return;
                }
                this.dialogRef.close({ uid: this.data.user.uid, response });
                return;
            }

            this.outcome.set(response);
            this.error.set(response.message || (
                response.status === 'needs_review'
                    ? 'Stripe’s outcome requires manual review. Do not start another gift for this user.'
                    : 'Stripe rejected the gift. Refresh the preview before trying again.'
            ));
            if (response.status === 'failed') {
                this.retryRequest.set(null);
                this.preview.set(null);
                this.previewedMonths.set(null);
            }
        } catch (error) {
            if (!this.destroyed) {
                const definitive = this.isDefinitiveCallableError(error);
                if (definitive) {
                    this.retryRequest.set(null);
                    this.preview.set(null);
                    this.previewedMonths.set(null);
                }
                this.error.set(definitive
                    ? this.errorMessage(error, 'The gift was not applied. Refresh the preview and try again.')
                    : 'The response was interrupted. Retry this same operation so it can be reconciled safely.');
            }
        } finally {
            if (!this.destroyed) {
                this.submitting.set(false);
            }
        }
    }

    private invalidateGrantState(): void {
        this.preview.set(null);
        this.previewedMonths.set(null);
        this.outcome.set(null);
        this.error.set(null);
        this.retryRequest.set(null);
    }

    private isDefinitiveCallableError(error: unknown): boolean {
        const code = this.callableErrorCode(error);
        return DEFINITIVE_CALLABLE_ERROR_CODES.has(code);
    }

    private callableErrorCode(error: unknown): string {
        const rawCode = (error as { code?: unknown } | null)?.code;
        if (typeof rawCode !== 'string') {
            return '';
        }
        return rawCode.startsWith('functions/') ? rawCode.slice('functions/'.length) : rawCode;
    }

    private errorMessage(error: unknown, fallback: string): string {
        const message = (error as { message?: unknown } | null)?.message;
        return typeof message === 'string' && message.trim() ? message : fallback;
    }
}
