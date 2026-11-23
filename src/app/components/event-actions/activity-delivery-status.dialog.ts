import { AsyncPipe, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AppHapticsService } from '../../services/app.haptics.service';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { Auth, user } from 'app/firebase/auth';
import { Firestore, collection, documentId, getDocsFromServer, query, where } from 'app/firebase/firestore';
import { Subject, catchError, from, map, of, startWith, switchMap } from 'rxjs';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ACTIVITY_SYNC_ROUTES, HISTORICAL_MANUAL_ACTIVITY_ROUTES } from '@shared/activity-sync-routes';
import { getProviderDisplayName } from '@shared/provider-presentation';

const routes = Object.values({ ...ACTIVITY_SYNC_ROUTES, ...HISTORICAL_MANUAL_ACTIVITY_ROUTES });
const byDocument = new Map(routes.map(route => ['activitySync_' + route.id, route]));
export function deliveryLabel(row: Record<string, unknown>): string {
  const error = row['lastError'] as { message?: string } | null;
  switch (row['status']) {
    case 'success': return row['infoCode'] === 'ALREADY_EXISTS' ? 'Already at destination' : 'Delivered';
    case 'queued': return 'Queued';
    case 'processing': return 'Sending';
    case 'retrying':
      for (const provider of Object.values(ServiceNames)) {
        if (error?.message === `Reconnect ${provider} to resume this activity delivery.`) return 'Reconnect in Connections';
        if (error?.message === `${provider} disconnect is pending.`) return 'Waiting for disconnect';
      }
      return 'Waiting to retry';
    case 'skipped':
      if (['destination_auth_failed', 'destination_not_connected', 'destination_permission_required'].includes(String(row['skippedReason']))) return 'Check destination connection';
      return 'Skipped';
    case 'failed': return 'Needs attention';
    default: return 'Status unavailable';
  }
}

@Component({
  standalone: true,
  imports: [AsyncPipe, DatePipe, MatButtonModule, MatDialogModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './activity-delivery-status.dialog.html',
})
export class ActivityDeliveryStatusDialog {
  private readonly data = inject<{owner: string; id: string}>(MAT_DIALOG_DATA);
  private readonly db = inject(Firestore);
  readonly haptics = inject(AppHapticsService);
  private readonly refresh = new Subject<void>();

  checkAgain(): void {
    this.haptics.selection();
    this.refresh.next();
  }

  readonly view = user(inject(Auth)).pipe(switchMap(account => {
    if (!account || account.uid !== this.data.owner) return of({ state: 'forbidden' } as const);
    return this.refresh.pipe(startWith(undefined), switchMap(() => {
      const records = collection(this.db, 'users', account.uid, 'events', this.data.id, 'metaData');
      return from(getDocsFromServer(query(records, where(documentId(), 'in', [...byDocument.keys()])))).pipe(
        map(snapshot => ({ state: 'ready', rows: snapshot.docs.map(doc => {
          const route = byDocument.get(doc.id)!;
          const row = doc.data();
          return {
            direction: (route.sourceServiceName === 'manualUpload' ? 'File upload' : getProviderDisplayName(route.sourceServiceName))
              + ' → ' + getProviderDisplayName(route.destinationServiceName, 'destination'),
            label: deliveryLabel(row),
            updated: row['updatedAt']?.toMillis?.() as number | undefined,
          };
        }) } as const)),
        catchError(() => of({ state: 'unavailable' } as const)),
        startWith({ state: 'loading' } as const),
      );
    }));
  }));
}
