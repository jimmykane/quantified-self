import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { NavigationStart, Router } from '@angular/router';
import { Auth, authState } from 'app/firebase/auth';
import { DAY_WORKOUT_SPORTS, dayWorkoutDateOffset, dayWorkoutLocalDate } from '@shared/day-workout';
import { TRAINING_GOAL_PRIORITIES } from '@shared/training-goals';
import type { AssistantQuotaStatus } from '@shared/assistant.types';
import { AppChartSharedModule } from '../../modules/app-chart-shared.module';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppUserService } from '../../services/app.user.service';
import { AssistantQuotaService } from '../../services/assistant-quota.service';
import { TrainingGoalsService, type TrainingGoalsState } from '../../services/training-goals.service';
import { buildPlanAssistantRequest, nextPlanMonday, PLAN_WEEKDAYS, type PlanAssistantRequest, type PlanGenerationOptions } from '@shared/training-plan-generation';
import { ActivityFilterPickerComponent } from '../shared/activity-filter-picker/activity-filter-picker.component';

@Component({ selector: 'app-plan-generation-dialog', standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    AppChartSharedModule, ActivityFilterPickerComponent],
  templateUrl: './plan-generation-dialog.component.html', styleUrl: './plan-generation-dialog.component.scss', changeDetection: ChangeDetectionStrategy.OnPush })
export class PlanGenerationDialogComponent {
  readonly data = inject<{ uid: string }>(MAT_DIALOG_DATA);
  readonly haptics = inject(AppHapticsService);
  private readonly ref = inject(MatDialogRef<PlanGenerationDialogComponent, PlanAssistantRequest>);
  private readonly auth = inject(Auth);
  private readonly session = this.auth.currentUser;
  private readonly users = inject(AppUserService);
  private readonly goals = inject(TrainingGoalsService);
  private readonly destroyRef = inject(DestroyRef);
  readonly today = dayWorkoutLocalDate(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone);
  readonly latestDate = dayWorkoutDateOffset(this.today, 365);
  private readonly preferences = this.users.user()?.settings?.appSettings?.dailyWorkoutSuggestion;
  readonly options = signal<Omit<PlanGenerationOptions, 'goalNames'>>({ startLocalDate: nextPlanMonday(this.today), weeks: 4,
    sport: null, days: null, minutes: null, timelineNotesEnabled: this.preferences?.controls?.timelineContext ?? true, instructions: '' });
  readonly customMinutes = signal(this.preferences?.controls?.minutes ?? 30);
  readonly goalState = signal<TrainingGoalsState>({ status: 'loading', goals: [] });
  readonly goalIds = signal<string[]>([]);
  readonly goalOptions = computed(() => this.goalState().goals.filter(goal => goal.lifecycle === 'active'
    && (!goal.targetLocalDate || goal.targetLocalDate >= this.today)).sort((a, b) =>
    TRAINING_GOAL_PRIORITIES.indexOf(a.priority) - TRAINING_GOAL_PRIORITIES.indexOf(b.priority) || a.name.localeCompare(b.name)));
  readonly sportOptions = DAY_WORKOUT_SPORTS.map(value => ({ value, label: value, activityType: value }));
  readonly selectedSports = computed(() => this.options().sport ? [this.options().sport!] : []);
  readonly weekdays = PLAN_WEEKDAYS;
  readonly more = signal(false);
  readonly quota = signal<AssistantQuotaStatus | null>(null);
  readonly quotaLoading = signal(true);
  readonly quotaText = computed(() => this.quotaLoading() ? 'Loading Assistant allowance…' : this.quota()
    ? `Assistant: ${this.quota()!.remainingCount} of ${this.quota()!.limit} remaining${this.quota()!.isEligible ? '' : ' · Pro required'}`
    : 'Allowance checked in Assistant');
  readonly validation = computed(() => {
    if (this.goalIds().length && (this.goalState().status !== 'ready' || this.goalIds().some(id => !this.goalOptions().some(goal => goal.id === id)))) {
      return { request: null, error: 'Selected goals are unavailable. Clear the selection or reopen to retry.' };
    }
    try { return { request: buildPlanAssistantRequest({ ...this.options(),
      goalNames: this.goalIds().map(id => this.goalOptions().find(goal => goal.id === id)!.name) }, this.today), error: null }; }
    catch (error) { return { request: null, error: error instanceof Error ? error.message : 'Check the plan options.' }; }
  });
  readonly canContinue = computed(() => !!this.validation().request && !this.quotaLoading()
    && (!this.quota() || (this.quota()!.isEligible && this.quota()!.remainingCount > 0)));
  readonly error = signal<string | null>(null);
  readonly creatingGoal = signal(false);
  constructor() {
    effect(() => { if (!this.isCurrent()) this.ref.close(); });
    authState(this.auth).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(session => { if (session !== this.session) this.ref.close(); });
    inject(Router).events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(event => { if (event instanceof NavigationStart) this.ref.close(); });
    let initialized = false;
    this.goals.watch(this.data.uid).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(state => {
      if (!this.isCurrent()) return;
      this.goalState.set(state);
      if (!initialized && state.status === 'ready') {
        initialized = true;
        this.goalIds.set(this.goalOptions().slice(0, 1).map(goal => goal.id));
      }
    });
    void inject(AssistantQuotaService).loadQuotaStatus().then(quota => {
      if (this.isCurrent()) { this.quota.set(quota); this.quotaLoading.set(false); }
    });
  }
  private isCurrent(): boolean { return !this.destroyRef.destroyed && this.auth.currentUser === this.session
    && this.session?.uid === this.data.uid && this.users.user()?.uid === this.data.uid; }
  update<K extends keyof Omit<PlanGenerationOptions, 'goalNames'>>(key: K, value: PlanGenerationOptions[K], feedback = false): void {
    if (this.options()[key] === value) return;
    this.options.update(options => ({ ...options, [key]: value }));
    if (feedback) this.haptics.selection();
  }
  selectGoals(ids: string[]): void {
    if (ids.length === this.goalIds().length && ids.every(id => this.goalIds().includes(id))) return;
    this.goalIds.set(ids); this.haptics.selection();
  }
  toggleDay(value: number, checked: boolean): void {
    const days = this.options().days ?? [];
    if (days.includes(value) === checked) return;
    this.update('days', checked ? [...days, value] : days.filter(day => day !== value), true);
  }
  async createGoal(): Promise<void> {
    if (!this.isCurrent() || this.creatingGoal()) return;
    this.error.set(null);
    this.creatingGoal.set(true);
    try { await this.goals.open(this.data.uid, this.options().startLocalDate); }
    catch { if (this.isCurrent()) { this.error.set('Could not open Goals. Please try again.'); this.haptics.error(); } }
    finally { if (!this.destroyRef.destroyed) this.creatingGoal.set(false); }
  }
  continue(): void { if (this.isCurrent() && this.canContinue()) this.ref.close(this.validation().request!); }
}
