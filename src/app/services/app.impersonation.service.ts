import { computed, inject, Injectable, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { AppAuthService } from '../authentication/app.auth.service';
import { AppUserInterface } from '../models/app-user.interface';
import { AdminService } from './admin.service';
import { AppFunctionsService } from './app.functions.service';
import { AppUserService } from './app.user.service';
import { AppWindowService } from './app.window.service';
import { LoggerService } from './logger.service';

export interface ImpersonationTarget {
    uid: string;
    email?: string | null;
    displayName?: string | null;
}

export interface ImpersonationSessionViewModel {
    impersonatedBy: string;
    label: string;
}

export function resolveImpersonatedAccountLabel(
    account: Pick<AppUserInterface, 'uid' | 'email' | 'displayName'> | ImpersonationTarget | null | undefined
): string {
    return normalizeNonEmptyString(account?.email)
        ?? normalizeNonEmptyString(account?.displayName)
        ?? normalizeNonEmptyString(account?.uid)
        ?? 'this account';
}

@Injectable({
    providedIn: 'root'
})
export class AppImpersonationService {
    private userService = inject(AppUserService);
    private adminService = inject(AdminService);
    private authService = inject(AppAuthService);
    private functionsService = inject(AppFunctionsService);
    private windowService = inject(AppWindowService);
    private snackBar = inject(MatSnackBar);
    private logger = inject(LoggerService);

    private returningState = signal(false);

    public readonly session = computed<ImpersonationSessionViewModel | null>(() => {
        const user = this.userService.user();
        const impersonatedBy = normalizeNonEmptyString(user?.impersonatedBy);
        if (!impersonatedBy) {
            return null;
        }

        return {
            impersonatedBy,
            label: resolveImpersonatedAccountLabel(user)
        };
    });

    public readonly isImpersonating = computed(() => this.session() !== null);
    public readonly isReturning = computed(() => this.returningState());

    async startImpersonation(target: ImpersonationTarget): Promise<void> {
        try {
            const result = await firstValueFrom(this.adminService.impersonateUser(target.uid));
            await this.authService.loginWithCustomToken(result.token);
            this.redirectTo('/dashboard');
        } catch (error: unknown) {
            this.logger.error('[Impersonation] startImpersonation error:', error);
            this.snackBar.open(this.buildStartErrorMessage(error), 'Close', {
                duration: 5000,
                panelClass: ['error-snackbar']
            });
            throw error;
        }
    }

    async returnToAdmin(): Promise<void> {
        if (this.returningState()) {
            return;
        }

        if (!this.authService.currentUser) {
            throw new Error('Cannot return to admin without an authenticated user.');
        }

        if (!this.session()) {
            const error = new Error('Current session is not impersonating another user.');
            this.logger.error('[Impersonation] returnToAdmin error:', error);
            this.snackBar.open(`Could not return to admin: ${error.message}`, 'Close', {
                duration: 4000
            });
            throw error;
        }

        this.returningState.set(true);

        try {
            const result = await this.functionsService.call<void, { token: string }>('stopImpersonation');
            await this.authService.loginWithCustomToken(result.data.token);
            await this.ensureAdminClaimIsReady();
            this.redirectTo('/admin');
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error('[Impersonation] returnToAdmin error:', error);
            this.snackBar.open(`Could not return to admin: ${message}`, 'Close', {
                duration: 4000
            });
            throw error;
        } finally {
            this.returningState.set(false);
        }
    }

    private redirectTo(path: string): void {
        this.windowService.windowRef.location.assign(path);
    }

    private async ensureAdminClaimIsReady(): Promise<void> {
        const authUser = this.authService.currentUser;
        if (!authUser) {
            throw new Error('Admin session restoration did not complete. Please try again.');
        }

        const tokenResult = await authUser.getIdTokenResult();
        if (tokenResult.claims['admin'] === true) {
            return;
        }

        await authUser.getIdToken(true);
        const refreshedTokenResult = await authUser.getIdTokenResult();
        if (refreshedTokenResult.claims['admin'] === true) {
            return;
        }

        throw new Error('Admin permissions are not ready yet. Please try again.');
    }

    private buildStartErrorMessage(error: unknown): string {
        const err = error as {
            message?: string;
            status?: number;
            name?: string;
            code?: string;
        };

        const message = 'Impersonation failed. ';
        if (typeof err?.message === 'string' && err.message.includes('CORS')) {
            return `${message}This usually happens if the backend function is not deployed or accessible.`;
        }

        if (err?.status === 0 || (err?.name === 'FirebaseError' && err?.code === 'internal')) {
            return `${message}Network or Server Error. Please ensure the backend is deployed.`;
        }

        return `${message}${err?.message || 'Unknown error'}`;
    }
}

function normalizeNonEmptyString(value: string | null | undefined): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}
