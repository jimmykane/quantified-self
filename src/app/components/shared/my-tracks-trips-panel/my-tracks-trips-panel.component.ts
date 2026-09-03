import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { AppMyTracksTripSortDirection } from '../../../models/app-user.interface';
import type { DetectedHomeArea, DetectedTrip } from '../../../services/my-tracks-trip-detection.service';

export interface MyTracksTripPanelItem extends DetectedTrip {
  locationLabel: string | null;
}

@Component({
  selector: 'app-my-tracks-trips-panel',
  templateUrl: './my-tracks-trips-panel.component.html',
  styleUrls: ['./my-tracks-trips-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class MyTracksTripsPanelComponent {
  readonly trips = input.required<readonly MyTracksTripPanelItem[]>();
  readonly homeArea = input<DetectedHomeArea | null>(null);
  readonly selectedTripId = input<string | null>(null);
  readonly homeSelected = input(false);
  readonly expanded = input(false);
  readonly expandedSizePx = input(300);
  readonly title = input('Trips');
  readonly sortDirection = input<AppMyTracksTripSortDirection>('desc');

  readonly panelExpandedChange = output<boolean>();
  readonly sortToggle = output<void>();
  readonly tripSelected = output<MyTracksTripPanelItem>();
  readonly tripHovered = output<MyTracksTripPanelItem>();
  readonly tripHoverEnded = output<MyTracksTripPanelItem>();
  readonly homeSelectedChange = output<void>();
  readonly homeHovered = output<void>();
  readonly homeHoverEnded = output<void>();

  readonly sortIcon = computed(() => this.sortDirection() === 'desc' ? 'south' : 'north');
  readonly sortToggleLabel = computed(() => (
    this.sortDirection() === 'desc'
      ? 'Showing newest trips first. Show oldest trips first.'
      : 'Showing oldest trips first. Show newest trips first.'
  ));
}
