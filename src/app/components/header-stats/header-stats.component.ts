import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { DataInterface } from '@sports-alliance/sports-lib';
import { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { DynamicDataLoader } from '@sports-alliance/sports-lib';
import { buildHeaderStatCards, HeaderStatCard } from '../../helpers/header-stats-composite.helper';
import { normalizeUnitDerivedStatLabel } from '../../helpers/stat-label.helper';

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
  private compositeUnitByCardId = new Map<string, string>();
  private hasCompositeDiffByCardId = new Map<string, boolean>();

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.statsToShow || !this.stats) {
      this.displayedStats = [];
      this.displayedStatCards = [];
      this.compositeUnitByCardId.clear();
      this.hasCompositeDiffByCardId.clear();
      return;
    }

    const shouldRebuildStats =
      !this.displayedStats.length
      || !!changes['statsToShow']
      || !!changes['stats']
      || !!changes['unitSettings']
      || !!changes['singleValueTypes'];

    if (shouldRebuildStats) {
      this.rebuildDisplayedStatsAndCards();
    }

    if (shouldRebuildStats || !!changes['showDiff'] || !!changes['diffByType']) {
      this.rebuildCompositeCardCaches();
    }
  }

  getDiffForStat(stat: DataInterface) {
    return this.getDiffForType(stat.getType());
  }

  getDiffForType(statType: string) {
    if (!this.showDiff || !this.diffByType) {
      return null;
    }
    const diff = this.diffByType.get(statType);
    if (!diff) {
      return null;
    }
    if (this.isInvalidDisplayToken(diff.display)) {
      return null;
    }
    if (!Number.isFinite(diff.percent)) {
      return null;
    }
    return diff;
  }

  getNormalizedStatLabel(stat: DataInterface) {
    return normalizeUnitDerivedStatLabel(stat);
  }

  getCompositeUnit(card: HeaderStatCard): string {
    const cached = this.compositeUnitByCardId.get(card.id);
    if (cached !== undefined) {
      return cached;
    }
    const resolved = this.resolveCompositeUnit(card);
    this.compositeUnitByCardId.set(card.id, resolved);
    return resolved;
  }

  hasCompositeDiff(card: HeaderStatCard): boolean {
    const cached = this.hasCompositeDiffByCardId.get(card.id);
    if (cached !== undefined) {
      return cached;
    }
    const resolved = this.computeHasCompositeDiff(card);
    this.hasCompositeDiffByCardId.set(card.id, resolved);
    return resolved;
  }

  getCompositeDeltaDisplay(display: string, unit: string): string {
    const normalizedDisplay = String(display ?? '').trim();
    const normalizedUnit = String(unit ?? '').trim();
    if (!normalizedDisplay || !normalizedUnit) {
      return normalizedDisplay;
    }

    const lowerDisplay = normalizedDisplay.toLowerCase();
    const lowerUnit = normalizedUnit.toLowerCase();
    const spacedUnitSuffix = ` ${lowerUnit}`;

    if (lowerDisplay.endsWith(spacedUnitSuffix)) {
      return normalizedDisplay.slice(0, normalizedDisplay.length - spacedUnitSuffix.length).trim();
    }

    if (lowerDisplay.endsWith(lowerUnit)) {
      return normalizedDisplay.slice(0, normalizedDisplay.length - lowerUnit.length).trim();
    }

    return normalizedDisplay;
  }

  private isInvalidDisplayToken(value: unknown): boolean {
    if (typeof value === 'number') {
      return !Number.isFinite(value);
    }
    if (value === null || value === undefined) {
      return false;
    }
    const normalized = String(value).trim();
    if (!normalized) {
      return false;
    }
    return /\bnan\b/i.test(normalized);
  }

  private rebuildDisplayedStatsAndCards(): void {
    // Create a map for O(1) lookups.
    const statsMap = new Map<string, DataInterface>();
    this.stats.forEach((stat) => statsMap.set(stat.getType(), stat));

    // Expand all available stats once so tab-local families can pull avg/min/max siblings.
    const expandedStatsMap = new Map<string, DataInterface>();
    this.stats.forEach((stat) => {
      const expanded = DynamicDataLoader.getUnitBasedDataFromDataInstance(stat, this.unitSettings);
      expanded.forEach((expandedStat) => expandedStatsMap.set(expandedStat.getType(), expandedStat));
    });

    const enrichedStats: DataInterface[] = [];
    this.statsToShow.forEach((statType) => {
      const stat = statsMap.get(statType);
      if (!stat) {
        return;
      }
      // Expand each requested stat into unit-aware variants (for example speed and pace).
      const unitBasedStats = DynamicDataLoader.getUnitBasedDataFromDataInstance(stat, this.unitSettings);
      enrichedStats.push(...unitBasedStats);
    });

    this.displayedStats = enrichedStats;

    this.displayedStatCards = buildHeaderStatCards(this.displayedStats, expandedStatsMap, this.singleValueTypes)
      .map((card) => ({
        ...card,
        valueItems: card.valueItems.filter((valueItem) => !this.isInvalidDisplayToken(valueItem.displayValue)),
      }))
      .filter((card) => card.valueItems.length > 0);
  }

  private rebuildCompositeCardCaches(): void {
    this.compositeUnitByCardId.clear();
    this.hasCompositeDiffByCardId.clear();
    this.displayedStatCards.forEach((card) => {
      this.compositeUnitByCardId.set(card.id, this.resolveCompositeUnit(card));
      this.hasCompositeDiffByCardId.set(card.id, this.computeHasCompositeDiff(card));
    });
  }

  private resolveCompositeUnit(card: HeaderStatCard): string {
    if (!card.isComposite || !card.valueItems.length) {
      return '';
    }

    const nonEmptyUnits = card.valueItems
      .map((item) => item.displayUnit?.trim())
      .filter((unit): unit is string => !!unit);

    if (!nonEmptyUnits.length) {
      return '';
    }

    const uniqueUnits = [...new Set(nonEmptyUnits).values()];
    return uniqueUnits[0];
  }

  private computeHasCompositeDiff(card: HeaderStatCard): boolean {
    if (!this.showDiff || !this.diffByType || !card?.isComposite) {
      return false;
    }
    return card.valueItems.some((item) => !!this.getDiffForType(item.type));
  }

}
