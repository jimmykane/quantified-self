import { trainingStateChartGrid, TRAINING_STATE_PLOT_BOTTOM } from './training-state-chart-layout.helper';

const OFFSET_PROPERTY = '--qs-dashboard-chart-header-offset';
const FOOTER_PROPERTY = '--qs-dashboard-chart-footer-offset';
// Flex layout quantizes fractional pixels. Do not feed that rounding back into
// ResizeObserver by repeatedly rewriting visually identical alignment offsets.
const ALIGNMENT_EPSILON_PX = 0.5;

/** Canvas rendering and touch tooltips cannot change their size-contained frame. */
export function hasDashboardChartLayoutChanges(board: HTMLElement, mutations: readonly MutationRecord[]): boolean {
  return mutations.some(mutation => {
    // A removal is covered by its parent's childList record. Ignore subsequent
    // chart/tooltip edits in the detached subtree delivered in the same batch.
    if (!board.contains(mutation.target)) return false;
    // The observer only subscribes to plot participation and heading/legend slots.
    if (mutation.type === 'attributes') return true;
    const target = mutation.target.nodeType === Node.ELEMENT_NODE
      ? mutation.target as Element : mutation.target.parentElement;
    return !target?.closest('[data-dashboard-chart-plot], [data-dashboard-chart-canvas]');
  });
}

/** Match the data rectangle while reserving only a chart's actual legend. */
export function dashboardChartFrameGrid(
  canvas: HTMLElement,
  options: { heading?: number; legendTop?: number; legendBottom?: number } = {},
) {
  if (!canvas?.closest('.dashboard-chart-frame')) return {};
  const heading = (options.heading || 0) + (options.legendTop || 0);
  const footer = options.legendBottom || 0;
  if (canvas.dataset.dashboardChartHeadingHeight !== `${heading}`) canvas.dataset.dashboardChartHeadingHeight = `${heading}`;
  if (canvas.dataset.dashboardChartFooterHeight !== `${footer}`) canvas.dataset.dashboardChartFooterHeight = `${footer}`;
  const extra = `${heading + footer}px`;
  if (canvas.style.getPropertyValue('--qs-dashboard-chart-extra-height') !== extra) {
    canvas.style.setProperty('--qs-dashboard-chart-extra-height', extra);
  }
  return {
    ...trainingStateChartGrid(),
    top: 8 + heading,
    bottom: TRAINING_STATE_PLOT_BOTTOM + footer,
  };
}

/** Share the dashboard Form canvas equally, with only label clearance between panels. */
export function dashboardChartPanelGrids(canvas: HTMLElement, height = canvas?.clientHeight) {
  if (!canvas?.closest('.dashboard-chart-frame') || !(height > 0)) return null;
  const top = 8;
  const gap = 16;
  const panelHeight = Math.max(1, (height - top - TRAINING_STATE_PLOT_BOTTOM - gap) / 2);
  return [
    { top, height: panelHeight },
    { bottom: TRAINING_STATE_PLOT_BOTTOM, height: panelHeight },
  ];
}

/** Align neighbouring plots without imposing a fixed height on their summaries. */
export function alignDashboardChartPlots(board: HTMLElement, enabled: boolean): HTMLElement[] {
  const plots = Array.from(board.querySelectorAll<HTMLElement>(
    '.dashboard-chart-frame [data-dashboard-chart-plot]',
  ));
  if (!enabled) {
    for (const plot of plots) {
      plot.style.removeProperty(OFFSET_PROPERTY);
      plot.style.removeProperty(FOOTER_PROPERTY);
    }
    return plots;
  }
  const groups = new Map<string, { plot: HTMLElement; start: number; footer: number }[]>();
  // Read every rectangle before writing, and subtract our previous contribution.
  // This makes repeated observations stable instead of accumulating blank space.
  for (const plot of plots) {
    const cell = plot.closest<HTMLElement>('app-dashboard-tile-cell');
    if (!cell) continue;
    const cellRect = cell.getBoundingClientRect();
    if (!cellRect.width) continue;
    const plotRect = plot.getBoundingClientRect();
    if (!plotRect.height) continue;
    const offset = parseFloat(plot.style.getPropertyValue(OFFSET_PROPERTY)) || 0;
    const heading = Number(plot.dataset.dashboardChartHeadingHeight) || 0;
    const start = plotRect.top - cellRect.top - offset + heading;
    const key = `${Math.round(cellRect.top)}:${cell.style.gridRow}:${plot.dataset.dashboardChartLayout || 'single'}`;
    const group = groups.get(key) || [];
    group.push({ plot, start, footer: Number(plot.dataset.dashboardChartFooterHeight) || 0 });
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const maxStart = Math.max(...group.map(item => item.start));
    const maxFooter = Math.max(...group.map(item => item.footer));
    for (const { plot, start, footer } of group) {
      const value = `${Math.max(0, Math.round((maxStart - start) * 100) / 100)}px`;
      const previous = parseFloat(plot.style.getPropertyValue(OFFSET_PROPERTY));
      if (!Number.isFinite(previous) || Math.abs(previous - parseFloat(value)) > ALIGNMENT_EPSILON_PX) {
        plot.style.setProperty(OFFSET_PROPERTY, value);
      }
      const footerValue = `${maxFooter - footer}px`;
      if (plot.style.getPropertyValue(FOOTER_PROPERTY) !== footerValue) plot.style.setProperty(FOOTER_PROPERTY, footerValue);
    }
  }
  return plots;
}
