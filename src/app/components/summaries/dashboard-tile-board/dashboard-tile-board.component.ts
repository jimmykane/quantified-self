import { afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostBinding, inject, Input } from '@angular/core';
import { alignDashboardChartPlots, hasDashboardChartLayoutChanges } from '../../../helpers/dashboard-chart-layout.helper';
import { CoalescedFrameTask } from '../../../helpers/coalesced-frame-task';
import { BrowserCompatibilityService } from '../../../services/browser.compatibility.service';

@Component({
  selector: 'app-dashboard-tile-board',
  templateUrl: './dashboard-tile-board.component.html',
  styleUrls: ['./dashboard-tile-board.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class DashboardTileBoardComponent {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // Presentation only: no settings writes or chart/data lifecycle ownership.
    afterNextRender(() => {
      const board = this.element.nativeElement;
      const observed = new Set<Element>();
      const task = new CoalescedFrameTask(() => {
        const plots = alignDashboardChartPlots(board, this.normalizePositiveInteger(this.cols, 1) > 1);
        const targets = new Set<Element>([board, ...plots, ...Array.from(board.children)]);
        for (const target of observed) {
          if (!targets.has(target)) { resize?.unobserve(target); observed.delete(target); }
        }
        for (const target of targets) {
          if (!observed.has(target)) { resize?.observe(target); observed.add(target); }
        }
      });
      const resize = BrowserCompatibilityService.checkResizeObserverSupport()
        ? new ResizeObserver(() => task.request()) : null;
      const mutations = new MutationObserver(records => {
        if (hasDashboardChartLayoutChanges(board, records)) task.request();
      });
      mutations.observe(board, { childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ['data-dashboard-chart-heading-height', 'data-dashboard-chart-footer-height'] });
      const onResize = () => task.request();
      window.addEventListener('resize', onResize);
      task.request();
      this.destroyRef.onDestroy(() => {
        resize?.disconnect();
        mutations.disconnect();
        window.removeEventListener('resize', onResize);
        task.dispose();
      });
    });
  }

  @HostBinding('class.qs-glass-card-panel')
  readonly glassPanelClass = true;

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

  @HostBinding('style.--dashboard-tile-board-divider')
  get boardDivider(): string {
    return '1px solid var(--qs-glass-panel-border, var(--mat-sys-outline-variant))';
  }

  @HostBinding('style.--dashboard-tile-cell-inline-divider')
  get boardInlineDivider(): string {
    return this.normalizePositiveInteger(this.cols, 1) > 1
      ? 'var(--dashboard-tile-board-divider)'
      : '0';
  }

  private normalizePositiveInteger(value: number | string | null, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return fallback;
    }

    return Math.floor(parsed);
  }
}
