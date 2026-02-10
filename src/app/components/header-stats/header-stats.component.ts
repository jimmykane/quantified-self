import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { DataInterface } from '@sports-alliance/sports-lib';
import { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { DynamicDataLoader } from '@sports-alliance/sports-lib';
import { buildHeaderStatCards, HeaderStatCard } from '../../helpers/header-stats-composite.helper';

@Component({
  selector: 'app-header-stats',
  templateUrl: './header-stats.component.html',
  styleUrls: ['./header-stats.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class HeaderStatsComponent implements OnChanges {
  @Input() statsToShow: string[];
  @Input() stats: DataInterface[] = [];
  @Input() singleValueTypes: string[] = [];
  @Input() unitSettings?: UserUnitSettingsInterface;
  @Input() layout: 'grid' | 'condensed' = 'grid';
  @Input() showDiff = false;
  @Input() diffByType?: Map<string, { display: string; percent: number; color: string }>;
  public displayedStats: DataInterface[] = [];
  public displayedStatCards: HeaderStatCard[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.statsToShow || !this.stats) {
      this.displayedStats = [];
      this.displayedStatCards = [];
      return;
    }

    // Create a map for O(1) lookups
    const statsMap = new Map<string, DataInterface>();
    this.stats.forEach(stat => statsMap.set(stat.getType(), stat));

    // Expand all available stats once so tab-local families can pull avg/min/max siblings.
    const expandedStatsMap = new Map<string, DataInterface>();
    this.stats.forEach((stat) => {
      const expanded = DynamicDataLoader.getUnitBasedDataFromDataInstance(stat, this.unitSettings);
      expanded.forEach((expandedStat) => expandedStatsMap.set(expandedStat.getType(), expandedStat));
    });

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
    this.displayedStatCards = buildHeaderStatCards(this.displayedStats, expandedStatsMap, this.singleValueTypes);
  }

  getDiffForStat(stat: DataInterface) {
    return this.getDiffForType(stat.getType());
  }

  getDiffForType(statType: string) {
    if (!this.showDiff || !this.diffByType) {
      return null;
    }
    return this.diffByType.get(statType) || null;
  }


}
