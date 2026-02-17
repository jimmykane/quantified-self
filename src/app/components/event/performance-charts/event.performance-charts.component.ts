import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { ActivityInterface, ChartThemes } from '@sports-alliance/sports-lib';

type PerformanceTabId = 'intensity' | 'powerCurve' | 'durability' | 'cadencePower';

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
  @Input() hasDurability = false;
  @Input() hasCadencePower = false;

  get shouldShowTabs(): boolean {
    return this.availableTabs.length > 1;
  }

  get singleChartTab(): PerformanceTabId | null {
    return this.availableTabs.length === 1
      ? this.availableTabs[0]
      : null;
  }

  get availableTabs(): PerformanceTabId[] {
    const tabs: PerformanceTabId[] = [];
    if (this.hasIntensity) {
      tabs.push('intensity');
    }
    if (this.hasPowerCurve) {
      tabs.push('powerCurve');
    }
    if (this.hasDurability) {
      tabs.push('durability');
    }
    if (this.hasCadencePower) {
      tabs.push('cadencePower');
    }
    return tabs;
  }

  getTabLabel(tab: PerformanceTabId): string {
    if (tab === 'intensity') {
      return 'Intensity';
    }
    if (tab === 'powerCurve') {
      return 'Power Curve';
    }
    if (tab === 'durability') {
      return 'Durability';
    }
    return 'Cadence vs Power';
  }

  getTabIcon(tab: PerformanceTabId): string {
    if (tab === 'intensity') {
      return 'stacked_bar_chart';
    }
    if (tab === 'powerCurve') {
      return 'line_curve';
    }
    if (tab === 'durability') {
      return 'line_axis';
    }
    return 'key_visualizer';
  }
}
