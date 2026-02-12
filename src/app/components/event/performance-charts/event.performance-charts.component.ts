import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { ActivityInterface, ChartThemes } from '@sports-alliance/sports-lib';

@Component({
  selector: 'app-event-performance-charts',
  templateUrl: './event.performance-charts.component.html',
  styleUrls: ['./event.performance-charts.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class EventPerformanceChartsComponent {
  @Input() activities: ActivityInterface[] = [];
  @Input() chartTheme: ChartThemes = ChartThemes.Material;
  @Input() useAnimations = false;
  @Input() isMerge = false;

  @Input() hasIntensity = false;
  @Input() hasPowerCurve = false;

  get shouldShowTabs(): boolean {
    return this.hasIntensity && this.hasPowerCurve;
  }
}
