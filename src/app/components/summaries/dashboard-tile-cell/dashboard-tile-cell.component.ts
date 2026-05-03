import { ChangeDetectionStrategy, Component, HostBinding, Input } from '@angular/core';

@Component({
  selector: 'app-dashboard-tile-cell',
  templateUrl: './dashboard-tile-cell.component.html',
  styleUrls: ['./dashboard-tile-cell.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class DashboardTileCellComponent {
  @Input() columns: number | string | null = 1;
  @Input() rows: number | string | null = 1;
  @Input() maxColumns: number | string | null = null;

  @HostBinding('class.dashboard-grid-tile')
  readonly dashboardGridTileClass = true;

  @HostBinding('style.grid-column')
  get gridColumn(): string {
    return `span ${this.resolvedColumns}`;
  }

  @HostBinding('style.grid-row')
  get gridRow(): string {
    return `span ${this.normalizePositiveInteger(this.rows, 1)}`;
  }

  private get resolvedColumns(): number {
    const columns = this.normalizePositiveInteger(this.columns, 1);
    const maxColumns = this.normalizePositiveInteger(this.maxColumns, columns);
    return Math.min(columns, maxColumns);
  }

  private normalizePositiveInteger(value: number | string | null, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return fallback;
    }

    return Math.floor(parsed);
  }
}
