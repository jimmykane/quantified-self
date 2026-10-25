import { afterEach, describe, expect, it } from 'vitest';
import { alignDashboardChartPlots, dashboardChartFrameGrid } from './dashboard-chart-layout.helper';

afterEach(() => document.body.replaceChildren());

function createBoard() {
  const board = document.createElement('app-dashboard-tile-board');
  document.body.append(board);
  return board;
}

function addPlot(board: HTMLElement, top: number, header: number, rows = 1, heading = 0) {
  const cell = document.createElement('app-dashboard-tile-cell');
  cell.style.gridRow = `span ${rows}`;
  const frame = document.createElement('app-tile-chart');
  frame.className = 'dashboard-chart-frame';
  const plot = document.createElement('div');
  plot.dataset.dashboardChartPlot = '';
  plot.dataset.dashboardChartHeadingHeight = `${heading}`;
  frame.append(plot);
  cell.append(frame);
  board.append(cell);
  cell.getBoundingClientRect = () => ({ top, width: 300 } as DOMRect);
  plot.getBoundingClientRect = () => ({
    top: top + header + (parseFloat(plot.style.getPropertyValue('--qs-dashboard-chart-header-offset')) || 0),
    height: 252,
  } as DOMRect);
  return plot;
}

function offset(plot: HTMLElement) {
  return plot.style.getPropertyValue('--qs-dashboard-chart-header-offset');
}

describe('dashboard plot alignment', () => {
  it('scopes common axis insets to saved dashboard frames and releases unused legend space', () => {
    const preview = document.createElement('div');
    expect(dashboardChartFrameGrid(preview, { legendBottom: 32 })).toEqual({});
    expect(preview.style.length).toBe(0);
    const plot = addPlot(createBoard(), 0, 60);
    expect(dashboardChartFrameGrid(plot, { legendBottom: 32 })).toMatchObject({ top: 8, bottom: 56 });
    expect(plot.style.getPropertyValue('--qs-dashboard-chart-extra-height')).toBe('32px');
    expect(dashboardChartFrameGrid(plot)).toMatchObject({ top: 8, bottom: 24 });
    expect(plot.dataset.dashboardChartFooterHeight).toBe('0');
    expect(plot.style.getPropertyValue('--qs-dashboard-chart-extra-height')).toBe('0px');
  });

  it('aligns data baselines when only one neighbour has a comparison legend', () => {
    const board = createBoard();
    const plain = addPlot(board, 0, 60);
    const comparison = addPlot(board, 0, 60);
    comparison.dataset.dashboardChartFooterHeight = '32';
    alignDashboardChartPlots(board, true);
    expect(plain.style.getPropertyValue('--qs-dashboard-chart-footer-offset')).toBe('32px');
    expect(comparison.style.getPropertyValue('--qs-dashboard-chart-footer-offset')).toBe('0px');
    comparison.dataset.dashboardChartFooterHeight = '0';
    alignDashboardChartPlots(board, true);
    expect(plain.style.getPropertyValue('--qs-dashboard-chart-footer-offset')).toBe('0px');
  });

  it('aligns neighbours with different metadata and remains stable across resize observations', () => {
    const board = createBoard();
    const short = addPlot(board, 100, 60);
    const long = addPlot(board, 100, 180);
    alignDashboardChartPlots(board, true);
    expect(offset(short)).toBe('120px');
    expect(offset(long)).toBe('0px');
    alignDashboardChartPlots(board, true);
    alignDashboardChartPlots(board, true);
    expect(offset(short)).toBe('120px');
    expect(offset(long)).toBe('0px');
  });

  it('keeps separate rows and different saved spans independent', () => {
    const board = createBoard();
    const first = addPlot(board, 0, 60);
    const next = addPlot(board, 500, 180);
    const taller = addPlot(board, 0, 240, 2);
    alignDashboardChartPlots(board, true);
    expect([first, next, taller].map(offset)).toEqual(['0px', '0px', '0px']);
  });

  it('accounts for headings drawn inside generic ECharts canvases', () => {
    const board = createBoard();
    const generic = addPlot(board, 0, 0, 1, 62);
    addPlot(board, 0, 90);
    alignDashboardChartPlots(board, true);
    expect(offset(generic)).toBe('28px');
    alignDashboardChartPlots(board, true);
    expect(offset(generic)).toBe('28px');
  });

  it('removes obsolete offsets after a neighbour disappears or the board becomes one column', () => {
    const board = createBoard();
    const short = addPlot(board, 0, 60);
    const long = addPlot(board, 0, 180);
    alignDashboardChartPlots(board, true);
    long.closest('app-dashboard-tile-cell')!.remove();
    alignDashboardChartPlots(board, true);
    expect(offset(short)).toBe('0px');
    addPlot(board, 0, 200);
    alignDashboardChartPlots(board, true);
    expect(offset(short)).toBe('140px');
    alignDashboardChartPlots(board, false);
    expect(offset(short)).toBe('');
  });

  it('does not align hidden plots or library previews outside dashboard frames', () => {
    const board = createBoard();
    const visible = addPlot(board, 0, 60);
    const hidden = addPlot(board, 0, 300);
    hidden.getBoundingClientRect = () => ({ height: 0 } as DOMRect);
    const preview = addPlot(board, 0, 400);
    preview.parentElement!.classList.remove('dashboard-chart-frame');
    expect(alignDashboardChartPlots(board, true)).toEqual([visible, hidden]);
    expect(offset(visible)).toBe('0px');
    expect(offset(preview)).toBe('');
  });
});
