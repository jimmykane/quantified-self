import {
  ChangeDetectionStrategy,
  Component,
  LOCALE_ID,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute } from '@angular/router';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { catchError, map, of, startWith, switchMap } from 'rxjs';
import type { AppUserInterface } from '../../models/app-user.interface';
import { SharedModule } from '../../modules/shared.module';
import { AppUserService } from '../../services/app.user.service';
import {
  TrainingPlansService,
  type CurrentTrainingScheduleV1,
} from '../../services/training-plans.service';
import { ConfirmationDialogComponent } from '../confirmation-dialog/confirmation-dialog.component';
import {
  createManualWorkoutEditorStep,
  createManualWorkoutEditorValue,
  formatManualWorkoutStructure,
  manualWorkoutEditorToStructure,
  workoutStructureToManualEditor,
  type ManualWorkoutEditorNode,
  type ManualWorkoutEditorStep,
  type ManualWorkoutEditorValue,
  type ManualWorkoutEnding,
  type ManualWorkoutSport,
  type ManualWorkoutTarget,
} from '../../helpers/planned-workout-editor.helper';
import {
  normalizeTrainingLocalDate,
  type DeleteTrainingPlanRequestV1,
  type ExpectedTrainingScheduleRevision,
  type MutateTrainingScheduleRequestV1,
  type MutateTrainingScheduleResponseV1,
  type ScheduledWorkoutV1,
  type TrainingPlanLifecycle,
  type TrainingPlanV1,
  type TrainingScheduleHistoryEntryV1,
  type TrainingScheduleRevisionScope,
} from '@shared/training-plans';

type PlansView = 'plans' | 'standalone';

interface ScheduleLoadState {
  status: 'loading' | 'ready' | 'error';
  schedule: CurrentTrainingScheduleV1;
  message: string | null;
}

interface WorkoutEditorSession {
  mode: 'create' | 'edit';
  original: ScheduledWorkoutV1 | null;
  originalWorkoutRevision: number | null;
  destinationPlanId: string | null;
  value: ManualWorkoutEditorValue;
}

interface WorkoutRow {
  workout: ScheduledWorkoutV1;
  summary: string[];
  planName: string;
}

interface PlanDraft {
  name: string;
  startLocalDate: string;
  endLocalDate: string;
  activate: boolean;
}

interface HistoryPanelState {
  scope: TrainingScheduleRevisionScope;
  status: 'loading' | 'ready' | 'error';
  entries: TrainingScheduleHistoryEntryV1[];
  nextBeforeRevision: number | null;
  error: string | null;
}

const EMPTY_SCHEDULE: CurrentTrainingScheduleV1 = {
  state: { schemaVersion: 1, activePlanId: null, revision: 0, currentWorkoutCount: 0, updatedAtMs: 0 },
  plans: [],
  workouts: [],
};

@Component({
  selector: 'app-plans-workspace',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './plans-workspace.component.html',
  styleUrls: ['./plans-workspace.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlansWorkspaceComponent {
  private readonly userService = inject(AppUserService);
  private readonly plansService = inject(TrainingPlansService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly route = inject(ActivatedRoute);
  private readonly locale = inject(LOCALE_ID);
  private requestedEditorOpened = false;
  private nodeSequence = 1;

  readonly activityTypes = ActivityTypes;
  readonly sportOptions: ReadonlyArray<{ value: ManualWorkoutSport; label: string }> = [
    { value: ActivityTypes.Running, label: 'Running' },
    { value: ActivityTypes.Cycling, label: 'Cycling' },
  ];
  readonly purposeOptions = ['warmup', 'work', 'recovery', 'cooldown', 'rest', 'other'] as const;
  readonly endingOptions: ReadonlyArray<{ value: ManualWorkoutEnding; label: string }> = [
    { value: 'time', label: 'Time' },
    { value: 'distance', label: 'Distance' },
  ];
  readonly targetOptions: ReadonlyArray<{ value: ManualWorkoutTarget; label: string }> = [
    { value: 'none', label: 'No target' },
    { value: 'heart-rate', label: 'Heart rate' },
    { value: 'power', label: 'Power' },
    { value: 'pace', label: 'Pace' },
  ];

  readonly currentUser = computed(() => this.userService.user() as AppUserInterface | null);
  readonly scheduleState = toSignal(this.userService.user$.pipe(
    switchMap(user => user?.uid
      ? this.plansService.watchSchedule(user.uid).pipe(
        map(schedule => ({ status: 'ready', schedule, message: null }) as ScheduleLoadState),
        startWith({ status: 'loading', schedule: EMPTY_SCHEDULE, message: null } as ScheduleLoadState),
        catchError(error => of({
          status: 'error',
          schedule: EMPTY_SCHEDULE,
          message: errorMessage(error),
        } as ScheduleLoadState)),
      )
      : of({ status: 'ready', schedule: EMPTY_SCHEDULE, message: null } as ScheduleLoadState)),
  ), { initialValue: { status: 'loading', schedule: EMPTY_SCHEDULE, message: null } as ScheduleLoadState });
  readonly schedule = computed(() => this.scheduleState().schedule);
  readonly view = signal<PlansView>('plans');
  readonly selectedPlanId = signal<string | null>(null);
  readonly showPlanForm = signal(false);
  readonly planDraft = signal<PlanDraft>(defaultPlanDraft());
  readonly renamingPlanId = signal<string | null>(null);
  readonly renameValue = signal('');
  readonly shiftingPlanId = signal<string | null>(null);
  readonly shiftDays = signal(1);
  readonly deletingPlanId = signal<string | null>(null);
  readonly deleteDisposition = signal<DeleteTrainingPlanRequestV1['workoutDisposition']>('convert-to-standalone');
  readonly editor = signal<WorkoutEditorSession | null>(null);
  readonly busyAction = signal<string | null>(null);
  readonly historyPanel = signal<HistoryPanelState | null>(null);

  readonly planOptions = computed(() => this.schedule().plans);
  readonly activePlan = computed(() => this.schedule().plans.find(plan => (
    plan.id === this.schedule().state.activePlanId
  )) ?? null);
  readonly selectedPlan = computed(() => this.schedule().plans.find(plan => (
    plan.id === this.selectedPlanId()
  )) ?? null);
  readonly activePlanLabel = computed(() => this.activePlan()?.name ?? 'None');
  readonly workoutRows = computed<WorkoutRow[]>(() => {
    const selectedPlanId = this.view() === 'plans' ? this.selectedPlanId() : null;
    const planNames = new Map(this.schedule().plans.map(plan => [plan.id, plan.name]));
    return this.schedule().workouts
      .filter(workout => this.view() === 'standalone'
        ? workout.planId === null
        : workout.planId === selectedPlanId)
      .map(workout => ({
        workout,
        summary: formatManualWorkoutStructure(
          workout.structure,
          this.currentUser()?.settings?.unitSettings ?? null,
          this.locale,
        ),
        planName: workout.planId ? planNames.get(workout.planId) ?? 'Unknown plan' : 'Standalone',
      }));
  });
  readonly currentWorkoutRows = computed(() => this.workoutRows().filter(row => row.workout.lifecycle !== 'deleted'));
  readonly deletedWorkoutRows = computed(() => this.workoutRows().filter(row => row.workout.lifecycle === 'deleted'));
  readonly selectedScopeLabel = computed(() => this.view() === 'standalone'
    ? 'Standalone workouts'
    : this.selectedPlan()?.name ?? 'Select a plan');
  readonly pageStatus = computed(() => {
    if (this.scheduleState().status === 'loading') return 'pending' as const;
    if (this.scheduleState().status === 'error') return 'warning' as const;
    return null;
  });

  private readonly selectionEffect = effect(() => {
    const plans = this.schedule().plans;
    const selected = this.selectedPlanId();
    if (selected && plans.some(plan => plan.id === selected)) return;
    this.selectedPlanId.set(this.schedule().state.activePlanId ?? plans[0]?.id ?? null);
  });

  private readonly requestedEditorEffect = effect(() => {
    if (this.requestedEditorOpened || this.scheduleState().status !== 'ready') return;
    const requestedWorkoutId = `${this.route.snapshot.queryParamMap.get('workout') || ''}`.trim();
    if (requestedWorkoutId) {
      const workout = this.schedule().workouts.find(candidate => (
        candidate.id === requestedWorkoutId && candidate.lifecycle !== 'deleted'
      ));
      if (workout) {
        this.requestedEditorOpened = true;
        this.view.set(workout.planId ? 'plans' : 'standalone');
        this.selectedPlanId.set(workout.planId);
        this.editWorkout(workout);
        return;
      }
    }
    const requestedDate = this.route.snapshot.queryParamMap.get('date');
    if (!requestedDate) {
      this.requestedEditorOpened = true;
      if (requestedWorkoutId) {
        this.snackBar.open('That planned workout is no longer available.', 'Dismiss', { duration: 5000 });
      }
      return;
    }
    try {
      const localDate = normalizeTrainingLocalDate(requestedDate);
      const standalone = this.route.snapshot.queryParamMap.get('scope') === 'standalone';
      this.requestedEditorOpened = true;
      this.openNewWorkout(standalone ? null : this.schedule().state.activePlanId, localDate);
    } catch {
      this.requestedEditorOpened = true;
    }
  });

  selectView(view: PlansView): void {
    this.view.set(view);
    this.cancelEditor();
    this.historyPanel.set(null);
  }

  selectPlan(planId: string): void {
    this.selectedPlanId.set(planId);
    this.view.set('plans');
    this.cancelEditor();
    this.historyPanel.set(null);
  }

  beginPlanCreation(): void {
    this.planDraft.set(defaultPlanDraft());
    this.showPlanForm.set(true);
  }

  cancelPlanCreation(): void {
    this.showPlanForm.set(false);
  }

  updatePlanDraft<K extends keyof PlanDraft>(field: K, value: PlanDraft[K]): void {
    this.planDraft.update(draft => ({ ...draft, [field]: value }));
  }

  async createPlan(): Promise<void> {
    const draft = this.planDraft();
    const planId = this.plansService.createEntityId('plan');
    const expected = this.expectedRevisions({
      planIds: draft.activate && this.activePlan() ? [this.activePlan()!.id] : [],
    });
    const response = await this.runMutation({
      mutationId: this.plansService.createMutationId('create-plan'),
      expectedRevisions: expected,
      operation: {
        kind: 'create-plan',
        planId,
        name: draft.name,
        startLocalDate: draft.startLocalDate,
        endLocalDate: draft.endLocalDate,
        activate: draft.activate,
      },
    }, 'create-plan');
    if (!response) return;
    this.showPlanForm.set(false);
    this.selectedPlanId.set(planId);
    this.view.set('plans');
    this.snackBar.open('Training plan created.', 'Dismiss', { duration: 3500 });
  }

  beginRename(plan: TrainingPlanV1): void {
    this.renamingPlanId.set(plan.id);
    this.renameValue.set(plan.name);
  }

  async renamePlan(plan: TrainingPlanV1): Promise<void> {
    const name = this.renameValue().trim();
    if (!name) return;
    const response = await this.runMutation({
      mutationId: this.plansService.createMutationId('rename-plan'),
      expectedRevisions: this.expectedRevisions({
        planIds: [plan.id],
        planRevisionOverrides: new Map([[plan.id, plan.revision]]),
      }),
      operation: { kind: 'rename-plan', planId: plan.id, name },
    }, `rename-${plan.id}`);
    if (!response) return;
    this.renamingPlanId.set(null);
    this.snackBar.open('Plan renamed.', 'Dismiss', { duration: 3000 });
  }

  async setPlanLifecycle(plan: TrainingPlanV1, lifecycle: TrainingPlanLifecycle): Promise<void> {
    const planIds = [plan.id];
    if (lifecycle === 'active' && this.activePlan() && this.activePlan()!.id !== plan.id) {
      planIds.push(this.activePlan()!.id);
    }
    const response = await this.runMutation({
      mutationId: this.plansService.createMutationId(`plan-${lifecycle}`),
      expectedRevisions: this.expectedRevisions({
        planIds,
        planRevisionOverrides: new Map([[plan.id, plan.revision]]),
      }),
      operation: { kind: 'set-plan-lifecycle', planId: plan.id, lifecycle },
    }, `lifecycle-${plan.id}`);
    if (!response) return;
    if (lifecycle === 'archived' && this.deletingPlanId() === plan.id) {
      this.deletingPlanId.set(null);
    }
    this.snackBar.open(`Plan ${lifecycle}.`, 'Dismiss', { duration: 3000 });
  }

  beginShift(plan: TrainingPlanV1): void {
    this.shiftingPlanId.set(plan.id);
    this.shiftDays.set(1);
  }

  async shiftPlan(plan: TrainingPlanV1): Promise<void> {
    const days = Number(this.shiftDays());
    if (!Number.isSafeInteger(days) || days === 0 || Math.abs(days) > 366) {
      this.snackBar.open('Enter a non-zero whole-day shift up to 366 days.', 'Dismiss', { duration: 5000 });
      return;
    }
    const response = await this.runMutation({
      mutationId: this.plansService.createMutationId('shift-plan'),
      expectedRevisions: this.expectedRevisions({
        planIds: [plan.id],
        planRevisionOverrides: new Map([[plan.id, plan.revision]]),
      }),
      operation: { kind: 'shift-plan', planId: plan.id, days },
    }, `shift-${plan.id}`);
    if (!response) return;
    this.shiftingPlanId.set(null);
    this.snackBar.open(`Plan shifted ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}.`, 'Dismiss', { duration: 3500 });
  }

  beginPlanDeletion(plan: TrainingPlanV1): void {
    this.deletingPlanId.set(plan.id);
    this.deleteDisposition.set('convert-to-standalone');
  }

  async deletePlan(plan: TrainingPlanV1): Promise<void> {
    const disposition = this.deleteDisposition();
    const expectedRevisions = this.expectedRevisions({
      planIds: [plan.id],
      planRevisionOverrides: new Map([[plan.id, plan.revision]]),
    });
    const confirmed = await this.confirm(
      'Delete training plan?',
      disposition === 'convert-to-standalone'
        ? `Delete ${plan.name} and keep its current workouts as standalone workouts? Plan history will be removed.`
        : `Delete ${plan.name}, its current workouts, and their history permanently?`,
      'Delete plan',
      'warn',
    );
    if (!confirmed) return;
    this.busyAction.set(`delete-plan-${plan.id}`);
    try {
      await this.plansService.deletePlan({
        mutationId: this.plansService.createMutationId('delete-plan'),
        planId: plan.id,
        expectedRevisions,
        workoutDisposition: disposition,
        confirmPlanDeletion: true,
      });
      this.deletingPlanId.set(null);
      this.snackBar.open('Training plan deleted.', 'Dismiss', { duration: 4000 });
    } catch (error) {
      this.showError(error);
    } finally {
      this.busyAction.set(null);
    }
  }

  openNewWorkout(destinationPlanId?: string | null, localDate = todayLocalDate()): void {
    const defaultDestination = destinationPlanId === undefined
      ? (this.view() === 'plans' ? this.selectedPlanId() : null)
      : destinationPlanId;
    this.editor.set({
      mode: 'create',
      original: null,
      originalWorkoutRevision: null,
      destinationPlanId: defaultDestination ?? null,
      value: createManualWorkoutEditorValue(localDate, this.nextNodeId('step')),
    });
  }

  editWorkout(workout: ScheduledWorkoutV1): void {
    try {
      this.editor.set({
        mode: 'edit',
        original: workout,
        originalWorkoutRevision: workout.revision,
        destinationPlanId: workout.planId,
        value: workoutStructureToManualEditor(workout.title, workout.localDate, workout.structure),
      });
    } catch (error) {
      this.showError(error);
    }
  }

  cancelEditor(): void {
    this.editor.set(null);
  }

  updateEditorField<K extends keyof ManualWorkoutEditorValue>(field: K, value: ManualWorkoutEditorValue[K]): void {
    this.editor.update(session => session ? { ...session, value: { ...session.value, [field]: value } } : null);
  }

  updateEditorDestination(planId: string | null): void {
    this.editor.update(session => session ? { ...session, destinationPlanId: planId } : null);
  }

  addEditorStep(): void {
    this.editor.update(session => session ? {
      ...session,
      value: {
        ...session.value,
        nodes: [...session.value.nodes, createManualWorkoutEditorStep(this.nextNodeId('step'))],
      },
    } : null);
  }

  addEditorRepeat(): void {
    this.editor.update(session => session ? {
      ...session,
      value: {
        ...session.value,
        nodes: [...session.value.nodes, {
          kind: 'repeat',
          id: this.nextNodeId('repeat'),
          count: 4,
          steps: [
            createManualWorkoutEditorStep(this.nextNodeId('step')),
            { ...createManualWorkoutEditorStep(this.nextNodeId('step')), purpose: 'recovery' },
          ],
        }],
      },
    } : null);
  }

  removeEditorNode(nodeIndex: number): void {
    this.editor.update(session => session ? {
      ...session,
      value: { ...session.value, nodes: session.value.nodes.filter((_, index) => index !== nodeIndex) },
    } : null);
  }

  addRepeatStep(nodeIndex: number): void {
    this.editor.update(session => {
      if (!session) return null;
      const nodes = session.value.nodes.map((node, index) => index === nodeIndex && node.kind === 'repeat'
        ? { ...node, steps: [...node.steps, createManualWorkoutEditorStep(this.nextNodeId('step'))] }
        : node);
      return { ...session, value: { ...session.value, nodes } };
    });
  }

  removeRepeatStep(nodeIndex: number, stepIndex: number): void {
    this.editor.update(session => {
      if (!session) return null;
      const nodes = session.value.nodes.map((node, index) => index === nodeIndex && node.kind === 'repeat'
        ? { ...node, steps: node.steps.filter((_, candidate) => candidate !== stepIndex) }
        : node);
      return { ...session, value: { ...session.value, nodes } };
    });
  }

  updateNode(nodeIndex: number, field: string, value: unknown): void {
    this.editor.update(session => {
      if (!session) return null;
      const nodes = session.value.nodes.map((node, index) => index === nodeIndex
        ? { ...node, [field]: value } as ManualWorkoutEditorNode
        : node);
      return { ...session, value: { ...session.value, nodes } };
    });
  }

  updateStep(nodeIndex: number, stepIndex: number | null, field: string, value: unknown): void {
    this.editor.update(session => {
      if (!session) return null;
      const nodes = session.value.nodes.map((node, index) => {
        if (index !== nodeIndex) return node;
        if (stepIndex === null && node.kind === 'step') return { ...node, [field]: value } as ManualWorkoutEditorStep;
        if (stepIndex !== null && node.kind === 'repeat') {
          return {
            ...node,
            steps: node.steps.map((step, candidate) => candidate === stepIndex
              ? { ...step, [field]: value } as ManualWorkoutEditorStep
              : step),
          };
        }
        return node;
      });
      return { ...session, value: { ...session.value, nodes } };
    });
  }

  async saveWorkout(): Promise<void> {
    const session = this.editor();
    if (!session) return;
    const title = session.value.title.trim();
    if (!title) {
      this.snackBar.open('Enter a workout title.', 'Dismiss', { duration: 4000 });
      return;
    }
    let structure;
    try {
      structure = manualWorkoutEditorToStructure(session.value);
      normalizeTrainingLocalDate(session.value.localDate);
    } catch (error) {
      this.showError(error);
      return;
    }
    if (session.mode === 'create') {
      const workoutId = this.plansService.createEntityId('workout');
      const response = await this.runMutation({
        mutationId: this.plansService.createMutationId('create-workout'),
        expectedRevisions: this.expectedRevisions({
          planIds: session.destinationPlanId ? [session.destinationPlanId] : [],
        }),
        operation: {
          kind: 'create-workout',
          workoutId,
          planId: session.destinationPlanId,
          localDate: session.value.localDate,
          title,
          structure,
          confirmPlanRangeExtension: false,
        },
      }, 'save-workout');
      if (!response) return;
      this.editor.set(null);
      this.snackBar.open('Workout added.', 'Dismiss', { duration: 3000 });
      return;
    }

    const original = session.original!;
    const response = await this.runMutation({
      mutationId: this.plansService.createMutationId('update-workout'),
      expectedRevisions: this.expectedRevisions({
        workoutIds: [original.id],
        workoutRevisionOverrides: new Map([[original.id, session.originalWorkoutRevision!]]),
        planIds: [original.planId, session.destinationPlanId].filter((id): id is string => !!id),
      }),
      operation: {
        kind: 'update-workout',
        workoutId: original.id,
        planId: session.destinationPlanId,
        localDate: session.value.localDate,
        title,
        structure,
        confirmPlanRangeExtension: false,
      },
    }, 'save-workout');
    if (!response) return;
    this.editor.set(null);
    this.snackBar.open('Workout updated.', 'Dismiss', { duration: 3000 });
  }

  async copyWorkout(workout: ScheduledWorkoutV1): Promise<void> {
    const workoutId = this.plansService.createEntityId('workout');
    const planIds = workout.planId ? [workout.planId] : [];
    const response = await this.runMutation({
      mutationId: this.plansService.createMutationId('copy-workout'),
      expectedRevisions: this.expectedRevisions({
        workoutIds: [workout.id],
        workoutRevisionOverrides: new Map([[workout.id, workout.revision]]),
        planIds,
      }),
      operation: {
        kind: 'copy-workout',
        sourceWorkoutId: workout.id,
        workoutId,
        planId: workout.planId,
        localDate: workout.localDate,
        confirmPlanRangeExtension: false,
      },
    }, `copy-${workout.id}`);
    if (response) this.snackBar.open('Workout copied.', 'Dismiss', { duration: 3000 });
  }

  async setWorkoutSkipped(workout: ScheduledWorkoutV1, skipped: boolean): Promise<void> {
    const response = await this.runMutation({
      mutationId: this.plansService.createMutationId(skipped ? 'skip-workout' : 'unskip-workout'),
      expectedRevisions: this.expectedRevisions({
        workoutIds: [workout.id],
        workoutRevisionOverrides: new Map([[workout.id, workout.revision]]),
        planIds: workout.planId ? [workout.planId] : [],
      }),
      operation: { kind: 'set-workout-lifecycle', workoutId: workout.id, lifecycle: skipped ? 'skipped' : 'planned' },
    }, `skip-${workout.id}`);
    if (response) this.snackBar.open(skipped ? 'Workout marked skipped.' : 'Workout restored to planned.', 'Dismiss', { duration: 3000 });
  }

  async deleteWorkout(workout: ScheduledWorkoutV1): Promise<void> {
    const expectedRevisions = this.expectedRevisions({
      workoutIds: [workout.id],
      workoutRevisionOverrides: new Map([[workout.id, workout.revision]]),
      planIds: workout.planId ? [workout.planId] : [],
    });
    const confirmed = await this.confirm(
      'Delete workout?',
      'The workout will remain in history and can be restored.',
      'Delete workout',
      'warn',
    );
    if (!confirmed) return;
    const response = await this.runMutation({
      mutationId: this.plansService.createMutationId('delete-workout'),
      expectedRevisions,
      operation: { kind: 'delete-workout', workoutId: workout.id },
    }, `delete-${workout.id}`);
    if (response) this.snackBar.open('Workout deleted. Open history to restore it.', 'Dismiss', { duration: 5000 });
  }

  async permanentlyDeleteWorkout(workout: ScheduledWorkoutV1): Promise<void> {
    const expectedRevisions = this.expectedRevisions({
      workoutIds: [workout.id],
      workoutRevisionOverrides: new Map([[workout.id, workout.revision]]),
      planIds: workout.planId ? [workout.planId] : [],
    });
    const confirmed = await this.confirm(
      'Permanently delete workout?',
      workout.planId
        ? 'This removes the workout and prevents restoration. Its plan revision audit remains until the plan is deleted. This cannot be undone.'
        : 'This removes the workout and its standalone revision history. This cannot be undone.',
      'Delete permanently',
      'warn',
    );
    if (!confirmed) return;
    const response = await this.runMutation({
      mutationId: this.plansService.createMutationId('permanent-workout-delete'),
      expectedRevisions,
      operation: { kind: 'permanently-delete-workout', workoutId: workout.id, confirmPermanentDeletion: true },
    }, `permanent-${workout.id}`);
    if (response) this.snackBar.open('Workout permanently retired and can no longer be restored.', 'Dismiss', { duration: 4000 });
  }

  async openHistory(scope: TrainingScheduleRevisionScope): Promise<void> {
    this.historyPanel.set({ scope, status: 'loading', entries: [], nextBeforeRevision: null, error: null });
    try {
      const response = await this.plansService.getHistory({ scope, limit: 50 });
      this.historyPanel.set({
        scope,
        status: 'ready',
        entries: response.entries,
        nextBeforeRevision: response.nextBeforeRevision,
        error: null,
      });
    } catch (error) {
      this.historyPanel.set({
        scope,
        status: 'error',
        entries: [],
        nextBeforeRevision: null,
        error: errorMessage(error),
      });
    }
  }

  historyScopeForWorkout(workout: ScheduledWorkoutV1): TrainingScheduleRevisionScope {
    return workout.planId
      ? { kind: 'plan', id: workout.planId }
      : { kind: 'workout', id: workout.id };
  }

  async loadOlderHistory(): Promise<void> {
    const panel = this.historyPanel();
    if (!panel || panel.status !== 'ready' || panel.nextBeforeRevision === null) return;
    this.busyAction.set('history-older');
    try {
      const response = await this.plansService.getHistory({
        scope: panel.scope,
        beforeRevision: panel.nextBeforeRevision,
        limit: 50,
      });
      const current = this.historyPanel();
      if (!current || current.scope.kind !== panel.scope.kind || current.scope.id !== panel.scope.id) return;
      const entries = new Map(current.entries.map(entry => [entry.revision, entry]));
      response.entries.forEach(entry => entries.set(entry.revision, entry));
      this.historyPanel.set({
        ...current,
        entries: [...entries.values()].sort((left, right) => right.revision - left.revision),
        nextBeforeRevision: response.nextBeforeRevision,
      });
    } catch (error) {
      this.showError(error);
    } finally {
      this.busyAction.set(null);
    }
  }

  closeHistory(): void {
    this.historyPanel.set(null);
  }

  async restoreHistoryEntry(entry: TrainingScheduleHistoryEntryV1): Promise<void> {
    const panel = this.historyPanel();
    if (!panel) return;
    const expected = panel.scope.kind === 'workout'
      ? this.expectedRevisions({ workoutIds: [panel.scope.id] })
      : this.expectedRevisions({
        planIds: [
          panel.scope.id,
          ...(this.activePlan() && this.activePlan()!.id !== panel.scope.id ? [this.activePlan()!.id] : []),
        ],
      });
    this.busyAction.set(`restore-${entry.revision}`);
    try {
      const preview = await this.plansService.previewRestore({ scope: panel.scope, targetRevision: entry.revision });
      const changedCount = preview.changedPlanIds.length + preview.changedWorkoutIds.length;
      const warnings = preview.warnings.length ? ` ${preview.warnings.join(' ')}` : '';
      const confirmed = await this.confirm(
        `Restore revision ${entry.revision}?`,
        `This creates a new revision and changes ${changedCount} item${changedCount === 1 ? '' : 's'}.${warnings}`,
        'Restore revision',
      );
      if (!confirmed) return;
      const response = await this.plansService.restore({
        mutationId: this.plansService.createMutationId('restore-schedule'),
        expectedRevisions: expected,
        scope: panel.scope,
        targetRevision: entry.revision,
      });
      this.historyPanel.set(null);
      const skipped = response.skippedWorkoutIds.length;
      this.snackBar.open(
        skipped ? `Revision restored; ${skipped} workout${skipped === 1 ? '' : 's'} left unchanged.` : 'Revision restored.',
        'Dismiss',
        { duration: 6000 },
      );
    } catch (error) {
      this.showError(error);
    } finally {
      this.busyAction.set(null);
    }
  }

  private expectedRevisions(options: {
    planIds?: string[];
    workoutIds?: string[];
    planRevisionOverrides?: ReadonlyMap<string, number>;
    workoutRevisionOverrides?: ReadonlyMap<string, number>;
  }): ExpectedTrainingScheduleRevision[] {
    return expectedRevisionsFromSchedule(this.schedule(), options);
  }

  private async runMutation(
    request: MutateTrainingScheduleRequestV1,
    action: string,
  ): Promise<MutateTrainingScheduleResponseV1 | null> {
    this.busyAction.set(action);
    try {
      return await this.plansService.mutate(request);
    } catch (error) {
      const message = errorMessage(error);
      if (/requires extending/i.test(message) && 'confirmPlanRangeExtension' in request.operation) {
        const confirmed = await this.confirm('Extend plan dates?', message, 'Extend and continue');
        if (confirmed) {
          return await this.plansService.mutate({
            ...request,
            operation: { ...request.operation, confirmPlanRangeExtension: true },
          } as MutateTrainingScheduleRequestV1);
        }
        return null;
      }
      this.showError(error);
      return null;
    } finally {
      this.busyAction.set(null);
    }
  }

  private async confirm(
    title: string,
    message: string,
    confirmText: string,
    confirmColor: 'primary' | 'accent' | 'warn' = 'primary',
  ): Promise<boolean> {
    const reference = this.dialog.open(ConfirmationDialogComponent, {
      data: { title, message, confirmText, confirmColor },
    });
    return new Promise(resolve => reference.afterClosed().subscribe(value => resolve(value === true)));
  }

  private showError(error: unknown): void {
    this.snackBar.open(errorMessage(error), 'Dismiss', { duration: 7000 });
  }

  private nextNodeId(prefix: 'step' | 'repeat'): string {
    this.nodeSequence += 1;
    return `${prefix}-${Date.now().toString(36)}-${this.nodeSequence}`;
  }
}

function expectedRevisionsFromSchedule(
  schedule: CurrentTrainingScheduleV1,
  options: {
    planIds?: string[];
    workoutIds?: string[];
    planRevisionOverrides?: ReadonlyMap<string, number>;
    workoutRevisionOverrides?: ReadonlyMap<string, number>;
  },
): ExpectedTrainingScheduleRevision[] {
  const expected: ExpectedTrainingScheduleRevision[] = [
    { scope: 'state', id: 'current', revision: schedule.state.revision },
  ];
  [...new Set(options.planIds ?? [])].forEach((planId) => {
    const plan = schedule.plans.find(candidate => candidate.id === planId);
    if (plan) expected.push({
      scope: 'plan',
      id: plan.id,
      revision: options.planRevisionOverrides?.get(plan.id) ?? plan.revision,
    });
  });
  [...new Set(options.workoutIds ?? [])].forEach((workoutId) => {
    const workout = schedule.workouts.find(candidate => candidate.id === workoutId);
    if (workout) expected.push({
      scope: 'workout',
      id: workout.id,
      revision: options.workoutRevisionOverrides?.get(workout.id) ?? workout.revision,
    });
  });
  if (expected.length > 4) throw new Error('This change requires too many concurrent revision checks.');
  return expected;
}

function errorMessage(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message === 'string' && message.trim()) {
    return message.replace(/^FirebaseError:\s*/i, '').replace(/^functions\/[^:]+:\s*/i, '');
  }
  return 'The training schedule could not be updated. Try again.';
}

function todayLocalDate(now = new Date()): string {
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function defaultPlanDraft(now = new Date()): PlanDraft {
  const startLocalDate = todayLocalDate(now);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 27);
  return {
    name: '',
    startLocalDate,
    endLocalDate: todayLocalDate(end),
    activate: true,
  };
}
