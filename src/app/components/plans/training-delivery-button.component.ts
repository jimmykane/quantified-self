import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { catchError, combineLatest, of, startWith, switchMap } from 'rxjs';
import { SharedModule } from '../../modules/shared.module';
import { AppUserService } from '../../services/app.user.service';
import { TrainingDeliveryService } from '../../services/training-delivery.service';
import { TrainingDeliveryDialogComponent, type TrainingDeliveryDialogData } from './training-delivery-dialog.component';
import type { TrainingDeliveryScope } from '@shared/training-provider-delivery';

@Component({ selector: 'app-training-delivery-button', standalone: true, imports: [SharedModule],
  templateUrl: './training-delivery-button.component.html', changeDetection: ChangeDetectionStrategy.OnPush })
export class TrainingDeliveryButtonComponent {
  readonly scope = input.required<TrainingDeliveryScope>();
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
  readonly visible = computed(() => !!this.users.user()?.uid && (this.delivery.anyReady || this.hasRecords()));
  open(): void {
    if (!this.users.user()?.uid || this.disabled()) return;
    this.dialog.open(TrainingDeliveryDialogComponent, { data: this.context(), width: '640px', maxWidth: '95vw' });
  }
}
