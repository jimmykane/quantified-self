import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { EventInterface, User } from '@sports-alliance/sports-lib';
import { SummaryPrimaryInfoMetric } from '../summary-primary-info/summary-primary-info.component';

@Component({
  selector: 'app-map-activity-popup',
  templateUrl: './map-activity-popup.component.html',
  styleUrls: ['./map-activity-popup.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class MapActivityPopupComponent {
  @Input() activityType = 'Activity';
  @Input() iconActivityType = 'Other';
  @Input() startDate: number | Date | null | undefined = null;
  @Input() fallbackTopMetaText = 'Activity start';
  @Input() metrics: SummaryPrimaryInfoMetric[] = [];
  @Input() event?: EventInterface | null;
  @Input() user?: User | null;
  @Input() actionLabel = 'Open activity';
  @Input() dismissible = false;
  @Input() forceMobileLayout = true;

  @Output() actionClick = new EventEmitter<void>();
  @Output() dismiss = new EventEmitter<void>();

  public onActionClick(): void {
    this.actionClick.emit();
  }

  public onDismiss(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dismiss.emit();
  }
}
