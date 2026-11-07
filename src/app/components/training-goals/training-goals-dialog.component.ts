import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { DateAdapter, MAT_DATE_FORMATS, MAT_DATE_LOCALE } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { catchError, of, switchMap } from 'rxjs';
import { ActivityTypesHelper, DistanceUnits } from '@sports-alliance/sports-lib';
import { TRAINING_GOAL_FIELDS, parseTrainingGoalFields, type TrainingGoalFields, type TrainingGoalV1 } from '@shared/training-goals';
import { dayWorkoutLocalDate } from '@shared/day-workout';
import { getActivityTypeGroupCatalog } from '@shared/activity-type-group.metadata';
import { normalizeDistanceUnits } from '@shared/unit-aware-display';
import { AppChartSharedModule } from '../../modules/app-chart-shared.module';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppUserService } from '../../services/app.user.service';
import { TrainingPlansService } from '../../services/training-plans.service';
import { TrainingGoalsService } from '../../services/training-goals.service';
import { ActivityFilterPickerComponent } from '../shared/activity-filter-picker/activity-filter-picker.component';
import { TrainingGoalDetailsComponent } from './training-goal-details.component';
import { CompactSelectComponent, type CompactSelectOption } from '../shared/compact-select/compact-select.component';
import dayjs, { type Dayjs } from 'dayjs';
import { DayjsDateAdapter } from '../../shared/adapters/dayjs-date-adapter';
import { MAT_DAYJS_DATE_FORMATS } from '../../shared/adapters/mat-dayjs-date.module';

class GoalDateAdapter extends DayjsDateAdapter {
  constructor(locale: string, private readonly users: AppUserService) { super(locale); }
  override getFirstDayOfWeek(): number {
    const start = this.users.user()?.settings?.unitSettings?.startOfTheWeek;
    return Number.isInteger(start) && start >= 0 && start <= 6 ? start : 1;
  }
}

@Component({ selector: 'app-training-goals-dialog', standalone: true, imports: [FormsModule, MatDialogModule, MatButtonModule,
  MatFormFieldModule, MatInputModule, MatDatepickerModule, CompactSelectComponent, MatIconModule, MatProgressSpinnerModule, AppChartSharedModule,
  ActivityFilterPickerComponent, TrainingGoalDetailsComponent], templateUrl: './training-goals-dialog.component.html',
  providers: [
    { provide: DateAdapter, useFactory: (locale: string, users: AppUserService) => new GoalDateAdapter(locale, users),
      deps: [MAT_DATE_LOCALE, AppUserService] },
    { provide: MAT_DATE_FORMATS, useValue: MAT_DAYJS_DATE_FORMATS },
  ],
  styleUrl: './training-goals.scss', changeDetection: ChangeDetectionStrategy.OnPush })
export class TrainingGoalsDialogComponent {
  readonly data = inject<{ uid: string; createDate?: string; goal?: TrainingGoalV1 }>(MAT_DIALOG_DATA);
  readonly service = inject(TrainingGoalsService);
  readonly haptics = inject(AppHapticsService);
  private readonly users = inject(AppUserService);
  private readonly plansService = inject(TrainingPlansService);
  private readonly ref = inject(MatDialogRef<TrainingGoalsDialogComponent>);
  readonly units = computed(() => this.users.user()?.settings?.unitSettings ?? null);
  readonly timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  readonly today = dayWorkoutLocalDate(new Date(), this.timeZone);
  readonly state = toSignal(this.service.watch(this.data.uid), { initialValue: { status: 'loading' as const, goals: [] } });
  readonly plans = toSignal(this.plansService.watchPlans(this.data.uid).pipe(catchError(() => of(null))), { initialValue: null });
  readonly archived = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly editing = signal(!!this.data.createDate || !!this.data.goal);
  readonly moreOptions = signal(!!this.data.goal);
  private readonly progressWeekStart = computed(() => this.editing() || this.archived() ? null : this.units()?.startOfTheWeek ?? 1);
  readonly progress = toSignal(toObservable(this.progressWeekStart).pipe(switchMap(weekStartsOn => weekStartsOn === null
    ? of({ status: 'ready' as const, result: null }) : this.service.watchProgress(this.data.uid, this.timeZone, weekStartsOn))),
  { initialValue: { status: 'loading' as const, result: null } });
  readonly previous = signal<TrainingGoalV1 | null>(this.data.goal ?? null);
  private goalId = this.data.goal?.id ?? crypto.randomUUID();
  private initialFields(includeExisting = true): TrainingGoalFields {
    if (includeExisting && this.data.goal) return parseTrainingGoalFields(Object.fromEntries(TRAINING_GOAL_FIELDS.map(key => [key, this.data.goal![key]])));
    return { name: '', kind: 'event', lifecycle: 'active', priority: 'normal', startLocalDate: this.data.createDate && this.data.createDate < this.today ? this.data.createDate : this.today,
      targetLocalDate: this.data.createDate ?? this.today, sportScope: 'all', sport: null, objective: '', planId: null, weeklyTarget: null };
  }
  readonly fields = signal<TrainingGoalFields>(this.initialFields());
  readonly startDateInput = computed(() => this.fields().startLocalDate ? dayjs(this.fields().startLocalDate) : null);
  readonly endDateInput = computed(() => this.fields().targetLocalDate ? dayjs(this.fields().targetLocalDate) : null);
  readonly kindOptions: CompactSelectOption<TrainingGoalFields['kind']>[] = [
    { value: 'event', label: 'Event / race' }, { value: 'milestone', label: 'Milestone' }, { value: 'ongoing', label: 'Ongoing goal' },
  ];
  readonly priorityOptions: CompactSelectOption<TrainingGoalFields['priority']>[] = [
    { value: 'high', label: 'High' }, { value: 'normal', label: 'Normal' }, { value: 'low', label: 'Low' },
  ];
  readonly lifecycleOptions: CompactSelectOption<TrainingGoalFields['lifecycle']>[] = [
    { value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused' }, { value: 'completed', label: 'Completed' }, { value: 'archived', label: 'Archived' },
  ];
  readonly progressOptions = [
    { value: 'manual', label: 'Mark achievement myself' }, { value: 'workouts', label: 'Workouts per week' },
    { value: 'days', label: 'Training days per week' }, { value: 'duration', label: 'Duration per week' }, { value: 'distance', label: 'Distance per week' },
  ] as const;
  readonly startDateLabel = computed(() => this.fields().kind === 'ongoing' ? 'Starts on' : 'Preparation starts');
  readonly endDateLabel = computed(() => this.fields().kind === 'event' ? 'Event date' : 'Achieve by');
  readonly periodHint = computed(() => this.fields().kind === 'ongoing'
    ? 'No end date. This goal guides daily suggestions from its start date while active.'
    : 'Active goals guide daily suggestions from preparation start through the final day.');
  readonly dateRangeError = computed(() => this.fields().kind !== 'ongoing' && this.fields().targetLocalDate
    && this.fields().targetLocalDate! < this.fields().startLocalDate ? `${this.endDateLabel()} must be on or after preparation starts.` : '');
  readonly distanceUnit = normalizeDistanceUnits(this.units()?.distanceUnits) === DistanceUnits.Miles ? 'miles' : 'kilometres';
  readonly targetKind = signal<'manual' | 'workouts' | 'days' | 'duration' | 'distance'>(this.data.goal?.weeklyTarget?.kind ?? 'manual');
  readonly targetValue = signal(this.toInputTarget(this.data.goal?.weeklyTarget));
  readonly targetLabel = computed(() => ({ manual: '', workouts: 'Workouts per week', days: 'Training days per week',
    duration: 'Minutes per week', distance: `${this.distanceUnit === 'miles' ? 'Miles' : 'Kilometres'} per week` })[this.targetKind()]);
  readonly sportOptions = [{ value: 'all', label: 'All sports', icon: 'sports' },
    ...getActivityTypeGroupCatalog().filter(group => group.activityTypes.length).map(group => ({ value: `family:${group.id}`, label: `${group.label} family`, icon: 'sports' })),
    ...ActivityTypesHelper.getActivityTypesAsUniqueArray().map(sport => ({ value: `sport:${sport}`, label: sport, activityType: sport }))];
  readonly selectedSports = computed(() => [this.fields().sportScope === 'all' ? 'all' : `${this.fields().sportScope}:${this.fields().sport}`]);
  readonly selectedPlanMissing = computed(() => !!this.fields().planId && !this.plans()?.some(plan => plan.id === this.fields().planId));
  readonly planOptions = computed<CompactSelectOption[]>(() => [
    { value: null, label: 'Independent goal' },
    ...(this.selectedPlanMissing() ? [{ value: this.fields().planId, label: 'Unavailable plan · keep link' }] : []),
    ...(this.plans() ?? []).map(plan => ({ value: plan.id, label: plan.name })),
  ]);
  readonly rows = computed(() => this.state().goals.filter(goal => this.archived() ? goal.lifecycle === 'archived' : goal.lifecycle !== 'archived')
    .sort((a, b) => (a.targetLocalDate ?? '9999').localeCompare(b.targetLocalDate ?? '9999') || a.name.localeCompare(b.name))
    .map(goal => ({ goal, details: { ...goal, planName: goal.planId ? this.plans()?.find(plan => plan.id === goal.planId)?.name ?? 'Unavailable plan' : null },
      progress: this.progress().result?.progress.find(row => row.goalId === goal.id && row.goalRevision === goal.revision) ?? null })));
  readonly targetStep = computed(() => this.targetKind() === 'days' || this.targetKind() === 'workouts' ? 1 : 0.01);
  readonly targetMax = computed(() => ({ manual: 1, days: 7, workouts: 100, duration: 10080,
    distance: 10000000 / (this.distanceUnit === 'miles' ? 1609.344 : 1000) })[this.targetKind()]);
  readonly parsed = computed(() => {
    try {
      const target = this.targetKind();
      const value = this.targetValue() * (target === 'duration' ? 60 : target === 'distance' ? this.distanceUnit === 'miles' ? 1609.344 : 1000 : 1);
      return parseTrainingGoalFields({ ...this.fields(), weeklyTarget: this.fields().kind === 'ongoing' && target !== 'manual' ? { kind: target, value } : null });
    } catch { return null; }
  });
  constructor() { effect(() => { if (this.users.user()?.uid !== this.data.uid) this.ref.close(); }); }
  set<K extends keyof TrainingGoalFields>(key: K, value: TrainingGoalFields[K], haptic = true): void {
    if (this.busy() || this.fields()[key] === value) return;
    this.fields.update(fields => ({ ...fields, [key]: value }));
    if (key === 'kind') this.fields.update(fields => ({ ...fields, targetLocalDate: value === 'ongoing' ? null : fields.targetLocalDate ?? fields.startLocalDate }));
    if (haptic) this.haptics.selection();
  }
  setDate(key: 'startLocalDate' | 'targetLocalDate', value: Dayjs | null, fromPicker: boolean): void {
    // Keep calendar labels local; converting through a UTC instant can move the stored day.
    const date = dayjs.isDayjs(value) && value.isValid() ? value.format('YYYY-MM-DD') : '';
    this.set(key, date, fromPicker && !!date);
  }
  selectSport(values: string[]): void {
    const choice = values[0] ?? 'all';
    if (this.busy() || !this.sportOptions.some(option => option.value === choice) || this.selectedSports()[0] === choice) return;
    const [scope, ...sport] = choice.split(':');
    this.fields.update(fields => ({ ...fields, sportScope: scope as TrainingGoalFields['sportScope'], sport: scope === 'all' ? null : sport.join(':') }));
    this.haptics.selection();
  }
  selectProgress(value: typeof this.progressOptions[number]['value']): void {
    if (this.busy() || this.targetKind() === value) return;
    this.targetKind.set(value); this.haptics.selection();
  }
  edit(goal?: TrainingGoalV1): void {
    if (this.busy()) return;
    this.previous.set(goal ?? null); this.goalId = goal?.id ?? crypto.randomUUID();
    this.fields.set(goal ? parseTrainingGoalFields(Object.fromEntries(TRAINING_GOAL_FIELDS.map(key => [key, goal[key]])))
      : { ...this.initialFields(false), name: '', startLocalDate: this.today, targetLocalDate: this.today, kind: 'event', lifecycle: 'active', weeklyTarget: null });
    this.targetKind.set(goal?.weeklyTarget?.kind ?? 'manual'); this.targetValue.set(this.toInputTarget(goal?.weeklyTarget));
    this.error.set(''); this.moreOptions.set(!!goal); this.editing.set(true);
  }
  private toInputTarget(target: TrainingGoalFields['weeklyTarget']): number {
    if (!target) return 3;
    return target.value / (target.kind === 'duration' ? 60 : target.kind === 'distance' ? this.distanceUnit === 'miles' ? 1609.344 : 1000 : 1);
  }
  async save(): Promise<void> {
    const fields = this.parsed();
    if (!fields || this.busy()) return;
    this.busy.set(true); this.ref.disableClose = true; this.error.set('');
    try {
      await this.service.save(this.data.uid, this.goalId, fields, this.previous());
      this.haptics.success(); this.editing.set(false);
      this.notice.set('Goal saved. Changes apply to the next daily suggestion; today’s prepared suggestion stays unchanged.');
    } catch (error) { this.error.set(error instanceof Error ? error.message : 'The goal could not be saved.'); this.haptics.error(); }
    finally { this.busy.set(false); this.ref.disableClose = false; }
  }
}
