import { ChangeDetectionStrategy, Component, HostBinding, Input } from '@angular/core';

@Component({
  selector: 'app-dashboard-tile-board',
  templateUrl: './dashboard-tile-board.component.html',
  styleUrls: ['./dashboard-tile-board.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class DashboardTileBoardComponent {
  @Input() cols: number | string | null = 1;
  @Input() rowHeight: string | null = null;

  @HostBinding('style.--dashboard-tile-board-cols')
  get boardColumns(): string {
    return `${this.normalizePositiveInteger(this.cols, 1)}`;
  }

  @HostBinding('style.--dashboard-tile-board-row-height')
  get boardRowHeight(): string {
    return this.rowHeight || '150px';
  }

  private normalizePositiveInteger(value: number | string | null, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return fallback;
    }

    return Math.floor(parsed);
  }
}
