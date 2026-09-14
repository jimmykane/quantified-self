import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { catchError, combineLatest, of, startWith, switchMap } from 'rxjs';
import { PLANNED_WORKOUT_PROVIDER_IDS, PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1 } from '@shared/planned-workout-providers';
import { SharedModule } from '../../modules/shared.module';
import { AppUserService } from '../../services/app.user.service';
import { TrainingDeliveryService, type TrainingDeliveryViewScope } from '../../services/training-delivery.service';
import { TrainingDeliveryDialogComponent, type TrainingDeliveryDialogData } from './training-delivery-dialog.component';

@Component({ selector: 'app-training-delivery-button', standalone: true, imports: [SharedModule],
  templateUrl: './training-delivery-button.component.html', changeDetection: ChangeDetectionStrategy.OnPush })
export class TrainingDeliveryButtonComponent {
  readonly scope = input.required<TrainingDeliveryViewScope>();
  readonly entityId = input.required<string>();
  readonly title = input.required<string>();
  readonly standalone = input(false);
  readonly context = computed<TrainingDeliveryDialogData>(() => ({ scope: this.scope(), id: this.entityId(), title: this.title() }));
  readonly disabled = input(false);
  private readonly users = inject(AppUserService);
  private readonly delivery = inject(TrainingDeliveryService);
  private readonly dialog = inject(MatDialog);
  readonly hasRecords = toSignal(combineLatest([this.users.user$, toObservable(this.context)]).pipe(
    switchMap(([user, scope]) => user?.uid ? this.delivery.watchPresence(user.uid, scope.scope, scope.id).pipe(
      startWith(false), catchError(() => of(true))) : of(false))), { initialValue: false });
  readonly visible = computed(() => !!this.users.user()?.uid
    && ((this.scope() !== 'history' && this.delivery.anyReady()) || this.hasRecords()));
  readonly singleProvider = computed(() => {
    const providers = PLANNED_WORKOUT_PROVIDER_IDS.filter(provider => this.delivery.isReady(provider));
    return providers.length === 1 ? providers[0] : null;
  });
  readonly buttonLabel = computed(() => {
    if (this.scope() === 'history') return 'Delivery history';
    if (this.hasRecords()) return 'Sync details';
    const provider = this.singleProvider();
    const label = provider ? PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1[provider].label : null;
    return this.scope() === 'plan' ? label ? `Sync with ${label}` : 'Sync workouts'
      : this.standalone() ? label ? `Send to ${label}` : 'Send workout' : 'Sync details';
  });
  open(): void {
    if (!this.visible() || this.disabled()) return;
    const provider = this.singleProvider();
    const data: TrainingDeliveryDialogData = { ...this.context(),
      ...(!this.hasRecords() && provider && (this.scope() === 'plan' || this.standalone()) ? { initialProvider: provider } : {}) };
    this.dialog.open(TrainingDeliveryDialogComponent, { data, width: '640px', maxWidth: '95vw' });
  }
}
