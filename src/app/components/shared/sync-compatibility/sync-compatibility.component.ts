import { Component, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { getActivitySyncRouteId } from '@shared/activity-sync-routes';
import { getRouteDeliverySyncRouteId } from '@shared/route-delivery-sync-routes';
import { CompactSelectComponent } from '../compact-select/compact-select.component';
import { AppHapticsService } from '../../../services/app.haptics.service';

const PROVIDERS = [
  { value: ServiceNames.GarminAPI, label: 'Garmin' }, { value: ServiceNames.SuuntoApp, label: 'Suunto' },
  { value: ServiceNames.COROSAPI, label: 'COROS' }, { value: ServiceNames.WahooAPI, label: 'Wahoo' },
];
@Component({ selector: 'app-sync-compatibility', standalone: true, imports: [CompactSelectComponent, MatButtonModule],
  templateUrl: './sync-compatibility.component.html', styleUrl: './sync-compatibility.component.scss' })
export class SyncCompatibilityComponent {
  readonly expanded = input(false);
  readonly opened = signal(false);
  readonly visible = computed(() => this.expanded() || this.opened());
  readonly source = signal(ServiceNames.GarminAPI);
  readonly destination = signal(ServiceNames.SuuntoApp);
  readonly providers = PROVIDERS;
  readonly destinations = computed(() => PROVIDERS.filter(p => p.value !== this.source()));
  readonly activities = computed(() => !!getActivitySyncRouteId(this.source(), this.destination()));
  readonly routes = computed(() => !!getRouteDeliverySyncRouteId(this.source(), this.destination()));
  readonly destinationLabel = computed(() => PROVIDERS.find(p => p.value === this.destination())!.label);
  readonly sourceLabel = computed(() => PROVIDERS.find(p => p.value === this.source())!.label);
  readonly garmin = ServiceNames.GarminAPI;
  readonly coros = ServiceNames.COROSAPI;
  private readonly haptics = inject(AppHapticsService);
  toggle(): void { this.opened.update(value => !value); this.haptics.selection(); }
  chooseSource(value: ServiceNames): void {
    if (value === this.source() || !PROVIDERS.some(p => p.value === value)) return;
    this.source.set(value);
    if (this.destination() === value) this.destination.set(this.destinations()[0].value);
    this.haptics.selection();
  }
  chooseDestination(value: ServiceNames): void {
    if (value === this.destination() || !this.destinations().some(p => p.value === value)) return;
    this.destination.set(value); this.haptics.selection();
  }
}
