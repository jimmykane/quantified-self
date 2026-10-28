import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { ActivityTypes } from '@sports-alliance/sports-lib';

/** Compact trigger retained for tile headers; selection is shared with the full sport field. */
@Component({
  selector: 'app-activity-types-filter-menu',
  templateUrl: './activity-types-filter-menu.component.html',
  styleUrls: ['./activity-types-filter-menu.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class ActivityTypesFilterMenuComponent {
  @Input() selectedActivityTypes: ActivityTypes[] = [];
  @Input() availableActivityTypes: ActivityTypes[] | null | undefined;
  @Input() disabled = false;
  @Input() ariaLabel = 'Filter activities';
  @Output() selectedActivityTypesChange = new EventEmitter<ActivityTypes[]>();
}
