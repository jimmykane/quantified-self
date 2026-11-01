import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Auth, authState } from 'app/firebase/auth';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { DAY_WORKOUT_SPORTS, dayWorkoutLocalDate, dayWorkoutDateOffset, type DayWorkoutControls, type DayWorkoutDraft,
  type GenerateDayWorkoutRequest, type GenerateDayWorkoutResponse } from '@shared/day-workout';
import type { DayWorkoutDialogData } from '../components/plans/day-workout-dialog.component';
import type { MutateTrainingScheduleRequestV1 } from '@shared/training-plans';
import { AppFunctionsService } from './app.functions.service';
import { trainingPlansCreateRoute } from '../helpers/training-plans-navigation.helper';
import { AppUserService } from './app.user.service';

export interface DayWorkoutEditorDraft {
  ownerUid: string;
  controls: DayWorkoutControls;
  draft: DayWorkoutDraft;
  saveRequest: MutateTrainingScheduleRequestV1;
}
@Injectable({ providedIn: 'root' })
export class DayWorkoutService {
  private readonly auth = inject(Auth);
  private readonly users = inject(AppUserService);
  private readonly functions = inject(AppFunctionsService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private handoff: DayWorkoutEditorDraft | null = null;
  private opening = false;

  constructor() {
    authState(this.auth).pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(user => {
      if (this.handoff?.ownerUid !== user?.uid) this.handoff = null;
    });
  }
  isOwner(uid: string): boolean { return this.auth.currentUser?.uid === uid && this.users.user()?.uid === uid; }
  canGenerate(date: string, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): boolean {
    try {
      const today = dayWorkoutLocalDate(new Date(), timeZone);
      return date >= today && date <= dayWorkoutDateOffset(today, 365);
    }
    catch { return false; }
  }
  async open(ownerUid: string, localDate: string, sport?: string,
    options: Partial<Pick<DayWorkoutDialogData, 'initialControls' | 'initialResult' | 'mode' | 'followRoutine' | 'savePreferences' | 'onAdded'>>
      & { onEditorDraft?: (draft: DayWorkoutEditorDraft) => void } = {}): Promise<void> {
    if (!this.isOwner(ownerUid) || !this.canGenerate(localDate, options.initialControls?.timeZone) || this.opening) return;
    this.opening = true;
    try {
      const { DayWorkoutDialogComponent } = await import('../components/plans/day-workout-dialog.component');
      if (!this.isOwner(ownerUid) || !this.canGenerate(localDate, options.initialControls?.timeZone)) return;
      const narrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 600px)').matches;
      const { onEditorDraft, ...dialogOptions } = options;
      const result = await firstValueFrom(this.dialog.open(DayWorkoutDialogComponent, {
        data: { ...dialogOptions, ownerUid, localDate, sport: DAY_WORKOUT_SPORTS.find(value => value === sport) ?? ActivityTypes.Running },
        width: narrow ? '100vw' : '720px', maxWidth: '100vw', maxHeight: '100dvh', ...(narrow ? { height: '100dvh' } : {}),
      }).afterClosed());
      if (result && this.isOwner(ownerUid) && result.ownerUid === ownerUid) {
        if (onEditorDraft) { this.handoff = null; onEditorDraft(result); return; }
        this.handoff = result;
        const destination = result.controls.destinationPlanId;
        try {
          const navigated = await this.router.navigate(trainingPlansCreateRoute(destination, destination === null),
            { queryParams: { date: result.controls.localDate } });
          if (!navigated) this.handoff = null;
        } catch (error) { this.handoff = null; throw error; }
      }
    } finally { this.opening = false; }
  }
  takeEditorDraft(ownerUid: string, planId: string | null, date: string): DayWorkoutEditorDraft | null {
    const draft = this.handoff;
    if (!draft || !this.isOwner(ownerUid) || draft.ownerUid !== ownerUid) { this.handoff = null; return null; }
    this.handoff = null;
    if (draft.controls.destinationPlanId !== planId || draft.controls.localDate !== date) return null;
    return draft;
  }
  async generate(ownerUid: string, request: GenerateDayWorkoutRequest, current: () => boolean): Promise<GenerateDayWorkoutResponse> {
    return (await this.functions.call<GenerateDayWorkoutRequest, GenerateDayWorkoutResponse>('generateDayWorkout', request,
      { canExecute: () => this.isOwner(ownerUid) && current() })).data;
  }
}
