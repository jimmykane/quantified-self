import { describe, expect, it } from 'vitest';
import { getTrailingDashboardGridPlaceholderCount } from './dashboard-grid-layout.helper';

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
