import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { DataInterface } from '@sports-alliance/sports-lib';
import { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { DynamicDataLoader } from '@sports-alliance/sports-lib';

@Component({
  selector: 'app-header-stats',
  templateUrl: './header-stats.component.html',
  styleUrls: ['./header-stats.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class HeaderStatsComponent implements OnChanges {
  @Input() statsToShow: string[];
  @Input() stats: DataInterface[] = [];
  @Input() unitSettings?: UserUnitSettingsInterface;
  @Input() layout: 'grid' | 'condensed' = 'grid';
  public displayedStats: DataInterface[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.statsToShow || !this.stats) {
      this.displayedStats = [];
      return;
    }

    // Create a map for O(1) lookups
    const statsMap = new Map<string, DataInterface>();
    this.stats.forEach(stat => statsMap.set(stat.getType(), stat));

    const enrichedStats: DataInterface[] = [];
    this.statsToShow.forEach(statType => {
      const stat = statsMap.get(statType);
      if (stat) {
        // This expands the stat into unit-based versions (e.g. Speed -> Speed and Pace)
        const unitBasedStats = DynamicDataLoader.getUnitBasedDataFromDataInstance(stat, this.unitSettings);
        enrichedStats.push(...unitBasedStats);
      }
    });

    this.displayedStats = enrichedStats;
  }


}
