import { describe, expect, it } from 'vitest';
import {
  getSparseEqualWidthDashboardGridLayout,
  getTrailingDashboardGridPlaceholderCount,
} from './dashboard-grid-layout.helper';

describe('getSparseEqualWidthDashboardGridLayout', () => {
  it('splits a sparse four-column row evenly between two items', () => {
    expect(getSparseEqualWidthDashboardGridLayout(2, 4)).toEqual({
      columns: 4,
      itemColumns: 2,
    });
  });

  it('shrinks the board instead of stretching one item in a three-column row', () => {
    expect(getSparseEqualWidthDashboardGridLayout(2, 3)).toEqual({
      columns: 2,
      itemColumns: 1,
    });
  });

  it('keeps three sparse items equal inside a four-column maximum', () => {
    expect(getSparseEqualWidthDashboardGridLayout(3, 4)).toEqual({
      columns: 3,
      itemColumns: 1,
    });
  });

  it('does not apply when the row is not sparse', () => {
    expect(getSparseEqualWidthDashboardGridLayout(5, 4)).toBeNull();
  });

  it('does not apply for singleton or single-column boards', () => {
    expect(getSparseEqualWidthDashboardGridLayout(1, 4)).toBeNull();
    expect(getSparseEqualWidthDashboardGridLayout(2, 1)).toBeNull();
  });
});

describe('getTrailingDashboardGridPlaceholderCount', () => {
  it('does not add placeholders for a single-column board', () => {
    expect(getTrailingDashboardGridPlaceholderCount([
      { size: { columns: 1, rows: 1 } },
    ], 1)).toBe(0);
  });

  it('fills the remaining slots in a partial final row', () => {
    expect(getTrailingDashboardGridPlaceholderCount([
      { size: { columns: 1, rows: 1 } },
      { size: { columns: 1, rows: 1 } },
      { size: { columns: 1, rows: 1 } },
    ], 2)).toBe(1);
  });

  it('returns no placeholders when the final row is already full', () => {
    expect(getTrailingDashboardGridPlaceholderCount([
      { size: { columns: 1, rows: 1 } },
      { size: { columns: 1, rows: 1 } },
      { size: { columns: 2, rows: 1 } },
    ], 2)).toBe(0);
  });

  it('accounts for wider dashboards', () => {
    expect(getTrailingDashboardGridPlaceholderCount([
      { size: { columns: 1, rows: 1 } },
      { size: { columns: 1, rows: 1 } },
      { size: { columns: 1, rows: 1 } },
      { size: { columns: 1, rows: 1 } },
      { size: { columns: 1, rows: 1 } },
    ], 4)).toBe(3);
  });

  it('fills available trailing cells when previous tiles span multiple rows', () => {
    expect(getTrailingDashboardGridPlaceholderCount([
      { size: { columns: 1, rows: 2 } },
      { size: { columns: 1, rows: 1 } },
    ], 2)).toBe(1);
  });

  it('fills each trailing row when the final tile spans multiple rows', () => {
    expect(getTrailingDashboardGridPlaceholderCount([
      { size: { columns: 1, rows: 2 } },
    ], 2)).toBe(2);
  });
});
