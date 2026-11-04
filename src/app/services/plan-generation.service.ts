import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Auth, authState, type FirebaseUserType } from 'app/firebase/auth';
import { AppUserService } from './app.user.service';
import type { PlanAssistantRequest } from '@shared/training-plan-generation';

/** A single-use, in-memory handoff. Goal names never enter URLs or browser storage. */
@Injectable({ providedIn: 'root' })
export class PlanGenerationService {
  private readonly auth = inject(Auth);
  private readonly users = inject(AppUserService);
  private readonly dialogs = inject(MatDialog);
  private readonly router = inject(Router);
  private opening = false;
  private pending: { session: FirebaseUserType | null; request: PlanAssistantRequest; expires: number } | null = null;
  constructor() {
    authState(this.auth).pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(session => {
      if (this.pending?.session !== session) this.pending = null;
    });
  }
  private isOwner(uid: string): boolean { return !!uid && this.auth.currentUser?.uid === uid && this.users.user()?.uid === uid; }
  async open(uid: string, canExecute: () => boolean): Promise<void> {
    const session = this.auth.currentUser;
    const current = () => this.isOwner(uid) && this.auth.currentUser === session && canExecute();
    if (this.opening || !current()) return;
    this.opening = true;
    try {
      const { PlanGenerationDialogComponent } = await import('../components/plans/plan-generation-dialog.component');
      if (!current()) return;
      const request = await firstValueFrom(this.dialogs.open<InstanceType<typeof PlanGenerationDialogComponent>, { uid: string }, PlanAssistantRequest>(
        PlanGenerationDialogComponent, { data: { uid }, width: '640px', maxWidth: 'calc(100vw - 16px)', maxHeight: 'calc(100dvh - 16px)' }).afterClosed());
      if (!request || !current()) return;
      this.pending = { session, request, expires: Date.now() + 15 * 60_000 };
      try {
        if (!await this.router.navigate(['/ai-insights'])) { this.pending = null; throw Error('Could not open Assistant. Please try again.'); }
      } catch (error) { this.pending = null; throw error; }
    } finally { this.opening = false; }
  }
  take(uid: string): PlanAssistantRequest | null {
    const pending = this.pending;
    this.pending = null;
    return pending && this.isOwner(uid) && pending.session === this.auth.currentUser && pending.expires > Date.now()
      ? pending.request : null;
  }
}
