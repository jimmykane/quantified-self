import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { ServiceConnectionAccountProjection } from '@shared/service-connection';
import { buildGarminPermissionAccounts } from '../../../helpers/garmin-permissions.helper';
import { CompactRowComponent } from '../../shared/compact-row/compact-row.component';

@Component({
  selector: 'app-garmin-permissions',
  standalone: true,
  imports: [CompactRowComponent],
  templateUrl: './garmin-permissions.component.html',
  styleUrl: './garmin-permissions.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GarminPermissionsComponent {
  readonly accounts = input<readonly ServiceConnectionAccountProjection[] | undefined>();
  readonly loading = input(false);
  readonly permissionAccounts = computed(() => this.loading() ? [] : buildGarminPermissionAccounts(this.accounts()));
}
