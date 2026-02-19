import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

export interface SummaryPrimaryInfoMetric {
  value: string;
  label: string;
}

@Component({
  selector: 'app-summary-primary-info',
  templateUrl: './summary-primary-info.component.html',
  styleUrls: ['./summary-primary-info.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class SummaryPrimaryInfoComponent {
  @Input() activityType = '';
  @Input() iconActivityType = '';
  @Input() startDate: number | Date | null | undefined = null;
  @Input() fallbackTopMetaText = 'Activity start';
  @Input() metrics: SummaryPrimaryInfoMetric[] = [];
  @Input() iconTooltip = '';
  @Input() iconClickable = false;

  @Input() forceMobileLayout = false;

  @Output() iconClick = new EventEmitter<void>();

  public onIconContainerClick(): void {
    if (!this.iconClickable) return;
    this.iconClick.emit();
  }

  public get resolvedIconActivityType(): string {
    if (typeof this.iconActivityType === 'string' && this.iconActivityType.trim().length > 0) {
      return this.iconActivityType.trim();
    }
    if (typeof this.activityType === 'string' && this.activityType.trim().length > 0) {
      return this.activityType.trim();
    }
    return 'Other';
  }
}
